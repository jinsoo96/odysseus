"use client";

/** 응시자 아바타 — 그림 파일 없이 코드로 그린다.
 *
 * 타일셋을 받아 넣지 않는 이유는 두 가지다. 이 저장소는 MIT 인데 무료 에셋 대부분이
 * 재배포나 share-alike 조건을 달고 있어 `git clone` 자체가 조건에 걸리고, 웹 이미지는
 * Monaco 를 자체 호스팅하면서까지 지켜 온 폐쇄망 배포 원칙(외부에서 아무것도 받지
 * 않는다)을 다시 흔든다. 그려서 만들면 배포하는 아트가 없으므로 지킬 조건도 없다.
 *
 * 외형은 사용자 id 에서 결정론적으로 나온다. 고르는 화면을 만들지 않는다 —
 * 아바타는 평가에 쓰이지 않으므로, 시험 앞에 꾸미기 단계를 세울 이유가 없다.
 */

export type Facing = "north" | "south" | "east" | "west";

/** 문자열 → 0..1. 같은 사람이면 언제 어디서 봐도 같은 색이 되게. */
function hash01(seed: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** 채도·명도를 고정해 어떤 씨앗이 와도 어두운 바닥 위에서 읽히게 한다. */
function seededPalette(seed: string) {
  const hue = Math.floor(hash01(seed, 1) * 360);
  const hairHue = (hue + 150 + Math.floor(hash01(seed, 2) * 60)) % 360;
  return {
    shirt: `hsl(${hue} 62% 58%)`,
    shirtShade: `hsl(${hue} 58% 46%)`,
    hair: `hsl(${hairHue} 28% 26%)`,
    skin: `hsl(28 42% ${68 + Math.floor(hash01(seed, 3) * 12)}%)`,
  };
}

export function Avatar({
  seed,
  facing,
  step,
  size = 44,
  label,
}: {
  seed: string;
  facing: Facing;
  /** 걸을 때 0/1 로 번갈아 들어온다. 서 있으면 0. */
  step: 0 | 1;
  size?: number;
  label?: string;
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
      role="img"
      aria-label={label ?? "응시자 아바타"}
      style={{ transform: facing === "west" ? "scaleX(-1)" : undefined, overflow: "visible" }}
    >
      {/* 바닥 그림자 — 아바타가 바닥에 붙어 보이게 하는 유일한 단서 */}
      <ellipse cx="16" cy="29" rx="7.5" ry="2.4" fill="rgba(2,6,23,0.45)" />

      {/* 다리 — 걸을 때만 어긋난다 */}
      <rect x={12 + swing * 0.35} y="22" width="3.6" height="6" rx="1.6" fill="#1e293b" />
      <rect x={16.4 - swing * 0.35} y="22" width="3.6" height="6" rx="1.6" fill="#1e293b" />

      {/* 몸통 */}
      <rect x="9.5" y="13" width="13" height="10.5" rx="4.4" fill={p.shirt} />
      <rect x="9.5" y="19" width="13" height="4.5" rx="2.2" fill={p.shirtShade} />

      {/* 팔 */}
      <rect x={7.2} y={14.4 + swing * 0.3} width="3.2" height="7" rx="1.6" fill={p.shirtShade} />
      <rect x={21.6} y={14.4 - swing * 0.3} width="3.2" height="7" rx="1.6" fill={p.shirtShade} />

      {/* 머리 */}
      <circle cx="16" cy="9" r="6.1" fill={p.skin} />
      {/* 머리카락 — 뒤를 보면 뒤통수만 보인다 */}
      <path
        d={back ? "M9.9 9a6.1 6.1 0 0 1 12.2 0v3.4H9.9Z" : "M9.9 8.4a6.1 6.1 0 0 1 12.2 0v1.1c-2-1.6-4-2.3-6.1-2.3s-4.1.7-6.1 2.3Z"}
        fill={p.hair}
      />
      {/* 얼굴 — 뒤통수일 때는 그리지 않는다 */}
      {!back && (
        <>
          <circle cx={sideways ? 17.4 : 13.8} cy="9.6" r="0.95" fill="#1e293b" />
          {!sideways && <circle cx="18.2" cy="9.6" r="0.95" fill="#1e293b" />}
        </>
      )}
    </svg>
  );
}

/** 방 안에 서 있는 동료 — 시나리오 등장인물의 색을 그대로 쓴다.
 *  대화 상대가 아니라 방이 비어 보이지 않게 하는 배경이다. */
export function Bystander({ color, glyph }: { color: string; glyph?: string }) {
  return (
    <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true" style={{ overflow: "visible" }}>
      <ellipse cx="16" cy="29" rx="6.5" ry="2" fill="rgba(2,6,23,0.4)" />
      <rect x="10.5" y="14" width="11" height="9.5" rx="4" fill={color} opacity="0.92" />
      <circle cx="16" cy="10" r="5.4" fill={color} opacity="0.75" />
      {glyph && (
        <text x="16" y="12.4" textAnchor="middle" fontSize="6" fill="#0b1020">
          {glyph}
        </text>
      )}
    </svg>
  );
}
