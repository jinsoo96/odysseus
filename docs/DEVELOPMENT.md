# Odysseus — 개발·운영 안내

제품 소개는 [README](../README.md)에 있습니다. 여기는 만들고 굴리는 사람을 위한 문서입니다.

## 격리

러너 컨테이너 하나를 모든 응시자가 공유하지만, 실행 한 건은 세 겹으로 가둡니다.

| 층 | 방법 | 확인된 효과 |
|---|---|---|
| 네임스페이스 | `unshare --pid --mount --ipc --uts` + `/proc` 재마운트 + 실행 전용 tmpfs `/tmp` | `ps` 에 자기 프로세스만, `/tmp` 는 실행마다 다른 파일시스템 |
| UID | 실행마다 다른 UID 로 강등, 작업 폴더 0700 | 동시에 도는 남의 워크스페이스를 읽을 수 없다 |
| 네트워크 | 러너는 internal 네트워크에만 — 외부·DB 도달 불가 | `git clone` 과 웹 조회는 서버가 대리하고 기록한다 |

툴체인은 Python(numpy·pandas) · Node.js · Go · Java 21 · GCC · git · make/cmake · sqlite3 · jq · ripgrep 입니다. 인터넷 앱은 페이지를 허용 목록으로 정제하고 이미지·CSS·폰트를 **서명된 프록시**로 재작성해 샌드박스 iframe 에 넣습니다 — 스크립트는 우리가 심은 nonce 하나뿐이고 CSP 가 나머지를 막습니다. 관리자 [자원 관리]에서 러너 CPU·메모리 추이, 실행 중인 명령, 진행 중인 세션을 보고 끊을 수 있습니다.

## 시나리오 스튜디오

문제 상황 전체를 설계하는 편집기입니다. 왼쪽이 편집기, 오른쪽이 **AI 설계자 대화**입니다.

"커머스 데이터플랫폼팀. 주간 매출 리포트 숫자가 이상하다는 CS 제보, medium" 한 줄이면 AI 가 제목·서사형 브리핑·인물(성격·지식·태도)·오프닝·초기 데이터·숨은 정답·자동 체크를 설계해 **필드 단위로 실시간** 채우고, "QA 를 하나 더", "데이터를 40행으로" 를 이어 가며 고도화합니다. 받은 것은 검증·정규화(인물 키·발신자·경로·정규식·배점)를 거치고, 저장은 사람이 합니다.

- **부서** — 이 업무가 벌어지는 직군. 응시자의 **사무실 화면**에서 이 시나리오가 어느 방에 놓일지를 정합니다. 정하지 않으면 로비에 남고, 목록 화면에서는 지금까지와 똑같이 보입니다. 목록은 코드가 아니라 `departments` 표에 있고 **관리자 콘솔 > 부서**에서 만들고 고칩니다
- **등장인물** — 이름/직함/성격(무례한 상대를 대하는 방식 포함) + `knowledge`(물어보면 답할 수 있는 정보의 전부). 요구사항을 인물별로 분산
- **오프닝 메시지** — 응시 시작 시 도착해 있는 메시지. 응시자의 유일한 출발점
- **초기 파일** — 워크스페이스 초기 상태(데이터·버그 코드·문서)
- **숨은 요구사항** — 정답 정의. NPC 의 배경 지식과 자동평가 기준으로만 쓰이며 응시자에게 노출되지 않음
- **자동 체크** — 실행이 필요한 것과 필요 없는 것으로 나뉩니다.
  | 종류 | 쓰는 곳 | 필요한 필드 |
  |---|---|---|
  | `file_exists` | 산출물이 만들어졌는가 | `path` |
  | `file_contains` | 필수 수치·문장이 있는가 (정규식) | `path`, `pattern` |
  | `file_not_contains` | 금칙어를 피했는가 (정규식, 대소문자 무시) | `path`, `pattern` |
  | `file_min_words` | 껍데기가 아닌 분량인가 | `path`, `min_count` |
  | `file_max_words` | 짧게 쓰는 것이 요구사항인가 (한 장 보고·공지) | `path`, `max_count` |
  | `csv_cell` | 표의 특정 칸이 정확한가 | `path`, `column`, `expected`, (`row_match`, `tolerance`) |
  | `csv_row_count` | 행 수가 맞는가 (조건에 맞는 행이 0개인 것도 답이 된다) | `path`, `expected`, (`row_match`) |
  | `csv_column_sum` | 열 합계가 맞는가 (총액·총원) | `path`, `column`, `expected`, (`row_match`, `tolerance`) |
  | `csv_column_unique` | 같은 값을 두 번 넣지 않았는가 (배정표·일정표) | `path`, `column`, (`row_match`) |
  | `command` | 코드가 실제로 도는가 (샌드박스 실행) | `command`, (`expected_stdout`) |

  `command` 를 뺀 나머지는 서버가 파일만 보고 판정하므로 러너가 필요 없습니다(`apps/api/odysseus_api/checks.py`).
  `csv_cell` 은 열 이름의 대소문자·공백·`_` 차이를 무시하고, 값이 숫자로 읽히면 `1,234,000원` 같은 표기를
  정규화해 비교합니다 — 채점이 표기 습관을 벌하지 않기 위해서입니다.
