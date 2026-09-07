# Odysseus 평가 신뢰성·실행 안정성 운영 가이드

이 문서는 PR #2에서 도입한 평가 정의 고정, 자동평가 점수 엔진, 실행 큐 복구, 샌드박스 자원 제한,
비밀값 암호화의 운영 규칙을 설명합니다. 특히 **배포 전에 반드시 준비해야 하는 값**과 롤백 제약을
명확하게 기록합니다.

## 1. 평가 정의는 응시 시작 시 고정됩니다

`Scenario`, `Assessment`, `AiProvider` 행은 앞으로도 관리자가 편집하는 최신 authoring state입니다.
반면 응시가 시작되면 API가 그 시점의 시험 정의 전체를 `Attempt.snapshot._definition`에 저장하고
`_definition_hash`를 함께 남깁니다.

고정되는 항목:

- 시험 제목/설명/제한 시간/AI 에이전트 턴 수
- 시나리오 순서와 배점
- briefing, 등장인물 persona/knowledge, 오프닝 메시지
- 초기 파일
- 숨은 요구사항(`objectives_md`)
- 자동 checks와 rubric
- agent 사용 가능 여부
- NPC/Agent 공급자의 비밀이 아닌 실행 설정(provider/model/base URL/temperature/max tokens)

API key나 인증 header 같은 비밀값은 Attempt snapshot에 복제하지 않습니다. 자격증명은 암호화된
`AiProvider` 저장소에서 읽고, 모델 동작을 결정하는 비밀 아닌 설정만 응시 시점 값으로 덮어씁니다.

따라서 관리자가 이후 시나리오나 시험을 수정하면 **새 응시/재응시에만** 반영됩니다. 과거 응시는
당시 definition hash와 당시 grading criteria를 계속 사용합니다.

기존 PR 이전에 만들어진 legacy Attempt에는 definition snapshot이 없을 수 있습니다. 이 경우 최초
조회/평가 시 현재 definition을 한 번 바인딩하고 이후부터 고정합니다. 이미 과거에 정의가 변경된
legacy Attempt는 원래 당시 정의를 완벽하게 복원할 수 없으므로 이 점은 감사 시 구분해야 합니다.

## 2. 자동평가 점수 엔진 v2

LLM은 과정/품질 판단과 설명을 담당하지만, deterministic check 결과를 임의로 무시할 수 없습니다.
서버가 최종 점수를 다시 계산합니다.

기본 result score:

```text
result_pct = deterministic_check_pct * 0.70
           + qualitative_result_pct   * 0.30
```

시나리오 rubric에 `deterministic_check_weight`를 넣으면 0~100 범위에서 변경할 수 있습니다.
checks가 없는 시나리오는 qualitative result 100%로 자동 fallback합니다.

최종 점수는 기존 rubric의 `process_weight` / `result_weight`로 합산합니다. Evaluation에는 다음
provenance가 함께 저장됩니다.

- attempt definition hash
- 제출 시 workspace digest
- evaluator provider/model/name
- evaluation prompt SHA-256
- score engine version
- deterministic / qualitative 세부 점수와 실제 적용 weight

진행 중인 Attempt에는 auto/human evaluation을 실행할 수 없습니다.

## 3. 실행 큐 전달 보장

PostgreSQL `Execution` 행이 durable source of truth입니다.

실행 요청 흐름:

```text
PostgreSQL queued row commit
        ↓
Redis idempotent enqueue (execution-id marker + LPUSH in one Lua script)
        ↓
pending queue
        ↓ BRPOPLPUSH
runner-specific processing queue
        ↓
execute + API callback accepted
        ↓
LREM ACK
```

API가 DB commit 직후 죽거나 Redis가 잠시 내려가도 `queue_recovery`가 15초마다 `queued` 행을 찾아
idempotent enqueue를 다시 시도합니다. 이미 Redis에 들어간 execution은 marker 때문에 중복
enqueue되지 않습니다.

Runner가 작업을 꺼낸 뒤 죽으면 raw job은 `odysseus:run:processing:<RUNNER_ID>`에 남습니다.
같은 `RUNNER_ID`로 재시작하면 시작 시 processing list를 pending queue로 되돌립니다.

### RUNNER_ID 규칙

- 단일 runner: 기본값 `runner-main` 사용 가능
- runner replica 여러 개: **각 replica에 서로 다른 ID**를 지정해야 함
- 같은 replica가 재시작할 때는 **이전과 같은 ID**를 사용해야 미완료 processing job을 회수함

오케스트레이터를 사용한다면 StatefulSet ordinal 또는 고정 instance identity를 권장합니다.

응시 제출/만료 시 queued/running execution에는 cancellation tombstone을 남기고 callback token을
즉시 폐기합니다. 따라서 오래된 worker가 뒤늦게 결과를 보내도 제출된 workspace를 바꿀 수 없습니다.

## 4. Runner 격리와 자원 제한

운영 기본값은 `RUNNER_REQUIRE_ISOLATION=true`입니다. PID/mount/IPC/UTS/net namespace를 만들 수
없는 환경에서는 candidate code를 **비격리 상태로 실행하는 대신 runner 기동 자체를 거부**합니다.

기존 container `mem_limit`에 더해 실행별 descendant RSS watchdog이 있습니다.

- `RUNNER_MEM_MB`: runner container 전체 메모리 상한
- `RUNNER_EXEC_MEM_MB`: execution 한 건의 process-tree RSS 상한
- 미지정 시 `max(512MB, RUNNER_MEM_MB * 0.8 / RUNNER_CONCURRENCY)`

