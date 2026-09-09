import type { DepartmentId } from "@/lib/types";

/** 사무실 한 층의 평면도 — 좌표에 관한 유일한 진실.
 *
 * 편집기(Tiled·LDtk)나 타일맵을 쓰지 않는다. 방 여덟 개를 사람이 손으로 놓는 데
 * 에디터가 필요하지 않고, 에디터를 들이는 순간 GID 파서와 아틀라스 산술과 에셋
 * 파이프라인이 따라온다. 여기 있는 숫자가 곧 화면이다.
 *
 * 단위는 '월드 픽셀'이다. 화면 크기에 맞춰 통째로 배율만 바뀐다.
 */

export const WORLD = { width: 1280, height: 800 };

/** 복도 — 모든 방이 여기로 문을 낸다. 아바타는 이 띠 위를 걷는다. */
export const CORRIDOR = { top: 352, bottom: 448, left: 32, right: 1248 };

/** 복도의 중심선. 걷기 경로는 항상 이 높이를 거친다. */
export const CORRIDOR_Y = (CORRIDOR.top + CORRIDOR.bottom) / 2;

/** 엘리베이터 앞 — 출근하면 여기 서 있다. */
export const ELEVATOR = { x: 96, y: CORRIDOR_Y };

export interface Room {
  id: DepartmentId;
  /** 방의 사각형 (월드 좌표) */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 문이 복도의 위쪽에 있는가 아래쪽에 있는가 — 걷기 경로와 문 그림에 쓴다 */
  side: "north" | "south";
  /** 방 색 — Tailwind 동적 클래스는 v4 에서 만들어지지 않으므로 값으로 들고 다닌다 */
  accent: string;
  /** 바닥 타일 색 (accent 를 아주 옅게) */
  floor: string;
  /** 방에 놓인 소품 — 분위기용이라 의미를 싣지 않는다 */
  props: { x: number; y: number; glyph: string }[];
}

/** 방 여덟 개. 순서는 `departments.py` 의 DEPARTMENTS 와 같다. */
export const ROOMS: Record<DepartmentId, Room> = {
  dev: {
    id: "dev",
    x: 180,
    y: 24,
    width: 300,
    height: 328,
    side: "north",
    accent: "#38bdf8",
    floor: "#0f2537",
    props: [
      { x: 40, y: 44, glyph: "🖥️" },
      { x: 250, y: 60, glyph: "🪴" },
      { x: 44, y: 250, glyph: "☕" },
    ],
  },
  product: {
    id: "product",
    x: 496,
    y: 24,
    width: 220,
    height: 328,
    side: "north",
    accent: "#a78bfa",
    floor: "#1d1b3a",
    props: [
      { x: 36, y: 48, glyph: "📌" },
      { x: 168, y: 240, glyph: "🪴" },
    ],
  },
  planning: {
    id: "planning",
    x: 732,
    y: 24,
    width: 220,
    height: 328,
    side: "north",
    accent: "#818cf8",
    floor: "#181c3c",
    props: [
      { x: 40, y: 240, glyph: "📊" },
      { x: 168, y: 52, glyph: "🪴" },
    ],
  },
  finance: {
    id: "finance",
    x: 968,
    y: 24,
    width: 280,
    height: 328,
    side: "north",
    accent: "#34d399",
    floor: "#0d2b26",
    props: [
      { x: 44, y: 52, glyph: "🧮" },
      { x: 226, y: 246, glyph: "🗄️" },
    ],
  },
  hr: {
    id: "hr",
    x: 180,
    y: 448,
    width: 300,
    height: 328,
    side: "south",
    accent: "#fb7185",
    floor: "#2e1524",
    props: [
      { x: 44, y: 232, glyph: "🪴" },
      { x: 250, y: 60, glyph: "🗓️" },
    ],
  },
  ga: {
    id: "ga",
    x: 496,
    y: 448,
    width: 220,
    height: 328,
    side: "south",
    accent: "#fbbf24",
    floor: "#2c2110",
    props: [
      { x: 36, y: 236, glyph: "📠" },
      { x: 170, y: 56, glyph: "📦" },
    ],
  },
  ops: {
    id: "ops",
    x: 732,
    y: 448,
    width: 220,
    height: 328,
    side: "south",
    accent: "#2dd4bf",
    floor: "#0d2b2b",
    props: [
      { x: 38, y: 58, glyph: "🚚" },
      { x: 168, y: 238, glyph: "🪴" },
    ],
  },
  cs: {
    id: "cs",
    x: 968,
    y: 448,
    width: 280,
    height: 328,
    side: "south",
    accent: "#e879f9",
    floor: "#2c1435",
    props: [
      { x: 46, y: 240, glyph: "☎️" },
      { x: 228, y: 56, glyph: "🪴" },
    ],
  },
};