- **제공 앱(`desktop_apps`)** — 이 시나리오의 시험 데스크톱에 띄울 앱 목록. 비워 두면 전부 제공(기존 동작)이고,
  사무 과제는 보통 `files·docs·sheet(·mail·calendar·browser)` 만 켜서 터미널과 IDE 를 숨깁니다. 화면에 있는 도구가
  "이건 어떤 종류의 문제인가"라는 신호이기 때문입니다. 업무 성격별 조합은
  `apps/api/odysseus_api/desktop.py` 의 `APP_PRESETS`(engineering / office / communication / analysis / coordination)
  에 있습니다.
- **루브릭** — 과정(요구사항 파악·커뮤니케이션·작업 과정) / 결과(요구 충족·구현 품질)

기본 제공 시나리오는 세 갈래이고, 시험 프리셋 13종이 이들을 묶습니다.

- **엔지니어링 6종** (`scenarios/s01`–`s06`) — 집계 버그 · docker compose GPU 서빙 · Kubernetes 스케줄링 ·
  KVM GPU 패스스루 · 게이트웨이 로그 분석 · 배치 경쟁 조건.
- **사무 업무 13종** (`scenarios/b01`–`b13`) — 분기 실적 보고서 · 회의록 정리 · 벤더 선정 · 고객 클레임 ·
  출고 계획 · 예산 분석 · 갈등 중재 · 우선순위 조정 · 장애 공지 · 면접 일정 · 출장비 정산 검증 ·
  설문 한 장 보고 · 온보딩 일정.
- **일반 문제 해결 6종** (`scenarios/g01`–`g06`) — 워크숍 장소 선정 · 당직 근무표 · 복합기 수리와 교체 ·
  재택근무 갈등 조율 · 좌석 재배치 · 환불 판정. 직무 지식 없이 조건 수집과 판단만으로 풀리며,
  조건의 절반이 파일이 아니라 관계자에게 있습니다.

뒤의 두 갈래는 산출물이 문서와 표라서 체크가 전부 파일 기반이고, 데스크톱에서 터미널·IDE 를 뺍니다
(`scenarios.OFFICE_SCENARIOS`).

모두 **참조 해답으로 검증**되어 있습니다. 엔지니어링 트랙은 스택을 띄워
`tests/smoke/test_scenarios.py` 가, 사무·일반 트랙은 도커 없이 `tests/unit/test_scenario_presets.py` 가
초기 상태에서는 체크가 전부 실패하고(문제가 성립하고) 참조 해답에서는 전부 통과함을(정답이 존재함을)
매 CI 마다 확인합니다. 참조 해답은 `tests/smoke/business_solutions.py`(b 트랙)와
`tests/smoke/general_solutions.py`(g 트랙)에 있습니다.

## 아키텍처

```
            ┌──────────┐
 :3100 ───► │   edge   │ ── /api (SSE 무버퍼) ──► ┌──────────┐   LPUSH    ┌───────────┐
            │  nginx   │ ── /                ──► │   api    │ ─────────► │  runner   │
            └──────────┘      ┌──────────┐       │ FastAPI  │   Redis    │ (sandbox) │
                              │   web    │       └────┬─────┘ ◄───────── └───────────┘
                              │ Next.js  │            │      콜백(파일 diff) · 자원 스냅샷(1s)
                              └──────────┘       PostgreSQL
```

