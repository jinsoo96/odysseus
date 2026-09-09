"use client";

/** 응시자 아바타 — 가구와 같은 규칙으로 그린다.
 *
 * 빛은 화면 위에서 하나, 톤은 세 단계, 발밑에 접지 그림자 하나. 층 위의 모든 물건이
 * 같은 법칙을 따라야 한 장면으로 보인다. 다만 아바타만은 채도를 남겨 둔다 — 바닥이
 * 전부 무채 네이비인 화면에서 시선이 갈 곳은 사람 하나여야 한다.
 *
 * 외형은 계정에서 결정론적으로 나온다. 고르는 화면을 만들지 않는다: 아바타는 평가에
 * 쓰이지 않으므로, 시험 앞에 꾸미기 단계를 세울 이유가 없다.
 */

export type Facing = "north" | "south" | "east" | "west";

/** 서 있는 크기(px). 한 칸(32)보다 조금 커서 윗 칸에 걸친다 — 그래야 바닥에
 *  붙어 서 있는 것으로 보인다. */
export const AVATAR_SIZE = 34;

const EDGE = "#181F32";
const SHADE = "#1F273A";
const LIP = "rgba(255,255,255,.14)";
const CONTACT = "rgba(2,6,23,.45)";

/** 문자열 → 0..1. 같은 사람이면 언제 어디서 봐도 같은 색이 되게. */
function hash01(seed: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** 채도·명도를 묶어 둔다. 어떤 씨앗이 와도 어두운 바닥 위에서 읽히고,
 *  동시에 가구보다 튀되 형광으로 가지는 않는다. */
function seededPalette(seed: string) {
  const hue = Math.floor(hash01(seed, 1) * 360);
  const hairHue = (hue + 150 + Math.floor(hash01(seed, 2) * 60)) % 360;
  return {
    shirt: `hsl(${hue} 48% 56%)`,
    shirtShade: `hsl(${hue} 44% 44%)`,
    hair: `hsl(${hairHue} 26% 24%)`,
    skin: `hsl(28 40% ${66 + Math.floor(hash01(seed, 3) * 10)}%)`,
  };
}

export function Avatar({
  seed,
  facing,
  step,
  size = AVATAR_SIZE,
}: {
  seed: string;
  facing: Facing;
  /** 걸을 때 0/1 로 번갈아 들어온다. 서 있으면 0. */
  step: 0 | 1;
  size?: number;
}) {
  const p = seededPalette(seed || "odysseus");
  const swing = step === 1 ? 3 : -3;
  const back = facing === "north";
  const sideways = facing === "east" || facing === "west";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      style={{ transform: facing === "west" ? "scaleX(-1)" : undefined, overflow: "visible" }}
    >
      <ellipse cx="16" cy="29" rx="7.5" ry="2.4" fill={CONTACT} />

      <rect x={12 + swing * 0.35} y="22" width="3.6" height="6" rx="1.6" fill={EDGE} />
      <rect x={16.4 - swing * 0.35} y="22" width="3.6" height="6" rx="1.6" fill={EDGE} />

      <rect x="9.5" y="13" width="13" height="10.5" rx="4.4" fill={p.shirt} />
      <rect x="9.5" y="19" width="13" height="4.5" rx="2.2" fill={p.shirtShade} />
      <rect x="9.5" y="13" width="13" height="1.2" rx=".6" fill={LIP} />

      <rect x="7.2" y={14.4 + swing * 0.3} width="3.2" height="7" rx="1.6" fill={p.shirtShade} />
      <rect x="21.6" y={14.4 - swing * 0.3} width="3.2" height="7" rx="1.6" fill={SHADE} />

      <circle cx="16" cy="9" r="6.1" fill={p.skin} />
      <path d="M9.9,10.4 a6.1,6.1 0 0 0 12.2,0 v2.2 h-12.2 Z" fill="rgba(2,6,23,.16)" />
      <path
        d={
          back
            ? "M9.9 9a6.1 6.1 0 0 1 12.2 0v3.4H9.9Z"
            : "M9.9 8.4a6.1 6.1 0 0 1 12.2 0v1.1c-2-1.6-4-2.3-6.1-2.3s-4.1.7-6.1 2.3Z"
        }
        fill={p.hair}
      />
      {!back && (
        <>
          <circle cx={sideways ? 17.4 : 13.8} cy="9.6" r="0.95" fill="#0F1626" />
          {!sideways && <circle cx="18.2" cy="9.6" r="0.95" fill="#0F1626" />}
        </>
      )}
    </svg>
  );
}

/** 방에 서 있는 동료 — 배정된 일이 없는 방이 텅 비어 보이지 않게 한다.
 *  대화 상대가 아니라 배경이므로 채도를 낮춰 아바타와 헷갈리지 않게 둔다. */
export function Bystander({ color }: { color: string }) {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true" focusable="false" style={{ overflow: "visible" }}>
      <ellipse cx="16" cy="29" rx="6.5" ry="2" fill={CONTACT} />
      <rect x="12" y="22" width="3.2" height="6" rx="1.4" fill={EDGE} />
      <rect x="16.8" y="22" width="3.2" height="6" rx="1.4" fill={EDGE} />
      <rect x="10.5" y="14" width="11" height="9.5" rx="4" fill={color} opacity=".55" />
      <rect x="10.5" y="19.5" width="11" height="4" rx="2" fill={color} opacity=".35" />
      <circle cx="16" cy="10" r="5.4" fill="hsl(28 30% 58%)" />
      <path d="M10.6 9.6a5.4 5.4 0 0 1 10.8 0v2.6H10.6Z" fill="#2C3346" />
    </svg>
  );
}
