import type { DepartmentId } from "@/lib/types";

/** 사무실 한 층 — 좌표와 배치에 관한 유일한 진실.
 *
 * 규칙 하나로 요약된다: **사람이 물건의 좌표를 타이핑하지 않는다.** 예전에는 자리를
 * 계산하는 함수와 소품을 손으로 박아 둔 목록이 따로 있었고, 둘이 같은 사각형에 서로를
 * 모른 채 겹쳐 썼다. 그래서 소품 열일곱 개가 하나도 빠짐없이 글자나 자리 위에 앉았다.
 * 좌표를 옮겨서는 고칠 수 없는 종류의 결함이라, 방을 칸으로 나누고 먼저 쓴 쪽이 칸을
 * 차지하게 했다. 이제 겹침은 표현할 수가 없다.
 *
 * 투영은 **정직한 탑다운**이다. 아이소메트릭으로 기울이지 않는다.
 *  - 마름모로 자른 버튼은 안에 들어가는 정사각형이 작아진다 — 같은 배율에서 28.5px 대
 *    39px 이라, 누를 수 있는 크기를 투영에 쓰는 셈이 된다.
 *  - 3D 변환된 요소의 히트 테스트는 명세에 정의가 없다(w3c/csswg-drafts#3997).
 *    Firefox 는 Chrome 이 받아 주는 클릭을 거부한다. 모든 자리가 진짜 버튼이어야 하는
 *    화면에서 감당할 수 없는 위험이다.
 *  - Gather·WorkAdventure·SkyOffice 도 전부 정사각 격자 탑다운이다(WorkAdventure 는
 *    아이소메트릭을 아예 지원하지 않는다). 그 제품들의 입체감은 기울기가 아니라
 *    **바닥은 정사각으로 두고 수직면만 윗면 + 어두운 앞면으로 그리는 데서** 온다.
 *    이 파일은 그 전제로 짜여 있다.
 */

/** 한 칸. 모든 치수가 이 배수다. */
export const TILE = 32;

export const WORLD = { width: 1280, height: 800 };

/** 복도 — 모든 방이 여기로 문을 낸다. 아바타는 이 띠 위를 걷는다. */
export const CORRIDOR = { top: 352, bottom: 448, left: 96, right: 1248 };
export const CORRIDOR_Y = (CORRIDOR.top + CORRIDOR.bottom) / 2;

/** 엘리베이터 — 왼쪽 벽에 박힌 샤프트와, 그 앞 복도의 대기 지점 */
export const ELEVATOR_CAR = { x: 0, y: 352, w: 96, h: 96 };
export const ELEVATOR = { x: 128, y: CORRIDOR_Y };

/** 복도 동쪽 끝을 막는 창 — 복도에 끝이 있다는 감각을 준다 */
export const WINDOW_BAY = { x: 1248, y: 352, w: 32, h: 96 };

/** 방 하나의 바깥 치수(벽 포함). 여덟 방이 전부 같다.
 *
 *  크기를 다르게 하고 싶은 유혹이 있지만, 같아야 배치기 하나가 여덟 방을 다 맡고
 *  검증 하나가 여덟 방을 다 덮는다. 방의 개성은 크기가 아니라 바닥과 문패가 낸다. */
export const ROOM = { w: 8 * TILE, h: 10 * TILE };

/** 벽이 차지하는 칸 = 한 칸. 방의 가장 바깥 고리에는 가구를 놓지 않는다. */
export const WALL = TILE;

/** 실제로 **그리는** 벽 두께. 칸(32)을 그대로 칠하면 옆방과 맞닿은 자리가 64px 짜리
 *  어두운 홈이 되어, 한 층이 아니라 상자 여덟 개로 보인다. 칸막이는 얇게 그리고
 *  남는 반 칸은 벽과 가구 사이의 여유로 남긴다. */
export const WALL_DRAW = 16;

/** 문 폭 = 두 칸. 복도 쪽 벽 한가운데가 뚫려 있다. */
export const DOOR_WIDTH = 2 * TILE;

export const INNER_COLS = 6;
export const INNER_ROWS = 8;