| 서비스 | 스택 | 역할 |
|---|---|---|
| `edge` | nginx | 단일 오리진 — `/api`(SSE 무버퍼)와 웹 |
| `web` | Next.js 15, Tailwind v4, Monaco | 데스크톱 시험장 / 스튜디오 / 리뷰 / 자원 관리 |
| `api` | FastAPI, SQLAlchemy(async), lxml | 인증, 시나리오·시험, NPC·에이전트·설계자 LLM, 워크스페이스(단일 진실=DB), 참고 자료 프록시, 자동평가 |
| `runner` | Python + unshare/setpriv/rlimit | 워크스페이스를 물질화해 격리 실행, 파일 변경분 회수, 자원 계측 |
| `postgres` / `redis` | 16 / 7 | 저장소 / 실행 큐·스냅샷 |

- **워크스페이스 = DB 가 단일 진실.** IDE 저장·에이전트 도구·실행 결과·clone 이 한 곳에서 만나고 전부 이벤트로 남습니다.
- **LLM 공급자**: OpenAI / Anthropic / Gemini / vLLM / Ollama / LM Studio / OpenAI 호환 / **Claude Code CLI**. Claude 구독 계정은 설정 화면의 **브라우저 로그인**(장수명 토큰 자동 발급)으로 연결합니다.
- **Claude Code 도구 브리지**: CLI 내장 도구·스킬·세션은 전부 차단하고 우리 워크스페이스 도구 8종만 **stdio MCP** 로 노출합니다. CLI 도 다른 공급자와 **동일한 도구 집합**으로 같은 샌드박스에서 실행합니다.

## 운영

```bash
./scripts/remote-deploy.sh [api web ...]         # 워크스페이스 → 운영 서버: pull + 아래 deploy.sh
sudo ./scripts/deploy.sh [--yes] [api web ...]   # 스냅샷 → 백업 → 빌드 → 기동 → 헬스체크 → 보존 검증
sudo ./scripts/backup.sh [설명]                   # pg_dump.gz (최근 20개 보관)
sudo ./scripts/restore.sh /var/backups/odysseus/ (암호화, root 전용)<file>.sql.gz  # 되돌릴 수 없으므로 두 번 묻는다
```

`docker compose down -v` 는 **절대 쓰지 마세요** — `pgdata` 볼륨에 계정·응시 기록·워크스페이스 파일·AI 공급자 키·관리자 설정이 전부 있습니다. `.env` 의 `POSTGRES_PASSWORD` 는 볼륨이 처음 만들어질 때 고정된 값이라 바꾸면 접속이 끊깁니다.

시크릿에는 **배포판 기본값**이 있어 `.env` 없이도 바로 돕니다. 그 값들은 저장소에 공개되어 있으므로
실제 응시자 데이터를 받기 전에 바꿔야 하고, 남아 있는 동안 api 가 기동할 때마다 크게 알립니다.

