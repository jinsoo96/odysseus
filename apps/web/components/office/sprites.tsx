/** 사무실 가구 — 그림 파일 없이 코드로 그린다.
 *
 * 타일셋을 받아 넣지 않는 이유는 취향이 아니다. 이 바닥의 표준 아트(LimeZu 계열)는
 * 상업 이용은 되지만 **재배포 금지** 조항이 붙어 있어, 공개 MIT 저장소에 넣는 순간
 * `git clone` 자체가 조건 위반이 된다. 게다가 이 제품은 Monaco 를 자체 호스팅하면서까지
 * "외부에서 아무것도 받지 않는다"를 지켜 왔다. 그려서 만들면 배포하는 아트가 없으므로
 * 지킬 조건도, 받아 올 것도 없다.
 *
 * 이모지도 쓰지 않는다. 🪴☕📠 는 OS 마다 다른 그림이 오고, 상자 크기를 알 수 없어
 * 겹침을 계산할 수조차 없다. 예전 배치가 끝내 안 고쳐진 진짜 이유가 그것이었다.
 *
 * ── 모든 물건이 지키는 규칙 ──────────────────────────────────
 *  1. 빛은 **화면 위쪽에서 하나만** 온다. 북쪽 모서리에 밝은 선, 남쪽에 어두운 앞면.
 *  2. 색은 **윗면·앞면·옆면 세 단계와 접지 그림자 하나**뿐이다. 네 번째 톤은 없다.
 *  3. 검은 외곽선을 긋지 않는다. 형태는 명도 차로 갈린다.
 *  4. 발밑에 그림자가 하나씩 있다. 이게 있어야 바닥에 서 있는 것으로 보인다.
 *  5. 24px 로 줄여 실루엣만 남겨도 무엇인지 알아야 한다.
 *  6. 가구에는 부서 색을 쓰지 않는다. 자리에서 색은 **상태**만 뜻한다.
 */

const TOP = "#3A4763"; // 윗면
const FRONT = "#28324A"; // 앞면
const EDGE = "#1C2438"; // 가장 어두운 면
const LIP = "rgba(255,255,255,.14)"; // 북쪽 모서리 하이라이트
const CONTACT = "rgba(2,6,23,.45)"; // 접지 그림자

/** 한 번만 심어 두고 `<use href="#f-…">` 로 꺼내 쓰는 심볼 모음.
 *  같은 가구가 열 개 있어도 도형은 한 벌만 존재한다. */
