"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DepartmentId, MyAssignment } from "@/lib/types";
import { DEPARTMENT_LABEL } from "@/lib/format";
import { Avatar, AVATAR_SIZE, Bystander } from "./Avatar";
import { Desk, deskAction } from "./Desk";
import { Sector } from "./Sector";
import { OfficeSprites } from "./sprites";
import { useWalk } from "./useWalk";
import {
  CORRIDOR,
  DESK_SIZE,
  ELEVATOR,
  ELEVATOR_CAR,
  INNER_COLS,
  INNER_ROWS,
  MIN_SPATIAL_FIT,
  ROOM,
  ROOMS,
  ROOM_ORDER,
  TILE,
  WALL,
  WALL_DRAW,
  WINDOW_BAY,
  WORLD,
  innerOrigin,
  layoutRoom,
  standingSpotOf,
  thresholdOf,
  wallRuns,
  type Room,
  type RoomLayout,
} from "./floorplan";

/** 방 설명 — 서버 어휘와 같은 문장. 로그인 직후 바로 그려야 해서 요청을 더 하지 않는다. */
const SECTOR_SUMMARY: Record<DepartmentId, string> = {
  dev: "장애를 재현하고 원인을 찾아 고칩니다. 터미널과 IDE 가 있는 유일한 방입니다.",
  product: "부서 사이에 낀 요구를 정리해 무엇을 먼저 할지 정합니다.",
  planning: "숫자를 모아 결정을 만들고, 그 결정을 문서로 남깁니다.",
  finance: "예산과 정산 — 규정과 금액이 맞는지 끝까지 확인합니다.",
  hr: "사람 사이의 일. 일정과 갈등, 그리고 규정 안에서 쓸 수 있는 문장.",
  ga: "공간과 비품 — 조건을 모으면 답이 하나로 정해지는 일들입니다.",
  ops: "현장의 제약 안에서 실행 가능한 계획을 세웁니다.",
  cs: "고객에게 나가는 말. 확인된 사실만으로, 규정 안에서.",
};

/** 방 안까지 들어갔을 때의 배율. 이 이상 당기면 옆 방이 화면에서 사라져 길을 잃는다. */
const ZOOM_IN = 1.5;

/** 하단 바 높이 — 배율을 잡을 때 이만큼은 층이 아니라 바의 몫이다. */
const BAR_H = 72;

/** 소품 심볼과 그 심볼이 그려질 크기 (칸 기준) */
const PROP_ART: Record<string, { href: string; w: number; h: number; dy: number }> = {
  plant: { href: "#f-plant", w: 32, h: 36, dy: -4 },
  cooler: { href: "#f-cooler", w: 32, h: 40, dy: -8 },
  cabinet: { href: "#f-cabinet", w: 32, h: 44, dy: -12 },
  printer: { href: "#f-printer", w: 32, h: 34, dy: -2 },
  shelf: { href: "#f-shelf", w: 32, h: 48, dy: -16 },
  sofa: { href: "#f-sofa", w: 64, h: 40, dy: -8 },
};