| 변수 | 설명 |
|---|---|
| `JWT_SECRET` / `INTERNAL_TOKEN` | 기본값 있음(저장소 공개 = 비밀 아님). 운영 전 각각 `openssl rand -hex 32` 로 교체. 기본값이 남아 있으면 기동할 때마다 경고 |
| `DATA_ENCRYPTION_KEY` | 기본값 있음. DB 의 AI 공급자 키·관리자 설정을 AES-GCM 으로 감싼다. 운영 전 교체하고 **DB 백업과 한 세트로 보관** — 바꾸면 그전 값을 못 읽어 관리 콘솔에서 재입력해야 한다(응시 기록·제출물은 대상 아님) |
| `POSTGRES_PASSWORD` | 기존 볼륨에 묶인 값 — 바꾸지 말 것 |
| `RUNNER_CONCURRENCY` / `RUNNER_MEM_MB` | 동시 실행 수 / 러너 메모리 상한 (기본 2 / 4096) |
| `REDIS_API_PASSWORD` / `REDIS_RUNNER_PASSWORD` | 기본값 있음. Redis ACL 계정(api=전체, runner=큐 소비·자기 통계만). 운영 전 교체 권장 |
| `ODYSSEUS_ENV` | `production`(기본) 또는 `development` |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` | 빈 DB 최초 기동 시 만들 관리자. 비밀번호를 비우면 무작위 생성 후 api 로그에 한 번 출력 |
| `SEED_DEMO_DATA` | **개발 전용.** 고정 비밀번호의 데모 계정 3개를 만든다. `ODYSSEUS_ENV=development` 가 아니면 기동 거부 (기본 false) |

### 사무실 구조 바꾸기

사무실의 방 목록이 곧 부서 목록입니다. **관리자 콘솔 > 부서**에서 만들고, 이름·색·순서·설명을 정합니다. 부서를 하나 더 만들면 층에 방이 하나 더 생기고, 순서를 바꾸면 방이 옮겨 갑니다 — 평면도에는 좌표가 적혀 있지 않고 목록에서 계산됩니다(`apps/web/components/office/floorplan.ts` 의 `buildFloor`). 방은 16개까지 놓을 수 있습니다.

부서 키(`slug`)는 시나리오가 가리키는 이름입니다. 키를 바꾸면 그 방에 있던 시나리오도 같이 옮겨 가고, 시나리오가 든 부서는 지워지지 않습니다. 어떤 이유로든 갈 곳을 잃은 시나리오는 사라지지 않고 화면의 **로비**에 모여 다시 배치되기를 기다립니다.

기본으로 들어가는 여덟 개는 기본 제공 시나리오 스물다섯 개가 실제로 무엇을 측정하는지에서 거꾸로 세운 것입니다(`departments.py` 의 `DEFAULT_DEPARTMENTS`). 지우고 바꾸라고 넣어 둔 값입니다.

### 이미 돌고 있는 배포에 부서 채우기

부서(`scenarios.department`)는 뒤늦게 생긴 컬럼이라 **기존 시나리오는 전부 빈 값(로비)** 입니다. 스키마는 기동할 때 저절로 올라가지만 값은 따로 넣어야 사무실 화면에 방이 채워집니다.

```bash
docker cp tests/smoke/seed_scenarios.py odysseus-api-1:/tmp/
docker exec -e PYTHONPATH=/app odysseus-api-1 python3 /tmp/seed_scenarios.py --refresh-departments
```

기본 제공 25종의 부서만 패키지 값으로 덮어씁니다. 직접 만든 시나리오는 건드리지 않으므로 스튜디오에서 지정하세요.

데모 계정(개발 시드에서만 생성, 스모크 테스트가 사용): `admin@odysseus.dev` · `evaluator@odysseus.dev` · `candidate@odysseus.dev` — 비밀번호는 `apps/api/odysseus_api/seed.py` 의 `DEMO_ACCOUNTS`. 운영 데이터에 이 계정이 남아 있으면 안 된다 (`docs/security/01`).

## 게스트 접속

계정을 미리 만들지 않고 로그인 화면에서 바로 응시하게 하는 경로입니다. 기본값은 **꺼짐**이고,
관리자 콘솔 **[설정] → 게스트 접속** 에서 켭니다.

게스트로 들어오면 `role="guest"` 인 진짜 `users` 행이 만들어집니다 — 익명 토큰이 아닙니다.
사용자 관리 화면에서 보이고, 정지시킬 수 있고, 응시 기록이 남습니다. 남용이 시작됐을 때
손댈 대상이 있어야 하기 때문입니다.

| 게스트가 할 수 있는 것 | 할 수 없는 것 |
|---|---|
| 열려 있는 **모든 시험**에 응시 (배정 불필요) | 관리자·평가자 화면과 API 전부 (403) |
| 시험 안의 메신저·AI 에이전트·터미널·참고자료 | 남의 응시 열람, 재응시, 시험 밖 참고자료 미리보기 |

**한도** (모두 [설정] → 게스트 접속 에서 조절)

| 설정 | 뜻 |
|---|---|
| 주소당 시간당 생성 | 한 IP 에서 1시간에 만들 수 있는 게스트 수. `0` 이면 새 게스트를 받지 않는다 |
| 분당 대화 수 | 순간적인 폭주를 막는다 |
| 응시당 대화 총량 | 메신저와 에이전트를 **합쳐서** 센다 — 한쪽만 막으면 다른 쪽으로 흘러간다. `0` 이면 총량 무제한 |

**주소 차단** ([설정] → 게스트 접속 아래). 게스트를 정지시켜도 새 게스트로 1초 뒤 돌아옵니다.
그래서 계정 정지(누구)와 주소 차단(어디서)이 함께 있어야 조치가 끝납니다. 단일 IP 와 CIDR 대역을 모두 받고, 차단하는
즉시 그 주소에서 열려 있던 세션을 끊습니다. 사용자 관리에서 게스트 행의 **[주소 차단]** 으로
바로 막을 수도 있습니다.

관리자 계정은 차단의 영향을 받지 않습니다 — 자기 대역을 실수로 넣었을 때 차단을 푸는 화면
자체에 못 들어가는 상황을 막기 위해서입니다.

게스트는 비밀번호가 없어 다시 로그인할 수 없습니다(세션 쿠키가 전부). 응시 도중 로그아웃하면
그 응시로 돌아올 수 없고, 화면에도 그렇게 안내합니다. 계속 쓸 사람이라면 사용자 관리에서
역할을 응시자로 바꾸고 비밀번호를 정해 주면 정식 계정이 됩니다.

게스트 계정은 자동으로 지워지지 않습니다. 쌓이면 사용자 관리의 **[게스트]** 탭에서 골라 지우세요.

## 테스트

전부 **실행해서** 확인합니다 — 격리는 실제로 남의 파일을 읽어 보고, 강제 종료는 프로세스가 정말 사라졌는지 보고, 백업은 임시 DB 에 실제로 복원해 봅니다.

```bash
# 스택 없이 도는 것들 (CI 가 매번 실행)
PYTHONPATH=apps/api python3 -m unittest discover -s tests/unit -p 'test_*.py'   # 신뢰성 코어 + 시나리오 프리셋 검증