/** 표시 순서 — `Object.values` 의 순서에 기대지 않는다. */
export const ROOM_ORDER: DepartmentId[] = [
  "dev",
  "product",
  "planning",
  "finance",
  "hr",
  "ga",
  "ops",
  "cs",
];

export const DOOR_WIDTH = 76;

/** 방문 앞 복도 위의 한 점 — 걷기 경로의 마지막 꺾임. */
export function doorOf(room: Room): { x: number; y: number } {
  return {
    x: room.x + room.width / 2,
    y: room.side === "north" ? CORRIDOR.top : CORRIDOR.bottom,
  };
}

/** 방 안에서 아바타가 서는 자리 — 문 바로 안쪽. */
export function standingSpotOf(room: Room): { x: number; y: number } {
  const door = doorOf(room);
  // 책상 줄이 끝난 뒤의 빈 띠 — 아바타가 자리를 덮지 않도록 방 크기를 여기에 맞춰 잡았다.
  return { x: door.x, y: room.y + room.height - 30 };
}

/** 책상 배치 — 방 안쪽 여백에 격자로 놓는다.
 *
 * 자리 수는 배정된 시험 수에 따라 달라지므로, 몇 개가 오든 방 안에 들어가도록
 * 열 수를 폭에서 역산한다.
 *
 * 크기는 월드 좌표라 화면 배율(`fit`)이 곱해진다. 층 화면을 제안하는 가장 좁은
 * 창(가로 900px)에서도 자리 하나가 약 59×41 CSS px 이라 WCAG 2.5.8 의 24×24 를
 * 넘는다. 그보다 좁으면 애초에 목록 화면이 기본이고, 거기서는 자리가 전체 폭이다.
 */
export const DESK = { width: 112, height: 78, gapX: 14, gapY: 16 };

export function deskSlots(room: Room, count: number): { x: number; y: number }[] {
  if (count <= 0) return [];
  const padX = 22;
  const usable = room.width - padX * 2;
  const perRow = Math.max(1, Math.floor((usable + DESK.gapX) / (DESK.width + DESK.gapX)));
  const rows = Math.ceil(count / perRow);
  // 위로는 방 이름과 설명을, 문 쪽으로는 통로를 남긴다. 책상이 글자를 덮거나
  // 문을 막고 서 있으면 방으로 보이지 않는다.
  const topPad = room.side === "north" ? 92 : 104;
  const slots: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const inRow = Math.min(perRow, count - row * perRow);
    const rowWidth = inRow * DESK.width + (inRow - 1) * DESK.gapX;
    slots.push({
      x: room.x + (room.width - rowWidth) / 2 + col * (DESK.width + DESK.gapX),
      y: room.y + topPad + row * (DESK.height + DESK.gapY),
    });
  }
  // 줄이 방 밖으로 넘칠 만큼 많으면 마지막 줄들을 방 안으로 눌러 넣는다.
  const overflow = slots.length
    ? slots[slots.length - 1].y + DESK.height - (room.y + room.height - 24)
    : 0;
  if (overflow > 0 && rows > 1) {
    const squeeze = overflow / (rows - 1);
    return slots.map((s, i) => ({ x: s.x, y: s.y - Math.floor(i / perRow) * squeeze }));
  }
  return slots;
}