/** 자리 하나의 크기(월드 px). 가장 좁은 창에서도 39 CSS px 이라
 *  WCAG 2.5.8 의 24×24 를 넘는다. */
export const DESK_SIZE = 64;

/** 이 배율보다 작아지면 층 화면을 아예 제안하지 않고 목록으로 보여 준다.
 *  (64 × 0.42 ≒ 27 CSS px — 여기가 바닥이다.) */
export const MIN_SPATIAL_FIT = 0.42;

/** 한 방에 놓을 수 있는 자리 수. 넘치면 줄여 끼우지 않고 목록으로 흘린다 —
 *  예전의 '눌러 넣기'가 겹침을 만든 장본인이다. */
export const DESK_CAPACITY = 6;

export type PropKind =
  | "plant"
  | "cooler"
  | "cabinet"
  | "printer"
  | "shelf"
  | "sofa"
  | "colleague";

export interface Room {
  id: DepartmentId;
  x: number;
  y: number;
  side: "north" | "south";
  /** 문패·문턱·러그·불 켜진 화면에만 쓰는 색. 바닥을 이 색으로 칠하지 않는다. */
  accent: string;
  /** 카펫 — 여덟 방의 밝기 차가 1 미만이라 맞붙어 있을 때만 다름을 알아본다.
   *  건물 하나로 보이게 하는 값이다. */
  floor: string;
  /** 이 방에 놓을 소품의 종류. **위치는 적지 않는다** — 배치기가 정한다. */
  propKinds: PropKind[];
}