python3 tests/smoke/mock_llm.py &                       # 모의 LLM (NPC·에이전트·평가·설계자)
GW=$(docker network inspect odysseus_backplane -f '{{(index .IPAM.Config 0).Gateway}}')

python3 tests/smoke/test_core.py "http://$GW:18011/v1"  # 핵심 흐름 54
python3 tests/smoke/test_scenarios.py                   # 기본 시나리오 참조 해답 14
python3 tests/smoke/test_sequential.py                  # 순차 진행 잠금 18
python3 tests/smoke/test_isolation.py                   # 샌드박스 격리·툴체인·적대적 입력 35
python3 tests/smoke/test_resources.py                   # 자원 계측·강제 종료·고아 정리 24
python3 tests/smoke/test_scenario_author_stream.py "http://$GW:18011/v1"  # AI 설계자 21
python3 tests/smoke/test_npc_prompt.py                  # NPC 프롬프트 계약 48
sudo python3 tests/smoke/test_persistence.py            # 백업·복원·보존 39

# api 컨테이너 안에서
docker cp tests/smoke/test_reference.py odysseus-api-1:/tmp/ && docker exec -e PYTHONPATH=/app odysseus-api-1 python3 /tmp/test_reference.py     # GitHub·웹 41
docker cp tests/smoke/test_web_render.py odysseus-api-1:/tmp/ && docker exec -e PYTHONPATH=/app odysseus-api-1 python3 /tmp/test_web_render.py  # 렌더러 39
docker cp tests/smoke/test_mcp_bridge.py odysseus-api-1:/tmp/ && docker exec -e PYTHONPATH=/app odysseus-api-1 python3 /tmp/test_mcp_bridge.py  # MCP·격리 전파 18
docker cp tests/smoke/test_cli_lockdown.py odysseus-api-1:/tmp/ && docker exec -e PYTHONPATH=/app odysseus-api-1 python3 /tmp/test_cli_lockdown.py  # CLI 잠금 19

# 브라우저 (Playwright)
python3 tests/smoke/ui_polish.py    # 마크다운 누수·깨진 값·넘침·콘솔 오류
python3 tests/smoke/ui_intro.py     # 시네마틱 인트로 → 부팅 → 데스크톱

# 게스트 접속
python3 tests/security/test_guest_access.py     # 차단 판정·표기 정규화·정책 파싱 26 (스택 불필요)
ADMIN_EMAIL=... ADMIN_PASSWORD=... python3 tests/security/test_guest_login.py   # 게스트 실동작 (엣지 경유)
```

## License

MIT