Go/JVM이 큰 virtual address space를 reserve하는 특성 때문에 `RLIMIT_AS`는 사용하지 않습니다.
CPU, file size, fd, process count, wall time, output hard cap은 기존 sandbox 제한을 계속 사용합니다.

### gVisor 선택 적용

호스트에 `runsc` runtime이 설치·등록되어 있다면:

```bash
RUNNER_RUNTIME=runsc
```

로 runner container 자체를 gVisor 위에서 실행할 수 있습니다. 설치되어 있지 않은 서버에서 값을
바꾸면 container가 시작되지 않으므로 먼저 staging에서 isolation/toolchain smoke test를 수행해야 합니다.
기본은 `runc`입니다.

## 5. DB 비밀값 AES-GCM 암호화

운영 환경에는 새 필수 변수 `DATA_ENCRYPTION_KEY`가 필요합니다.

배포 전에 **한 번만 생성하고 안전하게 보관**합니다.

```bash
openssl rand -hex 32
```

`.env` 예시:

```text
DATA_ENCRYPTION_KEY=<생성한 값>
```

`JWT_SECRET`, `INTERNAL_TOKEN`과 다른 값을 사용하십시오.

암호화 대상:

- `AiProvider.api_key`
- `AiProvider.default_headers`
- `AppSetting.value` 전체 (GitHub token, 검색 API key, legacy AI 설정 포함 가능)

AES-256-GCM + random nonce를 사용하며, 같은 평문도 저장할 때 서로 다른 ciphertext가 생성됩니다.
기존 plaintext row는 새 버전 최초 기동 시 자동으로 encrypted envelope로 다시 저장됩니다.

### 매우 중요한 백업/롤백 규칙

`DATA_ENCRYPTION_KEY`는 DB backup과 한 세트입니다. 키를 잃으면 저장된 provider/reference credential을
복호화할 수 없습니다. backup 정책에 키 자체를 DB dump 안에 넣지 말고 별도 secret store에서
동일한 retention 정책으로 보관하십시오.

또한 **평문 DB를 읽던 구버전 애플리케이션으로 코드만 롤백하면 안 됩니다.** 새 버전이 한 번 기동해
plaintext secret을 암호화한 뒤에는 구버전이 ciphertext를 API key로 오해합니다.

롤백은 다음 둘 중 하나여야 합니다.

1. 암호화 지원이 포함된 버전으로만 롤백
2. 배포 직전 DB backup + 당시 `DATA_ENCRYPTION_KEY`/환경 설정을 함께 복원

## 6. Multi-replica API

다음 상태는 이제 프로세스 메모리에 의존하지 않습니다.

- Agent turn mutex: Redis owner-token lease
- Messenger NPC thread ordering: Redis owner-token lease
- rate limit token bucket: Redis
- login failure backoff: Redis
- terminal run admission: PostgreSQL `Attempt FOR UPDATE`
- agent quota reservation: PostgreSQL `Attempt FOR UPDATE`
- startup DDL/bootstrap: PostgreSQL transaction advisory lock

Redis가 순간적으로 unavailable할 때 rate limiter는 제한 자체를 없애지 않고 process-local fallback을
사용합니다. 큐는 DB `queued` 상태를 보존하고 Redis가 돌아오면 reconciler가 복구합니다.

## 7. 개인정보 최소화

브라우저 telemetry는 copy/cut 이벤트를 보내더라도 서버 allowlist가 `text` 필드를 저장하지 않습니다.
평가용으로는 `chars`, `source`, sequence 같은 metadata만 남습니다. raw clipboard text를 평가 DB에
보존하지 않습니다.

## 8. 배포 체크리스트

1. 현재 DB backup을 생성하고 복원 가능성을 확인합니다.
2. `DATA_ENCRYPTION_KEY=$(openssl rand -hex 32)` 값을 secret store와 `.env`에 저장합니다.
3. `JWT_SECRET`, `INTERNAL_TOKEN`, Redis 두 password가 각각 충분히 긴 독립 값인지 확인합니다.
4. runner replica가 하나보다 많으면 고유/안정적인 `RUNNER_ID`를 지정합니다.
5. 필요하면 `RUNNER_EXEC_MEM_MB`를 workload에 맞게 조절합니다.
6. gVisor를 쓸 경우 staging에서 `RUNNER_RUNTIME=runsc`로 기존 isolation/toolchain smoke test를 먼저 통과시킵니다.
7. 배포 후 `/healthz`, 로그인, Scenario/Assessment CRUD, 시험 시작, NPC/Agent, terminal 실행, 제출, review checks/autoeval 흐름을 확인합니다.
8. 새 Attempt의 `snapshot._definition_hash`와 Evaluation `scores.audit.definition_hash`가 일치하는지 확인합니다.
9. DB에서 secret column이 `enc:v1:` envelope 형태로 저장되는지 확인하되 값을 로그/티켓에 복사하지 않습니다.

## 9. CI가 보장하는 최소선

PR CI는 다음을 merge gate로 둡니다.

- Python source compile
- reliability unit tests (definition hash / score engine / AES-GCM)
- Docker Compose configuration validation
- locked npm install
- TypeScript typecheck
- Next production build
- production npm dependency audit (`high` 이상 실패)

실제 namespace/cgroup/toolchain/backup 복원 테스트는 privileged Linux 환경이 필요하므로 기존 smoke harness와
배포 전 staging 검증을 계속 유지해야 합니다.