export function OfficeStage({
  spatial,
  assignments,
  seed,
  busyId,
  onStart,
  onAnnounce,
  onTooNarrow,
}: {
  spatial: boolean;
  assignments: MyAssignment[];
  seed: string;
  busyId: string | null;
  onStart: (assignment: MyAssignment) => void;
  onAnnounce: (message: string) => void;
  /** 층을 그리기엔 화면이 좁을 때 — 페이지가 목록으로 돌린다 */
  onTooNarrow: () => void;
}) {
  const [entered, setEntered] = useState<DepartmentId | null>(null);
  const [peeked, setPeeked] = useState<MyAssignment | null>(null);
  const [fit, setFit] = useState(1);
  const [viewSize, setViewSize] = useState({ w: 0, h: 0 });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const { pos, facing, step, walkTo, stop } = useWalk();

  /** 시험을 부서별로 나눈다 — 첫 부서가 그 일이 시작되는 자리다. */
  const byDepartment = useMemo(() => {
    const map = new Map<DepartmentId, MyAssignment[]>();
    ROOM_ORDER.forEach((id) => map.set(id, []));
    const lobby: MyAssignment[] = [];
    assignments.forEach((a) => {
      const home = (a.departments?.[0] ?? "") as DepartmentId;
      const bucket = map.get(home);
      if (bucket) bucket.push(a);
      else lobby.push(a);
    });
    return { map, lobby };
  }, [assignments]);

  /** 방 배치는 한 번만 계산한다. 자리도 소품도 여기서 나온다 — 화면 어디에도
   *  좌표를 손으로 적어 둔 곳이 없다. */
  const layouts = useMemo(() => {
    const out = new Map<DepartmentId, RoomLayout>();
    ROOM_ORDER.forEach((id) => {
      out.set(id, layoutRoom(ROOMS[id], byDepartment.map.get(id)?.length ?? 0));
    });
    return out;
  }, [byDepartment]);

  /** 화면 폭에 맞춰 층 전체가 들어가도록 배율을 잡는다. */
  useEffect(() => {
    if (!spatial) return;
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      // 하단 바가 층을 가리지 않도록 그만큼 빼고 배율을 잡는다.
      const usableH = Math.max(160, rect.height - BAR_H);
      const next = Math.min(rect.width / WORLD.width, usableH / WORLD.height);
      setFit(next);
      setViewSize({ w: rect.width, h: usableH });
      // 자리가 눌리지 않을 만큼 작아지면 층을 고집하지 않는다.
      if (next < MIN_SPATIAL_FIT) onTooNarrow();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [spatial, onTooNarrow]);

  /** 목록 모드로 바꾸면 걷기를 멈추고 방에서 나온다 — 상태가 두 모드에 걸치지 않게. */
  useEffect(() => {
    if (!spatial) {
      stop();
      setEntered(null);
      setPeeked(null);
    }
  }, [spatial, stop]);

  const enter = useCallback(
    (id: DepartmentId) => {
      if (!spatial || entered === id) return;
      setEntered(id);
      walkTo(standingSpotOf(ROOMS[id]));
      const count = byDepartment.map.get(id)?.length ?? 0;
      onAnnounce(
        count === 0
          ? `${DEPARTMENT_LABEL[id]}에 들어왔습니다. 배정된 시험이 없습니다.`
          : `${DEPARTMENT_LABEL[id]}에 들어왔습니다. 시험 ${count}개가 있습니다.`,
      );
    },
    [spatial, entered, walkTo, byDepartment, onAnnounce],
  );

  const leave = useCallback(() => {
    setEntered(null);
    setPeeked(null);
    walkTo(ELEVATOR);
    onAnnounce("복도로 나왔습니다.");
  }, [walkTo, onAnnounce]);

  // Esc 는 두 단계다. 먼저 이름표를 접고, 그 다음에 복도로 나간다 — 떠 있는 정보를
  // 포커스를 옮기지 않고 닫을 수 있어야 한다는 요구(WCAG 1.4.13)를 이렇게 만족시킨다.
  useEffect(() => {
    if (!spatial) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (peeked) {
        setPeeked(null);
        return;
      }
      if (entered) leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spatial, entered, peeked, leave]);

  const room = entered ? ROOMS[entered] : null;
  const scale = spatial ? fit * (room ? ZOOM_IN : 1) : 1;
  // 카메라를 층 안에 가둔다. 가두지 않으면 가장자리 방에 들어갔을 때 화면 절반이
  // 건물 바깥의 빈 어둠이 된다 — 방에 들어간 게 아니라 떨어진 것처럼 보인다.
  const clamp = (v: number, half: number, span: number) =>
    half * 2 >= span ? span / 2 : Math.min(Math.max(v, half), span - half);
  const halfW = viewSize.w ? viewSize.w / scale / 2 : WORLD.width / 2;
  const halfH = viewSize.h ? viewSize.h / scale / 2 : WORLD.height / 2;
  const focusX = clamp(room ? room.x + ROOM.w / 2 : WORLD.width / 2, halfW, WORLD.width);
  const focusY = clamp(room ? room.y + ROOM.h / 2 : WORLD.height / 2, halfH, WORLD.height);
  // 월드와 이름표 레이어가 **같은 문자열**을 쓴다. 투영을 두 번 구현하면 반드시 어긋난다.
  const camera = `translate(-50%, calc(-50% - ${BAR_H / 2}px)) scale(${scale}) translate(${WORLD.width / 2 - focusX}px, ${WORLD.height / 2 - focusY}px)`;

  const sectors = ROOM_ORDER.map((id) => (
    <Sector
      key={id}
      layout={layouts.get(id) as RoomLayout}
      label={DEPARTMENT_LABEL[id] ?? id}
      summary={SECTOR_SUMMARY[id]}
      assignments={byDepartment.map.get(id) ?? []}
      spatial={spatial}
      entered={entered === id}
      busyId={busyId}
      onEnter={() => enter(id)}
      onStart={onStart}
      onPeek={setPeeked}
    />
  ));

  if (!spatial) {
    return (
      <div className="office-list">
        {sectors}
        {byDepartment.lobby.length > 0 && (
          <LobbySection assignments={byDepartment.lobby} busyId={busyId} onStart={onStart} />
        )}
      </div>
    );
  }

  const peekedArmed = Boolean(
    peeked && entered && (byDepartment.map.get(entered) ?? []).some((a) => a.assessment_id === peeked.assessment_id),
  );

  return (
    <div className="office-viewport" ref={viewportRef}>
      <OfficeSprites />

      {/* 0. 바닥판 — 건물 바닥, 복도, 엘리베이터, 창 */}
      <div className="office-world office-layer-base" style={{ ...worldBox, transform: camera }} aria-hidden="true">
        <div
          className="office-corridor"
          style={{
            left: CORRIDOR.left,
            top: CORRIDOR.top,
            width: CORRIDOR.right - CORRIDOR.left,
            height: CORRIDOR.bottom - CORRIDOR.top,
          }}
        />
        <div className="o-elevator" style={rect(ELEVATOR_CAR)}>
          <span className="o-elevator-leaf" />
          <span className="o-elevator-leaf" />
          <span className="o-elevator-call" />
        </div>
        <div className="o-window" style={rect(WINDOW_BAY)} />
      </div>

      {/* 1. 방 바닥 — 카펫, 러그, 바닥에 눕힌 부서 이름, 문턱 */}
      <div className="office-world office-layer-floor" style={{ ...worldBox, transform: camera }} aria-hidden="true">
        {ROOM_ORDER.map((id) => {
          const L = layouts.get(id) as RoomLayout;
          const inner = innerOrigin(L.room);
          return (
            <div key={id} style={{ ["--accent" as string]: L.room.accent }}>
              {/* 바닥은 방 전체를 덮는다 — 벽이 그 위에 얹혀야 벽과 바닥 사이에
                  틈이 생기지 않는다. */}
              <div
                className="o-floor"
                data-entered={entered === id ? "true" : undefined}
                style={{
                  left: L.room.x,
                  top: L.room.y,
                  width: ROOM.w,
                  height: ROOM.h,
                  background: L.room.floor,
                }}
              />
              <div className="o-decal" style={rect(L.decal)}>
                {DEPARTMENT_LABEL[id]}
              </div>
              <div className="o-threshold" style={rect(thresholdOf(L.room))} />
            </div>
          );
        })}
      </div>

      {/* 2. 아바타 뒤에 서는 건축물 — 북·동·서 벽과 벽걸이 */}
      <div className="office-world office-layer-back" style={{ ...worldBox, transform: camera }} aria-hidden="true">
        {ROOM_ORDER.map((id) => {
          const L = layouts.get(id) as RoomLayout;
          return (
            <div key={id} style={{ ["--accent" as string]: L.room.accent }}>
              {wallRuns(L.room)
                .filter((w) => !isFrontWall(w, L.room))
                .map((w, i) => (
                  <div key={i} className="o-wall" style={rect(w)}>
                    {w.face && <span className="o-wall-face" />}
                  </div>
                ))}
              <svg
                className="o-board"
                style={rect(L.board)}
                viewBox="0 0 64 20"
                preserveAspectRatio="none"
                color={L.room.accent}
              >
                <use href="#f-board" />
              </svg>
            </div>
          );
        })}
      </div>

      {/* 3. 소품 — 배치기가 정한 자리에만 선다 */}
      <div className="office-world office-layer-props" style={{ ...worldBox, transform: camera }} aria-hidden="true">
        {ROOM_ORDER.map((id) => {
          const L = layouts.get(id) as RoomLayout;
          return L.props.map((p) => {
            if (p.kind === "colleague") {
              return (
                <div key={`${id}-${p.cell}`} className="o-prop" style={{ left: p.x, top: p.y - 6 }}>
                  <Bystander color={L.room.accent} />
                </div>
              );
            }
            const art = PROP_ART[p.kind];
            if (!art) return null;
            return (
              <svg
                key={`${id}-${p.cell}`}
                className="o-prop"
                style={{ left: p.x, top: p.y + art.dy, width: art.w, height: art.h }}
                viewBox={`0 0 ${art.w} ${art.h}`}
              >
                <use href={art.href} />
              </svg>
            );
          });
        })}
      </div>

      {/* 4. 상호작용 — 방 영역과 자리 버튼 */}
      <div className="office-world office-layer-zones" style={{ ...worldBox, transform: camera }}>
        {sectors}
      </div>

      {/* 5. 아바타 */}
      <div className="office-world office-layer-actor" style={{ ...worldBox, transform: camera }} aria-hidden="true">
        <div
          className="office-avatar"
          style={{ left: pos.x - AVATAR_SIZE / 2, top: pos.y - AVATAR_SIZE + 6 }}
        >
          <Avatar seed={seed} facing={facing} step={step} />
        </div>
      </div>

      {/* 6. 아바타 앞에 서는 벽 — 방에 들어가면 머리가 이 벽 뒤로 사라진다.
             이 z 하나가 층에 높이를 준다. */}
      <div className="office-world office-layer-front" style={{ ...worldBox, transform: camera }} aria-hidden="true">
        {ROOM_ORDER.map((id) => {
          const L = layouts.get(id) as RoomLayout;
          return wallRuns(L.room)
            .filter((w) => isFrontWall(w, L.room))
            .map((w, i) => (
              <div key={`${id}-${i}`} className="o-wall" style={rect(w)}>
                {w.face && <span className="o-wall-face" />}
              </div>
            ));
        })}
      </div>

      {/* 7. 글자 레이어 — 카메라를 같이 타되 배율은 되돌린다.
             월드 안에 글자를 두면 층 배율만큼 작아져 읽을 수 없다. */}
      <div
        className="office-labels"
        style={{ transform: camera, ["--cam-scale" as string]: String(scale) }}
        aria-hidden="true"
      >
        {ROOM_ORDER.map((id) => {
          const L = layouts.get(id) as RoomLayout;
          const list = byDepartment.map.get(id) ?? [];
          const openCount = list.filter(
            (a) => a.attempt_status !== "submitted" && a.attempt_status !== "expired",
          ).length;
          const doorX = L.room.x + ROOM.w / 2;
          const doorY = L.room.side === "north" ? L.room.y + ROOM.h - WALL_DRAW : L.room.y + WALL_DRAW;
          return (
            <span
              key={id}
              className="office-sign"
              data-entered={entered === id ? "true" : undefined}
              style={{ left: doorX, top: doorY, ["--accent" as string]: L.room.accent }}
            >
              <i className="office-sign-chip" />
              {DEPARTMENT_LABEL[id]}
              <b className="office-sign-count">
                {list.length === 0 ? "비어 있음" : openCount === 0 ? "모두 완료" : `할 일 ${openCount}`}
              </b>
            </span>
          );
        })}

        {peeked && <Nameplate assignment={peeked} layouts={layouts} byDepartment={byDepartment} />}
      </div>

      {/* 8. 화면에 붙는 것들 — 배율을 타지 않는다 */}
      <div className="office-breadcrumb">
        <span>사무실</span>
        {entered && (
          <>
            <span className="office-breadcrumb-sep">›</span>
            <span className="office-breadcrumb-here">{DEPARTMENT_LABEL[entered]}</span>
            <button type="button" className="office-breadcrumb-out" onClick={leave}>
              복도로 나가기 <kbd>Esc</kbd>
            </button>
          </>
        )}
      </div>

      <div className="office-bar">
        <div className="office-legend" aria-hidden="true">
          <span>
            <i className="office-legend-dot" data-state="open" /> 빈자리
          </span>
          <span>
            <i className="office-legend-dot" data-state="resume" /> 응시 중
          </span>
          <span>
            <i className="office-legend-dot" data-state="done" /> 완료
          </span>
        </div>

        <div className="office-bar-detail">
          {peeked ? (
            <>
              <b>{peeked.title}</b>
              <span>
                시나리오 {peeked.scenario_count}개 · {peeked.duration_min}분
                {(peeked.departments ?? []).length > 1 &&
                  ` · ${(peeked.departments ?? [])
                    .slice(1)
                    .map((d) => DEPARTMENT_LABEL[d] ?? d)
                    .join("·")}까지 이어집니다`}
              </span>
            </>
          ) : entered ? (
            <span>{SECTOR_SUMMARY[entered]}</span>
          ) : (
            <span>부서 방으로 들어가 자리를 고르세요.</span>
          )}
        </div>

        {peeked && (
          <button
            type="button"
            className="office-bar-action"
            disabled={busyId === peeked.assessment_id}
            onClick={() => {
              const home = (peeked.departments?.[0] ?? "") as DepartmentId;
              if (peekedArmed) onStart(peeked);
              else if (ROOMS[home]) enter(home);
            }}
          >
            {busyId === peeked.assessment_id ? "준비 중..." : deskAction(peeked, peekedArmed)}
            <kbd>Enter</kbd>
          </button>
        )}
      </div>

      {byDepartment.lobby.length > 0 && (
        <div className="office-lobby-tray">
          <LobbySection assignments={byDepartment.lobby} busyId={busyId} onStart={onStart} />
        </div>
      )}
    </div>
  );
}

const worldBox = { width: WORLD.width, height: WORLD.height } as const;

function rect(r: { x: number; y: number; w: number; h: number }) {
  return { left: r.x, top: r.y, width: r.w, height: r.h };
}

/** 아바타 앞에 서야 하는 벽인가.
 *
 *  복도를 향한 쪽 벽 하나만 아바타 위에 그린다. 그래야 방으로 들어갈 때 머리가 그 벽
 *  뒤로 사라지고, 그 한 겹의 가림이 층에 높이를 준다. 나머지 벽은 전부 아바타 뒤다. */
function isFrontWall(w: { y: number; h: number }, room: Room): boolean {
  if (w.h !== WALL_DRAW) return false; // 세로 벽은 앞뒤가 갈리지 않는다
  return w.y === (room.side === "north" ? room.y + ROOM.h - WALL_DRAW : room.y);
}

/** 지금 보고 있는 자리 하나에만 뜨는 이름표.
 *  자리마다 붙이면 그건 다시 카드 격자다. 한 번에 하나가 규칙이다. */
function Nameplate({
  assignment,
  layouts,
  byDepartment,
}: {
  assignment: MyAssignment;
  layouts: Map<DepartmentId, RoomLayout>;
  byDepartment: { map: Map<DepartmentId, MyAssignment[]> };
}) {
  const home = (assignment.departments?.[0] ?? "") as DepartmentId;
  const layout = layouts.get(home);
  if (!layout) return null;
  const list = byDepartment.map.get(home) ?? [];
  const index = list.findIndex((a) => a.assessment_id === assignment.assessment_id);
  const slot = layout.desks[index];
  if (!slot) return null;
  return (
    <span className="office-plate" style={{ left: slot.x + DESK_SIZE / 2, top: slot.y - 6 }}>
      <b className="office-plate-title">{assignment.title}</b>
      <span className="office-plate-meta">
        시나리오 {assignment.scenario_count}개 · {assignment.duration_min}분
      </span>
    </span>
  );
}

/** 로비 — 부서가 정해지지 않은 시험이 놓이는 자리.
 *
 * 기본 제공 시나리오는 전부 부서가 있지만, 관리자가 직접 만든 시나리오는 부서 없이
 * 저장될 수 있다. 그런 시험이 화면에서 조용히 사라지면 응시할 방법을 잃는다.
 */
function LobbySection({
  assignments,
  busyId,
  onStart,
}: {
  assignments: MyAssignment[];
  busyId: string | null;
  onStart: (assignment: MyAssignment) => void;
}) {
  return (
    <section aria-labelledby="sector-lobby" className="office-sector office-sector-lobby relative">
      <header className="office-sector-head">
        <span className="office-sector-mark" style={{ background: "#94a3b8" }} aria-hidden="true" />
        <h2 id="sector-lobby" className="office-sector-name">
          로비
        </h2>
        <span className="office-sector-count">
          아직 부서가 정해지지 않은 시험 {assignments.length}개
        </span>
      </header>
      <p className="office-sector-summary">부서를 지정하면 해당 팀의 방으로 옮겨집니다.</p>
      <ul className="office-desk-list">
        {assignments.map((a) => (
          <li key={a.assessment_id}>
            <Desk
              assignment={a}
              spatial={false}
              armed
              left={0}
              top={0}
              chairOffsetX={0}
              busy={busyId === a.assessment_id}
              onStart={() => onStart(a)}
              onEnterRoom={() => undefined}
              onPeek={() => undefined}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
