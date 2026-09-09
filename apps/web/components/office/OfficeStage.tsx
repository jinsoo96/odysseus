"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DepartmentId, MyAssignment } from "@/lib/types";
import { DEPARTMENT_LABEL } from "@/lib/format";
import { Avatar } from "./Avatar";
import { Desk } from "./Desk";
import { Sector } from "./Sector";
import { useWalk } from "./useWalk";
import {
  CORRIDOR,
  ELEVATOR,
  ROOMS,
  ROOM_ORDER,
  WORLD,
  standingSpotOf,
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
const ZOOM_IN = 1.55;

export function OfficeStage({
  spatial,
  assignments,
  seed,
  busyId,
  onStart,
  onAnnounce,
}: {
  spatial: boolean;
  assignments: MyAssignment[];
  seed: string;
  busyId: string | null;
  onStart: (assignment: MyAssignment) => void;
  onAnnounce: (message: string) => void;
}) {
  const [entered, setEntered] = useState<DepartmentId | null>(null);
  const [fit, setFit] = useState(1);
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

  /** 화면 폭에 맞춰 층 전체가 들어가도록 배율을 잡는다. */
  useEffect(() => {
    if (!spatial) return;
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      setFit(Math.min(rect.width / WORLD.width, rect.height / WORLD.height));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [spatial]);

  /** 목록 모드로 바꾸면 걷기를 멈추고 방에서 나온다 — 상태가 두 모드에 걸치지 않게. */
  useEffect(() => {
    if (!spatial) {
      stop();
      setEntered(null);
    }
  }, [spatial, stop]);

  const enter = (id: DepartmentId) => {
    if (!spatial || entered === id) return;
    setEntered(id);
    walkTo(standingSpotOf(ROOMS[id]));
    const count = byDepartment.map.get(id)?.length ?? 0;
    onAnnounce(
      count === 0
        ? `${DEPARTMENT_LABEL[id]}에 들어왔습니다. 배정된 시험이 없습니다.`
        : `${DEPARTMENT_LABEL[id]}에 들어왔습니다. 시험 ${count}개가 있습니다.`,
    );
  };

  const leave = () => {
    setEntered(null);
    walkTo(ELEVATOR);
    onAnnounce("복도로 나왔습니다.");
  };

  // 복도로 나가기는 Esc 로도 된다 — 공간 UI 에서 가장 먼저 눌러 보는 키다.
  useEffect(() => {
    if (!spatial || !entered) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spatial, entered]);

  const room = entered ? ROOMS[entered] : null;
  const scale = spatial ? fit * (room ? ZOOM_IN : 1) : 1;
  // 방에 들어가면 그 방을 화면 가운데로 민다. 복도에서는 층 전체를 가운데에 둔다.
  const focusX = room ? room.x + room.width / 2 : WORLD.width / 2;
  const focusY = room ? room.y + room.height / 2 : WORLD.height / 2;

  const sectors = ROOM_ORDER.map((id) => (
    <Sector
      key={id}
      room={ROOMS[id]}
      label={DEPARTMENT_LABEL[id] ?? id}
      summary={SECTOR_SUMMARY[id]}
      assignments={byDepartment.map.get(id) ?? []}
      spatial={spatial}
      entered={entered === id}
      busyId={busyId}
      onEnter={() => enter(id)}
      onStart={onStart}
    />
  ));

  if (!spatial) {
    return (
      <div className="office-list">
        {sectors}
        {byDepartment.lobby.length > 0 && (
          <LobbySection assignments={byDepartment.lobby} busyId={busyId} onStart={onStart} spatial={false} />
        )}
      </div>
    );
  }

  return (
    <div className="office-viewport" ref={viewportRef}>
      <div
        className="office-world"
        style={{
          width: WORLD.width,
          height: WORLD.height,
          transform: `translate(-50%, -50%) scale(${scale}) translate(${WORLD.width / 2 - focusX}px, ${WORLD.height / 2 - focusY}px)`,
        }}
      >
        {/* 복도 */}
        <div
          aria-hidden="true"
          className="office-corridor"
          style={{
            left: CORRIDOR.left,
            top: CORRIDOR.top,
            width: CORRIDOR.right - CORRIDOR.left,
            height: CORRIDOR.bottom - CORRIDOR.top,
          }}
        />
        {/* 엘리베이터 — 출근하는 자리 */}
        <div
          aria-hidden="true"
          className="office-elevator"
          style={{ left: ELEVATOR.x - 46, top: ELEVATOR.y - 42 }}
        >
          <span>▲▼</span>
          <em>엘리베이터</em>
        </div>

        {sectors}

        {/* 아바타 — 층 위를 걷는다. 장식이므로 스크린리더에서 감춘다. */}
        <div
          aria-hidden="true"
          className="office-avatar"
          style={{ left: pos.x - 22, top: pos.y - 34 }}
        >
          <Avatar seed={seed} facing={facing} step={step} />
        </div>
      </div>

      {byDepartment.lobby.length > 0 && (
        <div className="office-lobby-tray">
          <LobbySection assignments={byDepartment.lobby} busyId={busyId} onStart={onStart} spatial={false} />
        </div>
      )}

      {entered && (
        <button type="button" className="office-leave" onClick={leave}>
          복도로 나가기 <kbd>Esc</kbd>
        </button>
      )}
    </div>
  );
}

/** 로비 — 부서가 정해지지 않은 시험이 놓이는 자리.
 *
 * 기본 제공 시나리오는 전부 부서가 있지만, 관리자가 직접 만든 시나리오는 부서 없이
 * 저장될 수 있다. 그런 시험이 화면에서 조용히 사라지면 응시자는 응시할 방법을 잃는다.
 */
function LobbySection({
  assignments,
  busyId,
  onStart,
  spatial,
}: {
  assignments: MyAssignment[];
  busyId: string | null;
  onStart: (assignment: MyAssignment) => void;
  spatial: boolean;
}) {
  return (
    <section aria-labelledby="sector-lobby" className="office-sector office-sector-lobby relative">
      <header className="office-sector-head">
        <span className="office-sector-mark" style={{ background: "#94a3b8" }} aria-hidden="true" />
        <h2 id="sector-lobby" className="office-sector-name">
          로비
        </h2>
        <span className="office-sector-count">아직 부서가 정해지지 않은 시험 {assignments.length}개</span>
      </header>
      <p className="office-sector-summary">부서를 지정하면 해당 팀의 방으로 옮겨집니다.</p>
      <ul className="office-desk-list">
        {assignments.map((a) => (
          <li key={a.assessment_id}>
            <Desk
              assignment={a}
              spatial={spatial}
              armed
              left={0}
              top={0}
              width={0}
              height={0}
              busy={busyId === a.assessment_id}
              onStart={() => onStart(a)}
              onEnterRoom={() => undefined}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