export function OfficeSprites() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
    >
      <defs>
        {/* 책상 — 상판과 앞면, 그 위의 모니터. 모니터는 별도의 물건이 아니라
            책상 위에 놓인 것이므로 칸을 따로 차지하지 않는다. */}
        <symbol id="f-desk" viewBox="0 0 64 40">
          <rect x="2" y="30" width="62" height="9" rx="3" fill={CONTACT} />
          <rect x="0" y="24" width="64" height="10" rx="2" fill={FRONT} />
          <rect x="0" y="0" width="64" height="26" rx="2" fill={TOP} />
          <rect x="0" y="0" width="64" height="1.5" fill={LIP} />
          <rect x="0" y="25" width="64" height="1" fill={EDGE} />
          <ellipse cx="32" cy="17" rx="6" ry="2" fill={EDGE} />
          <rect x="30.5" y="11" width="3" height="6" fill={EDGE} />
          <rect x="18" y="1" width="28" height="12" rx="2" fill={FRONT} />
          <rect className="o-screen" x="20" y="2.5" width="24" height="9" rx="1" />
          <rect x="18" y="1" width="28" height="1" fill={LIP} />
        </symbol>

        {/* 의자 — 위에서 뒤로 본 모양. 등받이가 언제나 보는 쪽에 온다. */}
        <symbol id="f-chair" viewBox="0 0 32 32">
          <ellipse cx="16" cy="28" rx="11" ry="3.5" fill={CONTACT} />
          <ellipse cx="16" cy="25" rx="10" ry="4" fill={EDGE} />
          <rect x="14" y="19" width="4" height="6" fill={EDGE} />
          <rect x="5" y="8" width="22" height="13" rx="6" fill={TOP} />
          <rect x="6" y="14" width="20" height="10" rx="4" fill="#2F3A54" />
          <rect x="6" y="14" width="20" height="1.2" fill="rgba(255,255,255,.10)" />
          <rect x="3" y="11" width="2" height="8" rx="1" fill={FRONT} />
          <rect x="27" y="11" width="2" height="8" rx="1" fill={FRONT} />
        </symbol>

        {/* 화분 — 잎은 정확히 세 덩이. 더 넣으면 24px 에서 뭉갠다. */}
        <symbol id="f-plant" viewBox="0 0 32 36">
          <ellipse cx="16" cy="31" rx="9" ry="3.5" fill={CONTACT} />
          <path d="M10,23 L22,23 L20,32 L12,32 Z" fill="#6B4F3F" />
          <path d="M10.8,27.5 L21.2,27.5 L20,32 L12,32 Z" fill="#523C2F" />
          <ellipse cx="15" cy="17" rx="8" ry="7" fill="#4A8A6C" />
          <ellipse cx="10" cy="21" rx="6" ry="5.5" fill="#3C7359" />
          <ellipse cx="22" cy="21" rx="6" ry="5.5" fill="#325F4A" />
        </symbol>

        {/* 정수기 — 물통의 하이라이트 한 줄이 이걸 물로 읽히게 한다 */}
        <symbol id="f-cooler" viewBox="0 0 32 40">
          <ellipse cx="16" cy="35" rx="9" ry="3" fill={CONTACT} />
          <rect x="8" y="16" width="16" height="20" rx="3" fill={FRONT} />
          <rect x="8" y="14" width="16" height="4" rx="2" fill={TOP} />
          <rect x="9" y="2" width="14" height="14" rx="6" fill="#7DD3FC" opacity=".5" />
          <rect x="11" y="4" width="1.5" height="9" rx=".75" fill="rgba(255,255,255,.55)" />
          <rect x="10" y="34" width="12" height="2" fill={EDGE} />
        </symbol>

        {/* 서류 캐비닛 — 줄 세 개짜리 키 큰 상자. 실루엣만으로 가장 확실한 물건. */}
        <symbol id="f-cabinet" viewBox="0 0 32 44">
          <ellipse cx="16" cy="41" rx="12" ry="3" fill={CONTACT} />
          <rect x="0" y="20" width="32" height="20" fill={FRONT} />
          <rect x="0" y="8" width="32" height="14" rx="2" fill={TOP} />
          <rect x="0" y="8" width="32" height="1.2" fill={LIP} />
          <rect x="0" y="26" width="32" height="1" fill={EDGE} />
          <rect x="0" y="32" width="32" height="1" fill={EDGE} />
          <rect x="0" y="38" width="32" height="1" fill={EDGE} />
          <rect x="11" y="28" width="10" height="2" rx="1" fill={LIP} />
          <rect x="11" y="34" width="10" height="2" rx="1" fill={LIP} />
          <rect x="11" y="40" width="10" height="2" rx="1" fill={LIP} />
        </symbol>

        {/* 복합기 — 튀어나온 종이 한 장이 실루엣을 만든다 */}
        <symbol id="f-printer" viewBox="0 0 32 34">
          <ellipse cx="16" cy="32" rx="12" ry="3" fill={CONTACT} />
          <rect x="3" y="16" width="26" height="16" rx="2" fill={FRONT} />
          <rect x="5" y="12" width="22" height="6" rx="1" fill={TOP} />
          <rect x="5" y="12" width="22" height="1.2" fill={LIP} />
          <rect x="7" y="9" width="18" height="3" rx="1" fill="#CBD5E1" opacity=".75" />
          <circle cx="25" cy="20" r="1.4" fill="#34D399" />
        </symbol>

        {/* 책장 — 칸마다 색이 다른 책등 */}
        <symbol id="f-shelf" viewBox="0 0 32 48">
          <ellipse cx="16" cy="45" rx="12" ry="3" fill={CONTACT} />
          <rect x="2" y="12" width="28" height="32" fill={FRONT} />
          <rect x="2" y="6" width="28" height="8" rx="1" fill={TOP} />
          <rect x="2" y="6" width="28" height="1.2" fill={LIP} />
          <rect x="2" y="24" width="28" height="1" fill={EDGE} />
          <rect x="2" y="34" width="28" height="1" fill={EDGE} />
          <rect x="5" y="16" width="3" height="8" fill="#3D4A63" />
          <rect x="9" y="17" width="3" height="7" fill="#52607C" />
          <rect x="13" y="16" width="3" height="8" fill="#2A3448" />
          <rect x="5" y="27" width="3" height="7" fill="#52607C" />
          <rect x="9" y="26" width="3" height="8" fill="#2A3448" />
          <rect x="13" y="27" width="3" height="7" fill="#3D4A63" />
        </symbol>

        {/* 소파 — 두 칸짜리. 팔걸이가 위쪽 빛을 받는다. */}
        <symbol id="f-sofa" viewBox="0 0 64 40">
          <rect x="3" y="30" width="61" height="8" rx="4" fill={CONTACT} />
          <rect x="2" y="6" width="60" height="12" rx="5" fill="#2F3A54" />
          <rect x="4" y="14" width="56" height="16" rx="6" fill={TOP} />
          <rect x="0" y="8" width="8" height="20" rx="4" fill="#414E6C" />
          <rect x="56" y="8" width="8" height="20" rx="4" fill="#414E6C" />
          <rect x="2" y="6" width="60" height="1.2" fill={LIP} />
          <rect x="32" y="16" width="1" height="12" fill="rgba(2,6,23,.20)" />
        </symbol>

        {/* 화이트보드 — 벽에 건다. 바닥 칸을 쓰지 않는다.
            글자 대신 선만 긋는다. 여기에 글자를 쓰면 그 순간 다시 카드가 된다. */}
        <symbol id="f-board" viewBox="0 0 64 20">
          <rect x="0" y="0" width="64" height="14" rx="1" fill="#E2E8F0" opacity=".86" />
          <rect
            x="0.5"
            y="0.5"
            width="63"
            height="13"
            rx="1"
            fill="none"
            stroke={EDGE}
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          <rect x="0" y="14" width="64" height="3" fill={FRONT} />
          <path
            d="M6,5 L14,5 M6,9 L20,9 M26,4 L34,10 M40,6 L52,6 M40,10 L48,10"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity=".45"
            fill="none"
          />
        </symbol>
      </defs>
    </svg>
  );
}