export const ROOMS: Record<DepartmentId, Room> = {
  dev: { id: "dev", x: 128, y: 32, side: "north", accent: "#62A8C8", floor: "#20304a", propKinds: ["shelf", "plant", "cooler"] },
  product: { id: "product", x: 384, y: 32, side: "north", accent: "#9B8FD1", floor: "#232e4c", propKinds: ["plant", "shelf", "printer"] },
  planning: { id: "planning", x: 640, y: 32, side: "north", accent: "#8496D6", floor: "#222e4c", propKinds: ["cabinet", "plant", "printer"] },
  finance: { id: "finance", x: 896, y: 32, side: "north", accent: "#6DBBA0", floor: "#1e3244", propKinds: ["cabinet", "shelf", "plant"] },
  hr: { id: "hr", x: 128, y: 448, side: "south", accent: "#D28FA0", floor: "#2a2c46", propKinds: ["sofa", "plant", "cooler"] },
  ga: { id: "ga", x: 384, y: 448, side: "south", accent: "#C9A96A", floor: "#2b2c3e", propKinds: ["printer", "cabinet", "shelf"] },
  ops: { id: "ops", x: 640, y: 448, side: "south", accent: "#6FBDB4", floor: "#1e3245", propKinds: ["cabinet", "printer", "plant"] },
  cs: { id: "cs", x: 896, y: 448, side: "south", accent: "#C58FC9", floor: "#2a2b4a", propKinds: ["cooler", "plant", "sofa"] },
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

/** 방 안쪽 바닥의 왼쪽 위 모서리 */
export function innerOrigin(room: Room): { x: number; y: number } {
  return { x: room.x + WALL, y: room.y + WALL };
}

/** 문 한가운데 — 복도 쪽 벽면 위의 점. 걷기 경로의 마지막 꺾임이다. */
export function doorOf(room: Room): { x: number; y: number } {
  return {
    x: room.x + ROOM.w / 2,
    y: room.side === "north" ? room.y + ROOM.h : room.y,
  };
}

/** 방에 들어가 서는 자리 — 문에서 두 칸 안쪽, 통로 한가운데.
 *  통로는 언제나 비어 있으므로 아바타가 가구를 밟고 서는 일이 없다. */
export function standingSpotOf(room: Room): { x: number; y: number } {
  const inner = innerOrigin(room);
  return {
    x: room.x + ROOM.w / 2,
    y: room.side === "north" ? inner.y + 6.5 * TILE : inner.y + 1.5 * TILE,
  };
}

// ── 방 안 배치 ──────────────────────────────────────────────────
//
// 칸 상태. 먼저 쓴 쪽이 임자다.
const EMPTY = 0;
const WALK = 1; // 통로 — 사람이 지나는 칸. 아무것도 놓지 않는다
const DESK = 2;
const CHAIR = 3;
const CLEAR = 4; // 자리 앞 여유 — 걸을 수는 있지만 물건은 못 놓는다
const PROP = 5;

const cellIndex = (c: number, r: number) => r * INNER_COLS + c;

export interface DeskSlot {
  index: number;
  bank: "left" | "right";
  /** 자리 버튼의 왼쪽 위 (월드 좌표) */
  x: number;
  y: number;
  /** 의자를 그릴 x 오프셋 — 통로를 향한 쪽 */
  chairOffsetX: number;
}

export interface PlacedProp {
  kind: PropKind;
  x: number;
  y: number;
  /** React key 를 안정시키기 위한 칸 번호 */
  cell: number;
}

export interface RoomLayout {
  room: Room;
  desks: DeskSlot[];
  /** 방에 다 못 들어간 시험 수 — 목록 쪽으로 흘려보낸다 */
  overflow: number;
  props: PlacedProp[];
  /** 벽에 거는 화이트보드 (바닥 칸을 쓰지 않는다) */
  board: { x: number; y: number; w: number; h: number };
  /** 바닥에 눕히는 부서 이름 */
  decal: { x: number; y: number; w: number; h: number };
  grid: Uint8Array;
}

/** 여섯 자리의 고정 배치.
 *
 *  왼쪽·오른쪽 두 줄로 나누고 의자는 언제나 통로를 향한 칸에 둔다. 그래야 어느
 *  자리든 통로에서 바로 앉을 수 있고, 등받이가 늘 보는 쪽을 향해 그림이 일관된다. */
const SLOTS: { bank: "left" | "right"; col: number; slabRow: number }[] = [
  { bank: "left", col: 0, slabRow: 1 },
  { bank: "right", col: 4, slabRow: 1 },
  { bank: "left", col: 0, slabRow: 3 },
  { bank: "right", col: 4, slabRow: 3 },
  { bank: "left", col: 0, slabRow: 5 },
  { bank: "right", col: 4, slabRow: 5 },
];

function asciiDump(grid: Uint8Array): string {
  const glyph = [".", " ", "D", "H", "-", "P"];
  const lines: string[] = [];
  for (let r = 0; r < INNER_ROWS; r += 1) {
    let line = "";
    for (let c = 0; c < INNER_COLS; c += 1) line += `${glyph[grid[cellIndex(c, r)]]} `;
    lines.push(line);
  }
  return lines.join("\n");
}

/**
 * 방 하나를 배치한다.
 *
 * 순서가 곧 보증이다.
 *  1. **가구보다 먼저 통로를 판다.** 나중에 검사하는 대신 구조로 막는다.
 *  2. 자리가 칸과 앞 여유를 가져간다.
 *  3. 벽에 거는 물건은 바닥 칸을 안 쓴다.
 *  4. 남은 칸 중 **벽에 붙어 있고 통로에 닿는** 칸에만 소품을 놓는다.
 *  5. 문에서 모든 자리에 실제로 닿는지 훑어서 증명한다.
 *
 * 난수를 쓰지 않는다 — 서버가 그린 것과 브라우저가 그린 것이 한 픽셀도 달라지면
 * 안 되기 때문이다.
 */
export function layoutRoom(room: Room, assignmentCount: number): RoomLayout {
  const grid = new Uint8Array(INNER_COLS * INNER_ROWS);
  const north = room.side === "north";
  const inner = innerOrigin(room);
  const apronRow = north ? INNER_ROWS - 1 : 0; // 문 쪽 여유 줄
  const backRow = north ? 0 : INNER_ROWS - 1; // 안쪽 끝 줄 — 부서 이름을 눕히는 곳
  const doorCell = { c: 2, r: apronRow };

  const put = (c: number, r: number, v: number) => {
    const i = cellIndex(c, r);
    if (process.env.NODE_ENV !== "production" && grid[i] !== EMPTY && grid[i] !== v) {
      throw new Error(`[office] ${room.id} 칸 (${c},${r}) 이 두 번 쓰였다\n${asciiDump(grid)}`);
    }
    grid[i] = v;
  };

  // 1. 통로 — 문과 같은 줄에 세로로, 그리고 안쪽 끝에 가로로.
  for (let r = 0; r < INNER_ROWS; r += 1) {
    put(2, r, WALK);
    put(3, r, WALK);
  }
  for (let c = 0; c < INNER_COLS; c += 1) put(c, backRow, WALK);

  // 2. 자리
  const desks: DeskSlot[] = [];
  const placed = Math.min(assignmentCount, DESK_CAPACITY);
  for (let i = 0; i < placed; i += 1) {
    const slot = SLOTS[i];
    put(slot.col, slot.slabRow, DESK);
    put(slot.col + 1, slot.slabRow, DESK);
    const chairCol = slot.bank === "left" ? slot.col + 1 : slot.col;
    const clearCol = slot.bank === "left" ? slot.col : slot.col + 1;
    put(chairCol, slot.slabRow + 1, CHAIR);
    put(clearCol, slot.slabRow + 1, CLEAR);
    desks.push({
      index: i,
      bank: slot.bank,
      x: inner.x + slot.col * TILE,
      y: inner.y + slot.slabRow * TILE,
      chairOffsetX: (chairCol - slot.col) * TILE,
    });
  }

  // 3. 벽걸이
  const board = {
    x: room.x + (north ? 3 * TILE : TILE / 2),
    y: room.y + 14,
    w: 2 * TILE,
    h: 20,
  };

  // 4. 소품 — 벽에 붙고 통로에 닿는 빈 칸만
  const wallSides = (c: number, r: number) =>
    (c === 0 ? 1 : 0) +
    (c === INNER_COLS - 1 ? 1 : 0) +
    (r === 0 ? 1 : 0) +
    (r === INNER_ROWS - 1 ? 1 : 0);
  const walkable = (c: number, r: number) => {
    if (c < 0 || c >= INNER_COLS || r < 0 || r >= INNER_ROWS) return false;
    const v = grid[cellIndex(c, r)];
    return v === EMPTY || v === WALK || v === CLEAR;
  };

  const candidates: { c: number; r: number; score: number }[] = [];
  for (let r = 0; r < INNER_ROWS; r += 1) {
    for (let c = 0; c < INNER_COLS; c += 1) {
      if (grid[cellIndex(c, r)] !== EMPTY) continue;
      const walls = wallSides(c, r);
      if (walls === 0) continue; // 소품은 벽에 붙는다
      const touchesWalkway = [
        [c - 1, r],
        [c + 1, r],
        [c, r - 1],
        [c, r + 1],
      ].some(([a, b]) => walkable(a, b));
      if (!touchesWalkway) continue;
      const distance = Math.abs(c - doorCell.c) + Math.abs(r - doorCell.r);
      candidates.push({ c, r, score: 2 * walls + (walls >= 2 ? 3 : 0) - 0.05 * distance });
    }
  }
  // 동점은 칸 번호로 끊는다 — 정렬이 흔들리면 서버와 브라우저가 달라진다
  candidates.sort((a, b) => b.score - a.score || a.r - b.r || a.c - b.c);

  const kinds: PropKind[] =
    assignmentCount === 0 ? ["colleague", ...room.propKinds] : room.propKinds;
  const want = Math.min(Math.max(Math.floor(candidates.length / 3), 2), 4);
  const props: PlacedProp[] = [];
  let kindIndex = 0;
  for (const cell of candidates) {
    if (props.length >= want) break;
    if (grid[cellIndex(cell.c, cell.r)] !== EMPTY) continue;
    const kind = kinds[kindIndex % kinds.length];
    if (kind === "sofa") {
      const right = cell.c + 1;
      if (right >= INNER_COLS || grid[cellIndex(right, cell.r)] !== EMPTY) {
        kindIndex += 1;
        continue;
      }
      put(right, cell.r, PROP);
    }
    put(cell.c, cell.r, PROP);
    props.push({
      kind,
      x: inner.x + cell.c * TILE,
      y: inner.y + cell.r * TILE,
      cell: cellIndex(cell.c, cell.r),
    });
    kindIndex += 1;
  }

  // 5. 문에서 모든 자리에 닿는가 — 가정하지 않고 훑어서 확인한다
  const reached = new Set<number>();
  const frontier = [cellIndex(doorCell.c, doorCell.r)];
  reached.add(frontier[0]);
  while (frontier.length) {
    const cur = frontier.shift() as number;
    const cc = cur % INNER_COLS;
    const rr = (cur - cc) / INNER_COLS;
    for (const [a, b] of [
      [cc - 1, rr],
      [cc + 1, rr],
      [cc, rr - 1],
      [cc, rr + 1],
    ]) {
      if (!walkable(a, b)) continue;
      const n = cellIndex(a, b);
      if (reached.has(n)) continue;
      reached.add(n);
      frontier.push(n);
    }
  }
  const everyDeskReachable = desks.every((d) => {
    const slot = SLOTS[d.index];
    const chairCol = slot.bank === "left" ? slot.col + 1 : slot.col;
    const chairRow = slot.slabRow + 1;
    return [
      [chairCol - 1, chairRow],
      [chairCol + 1, chairRow],
      [chairCol, chairRow - 1],
      [chairCol, chairRow + 1],
    ].some(
      ([a, b]) =>
        a >= 0 && a < INNER_COLS && b >= 0 && b < INNER_ROWS && reached.has(cellIndex(a, b)),
    );
  });
  if (!everyDeskReachable && process.env.NODE_ENV !== "production") {
    throw new Error(`[office] ${room.id} 문에서 닿지 않는 자리가 있다\n${asciiDump(grid)}`);
  }

  return {
    room,
    desks,
    overflow: Math.max(0, assignmentCount - DESK_CAPACITY),
    props,
    board,
    decal: { x: inner.x, y: inner.y + backRow * TILE, w: INNER_COLS * TILE, h: TILE },
    grid,
  };
}

/** 벽 한 채를 이루는 네 개의 띠. 모서리는 계산해서 나오지 손으로 놓지 않는다.
 *  문이 있는 쪽은 두 토막으로 갈라지고, 그 사이가 곧 문이다.
 *
 *  `face` 는 남향면(앞면)을 그릴지 여부다. 광원이 화면 위에 있으므로 남쪽을 보는
 *  면만 어둡게 서 있고, 그 한 겹이 벽에 두께를 준다. */
export function wallRuns(
  room: Room,
): { x: number; y: number; w: number; h: number; face: boolean }[] {
  const doorStart = room.x + (ROOM.w - DOOR_WIDTH) / 2;
  const doorEnd = doorStart + DOOR_WIDTH;
  const runs: { x: number; y: number; w: number; h: number; face: boolean }[] = [];

  const horizontal = (y: number, isDoorSide: boolean, face: boolean) => {
    if (!isDoorSide) {
      runs.push({ x: room.x, y, w: ROOM.w, h: WALL_DRAW, face });
      return;
    }
    runs.push({ x: room.x, y, w: doorStart - room.x, h: WALL_DRAW, face });
    runs.push({ x: doorEnd, y, w: room.x + ROOM.w - doorEnd, h: WALL_DRAW, face });
  };

  horizontal(room.y, room.side === "south", true);
  horizontal(room.y + ROOM.h - WALL_DRAW, room.side === "north", true);
  runs.push({ x: room.x, y: room.y, w: WALL_DRAW, h: ROOM.h, face: false });
  runs.push({ x: room.x + ROOM.w - WALL_DRAW, y: room.y, w: WALL_DRAW, h: ROOM.h, face: false });
  return runs;
}

/** 문턱 — 문 사이 바닥에 깔리는 부서 색 띠 */
export function thresholdOf(room: Room): { x: number; y: number; w: number; h: number } {
  return {
    x: room.x + (ROOM.w - DOOR_WIDTH) / 2,
    y: room.side === "north" ? room.y + ROOM.h - WALL_DRAW : room.y + WALL_DRAW - 4,
    w: DOOR_WIDTH,
    h: 4,
  };
}
