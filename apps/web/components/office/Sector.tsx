"use client";

import type { MyAssignment } from "@/lib/types";
import { Bystander } from "./Avatar";
import { Desk } from "./Desk";
import { DESK, Room, deskSlots } from "./floorplan";

/** 섹터 하나 = 부서 하나 = `<section>` 하나.
 *
 * 공간 모드와 목록 모드가 **같은 트리**를 쓴다. 두 벌을 만들면 한쪽만 고치는 날이
 * 반드시 오고, 그때 목록 모드로 응시하는 사람이 조용히 뒤처진다. 여기서 갈라지는 것은
 * 좌표뿐이다.
 */
export function Sector({
  room,
  label,
  summary,
  assignments,
  spatial,
  entered,
  busyId,
  onEnter,
  onStart,
}: {
  room: Room;
  label: string;
  summary: string;
  assignments: MyAssignment[];
  spatial: boolean;
  entered: boolean;
  busyId: string | null;
  onEnter: () => void;
  onStart: (assignment: MyAssignment) => void;
}) {
  const slots = deskSlots(room, assignments.length);
  const open = assignments.filter((a) => a.attempt_status !== "submitted" && a.attempt_status !== "expired");
  const headingId = `sector-${room.id}`;

  return (
    <section
      aria-labelledby={headingId}
      data-sector={room.id}
      data-entered={entered ? "true" : undefined}
      className={`office-sector ${spatial ? "absolute" : "relative"}`}
      style={
        spatial
          ? {
              left: room.x,
              top: room.y,
              width: room.width,
              height: room.height,
              background: room.floor,
              borderColor: entered ? room.accent : `${room.accent}55`,
              boxShadow: entered ? `0 0 0 2px ${room.accent}, 0 0 42px -8px ${room.accent}` : undefined,
            }
          : { borderColor: `${room.accent}66` }
      }
    >
      {/* 문 — 복도 쪽 벽에 난 틈 */}
      {spatial && (
        <span
          aria-hidden="true"
          className={`office-door office-door-${room.side}`}
          style={{ background: room.accent }}
        />
      )}

      <header className="office-sector-head">
        <span className="office-sector-mark" style={{ background: room.accent }} aria-hidden="true" />
        <h2 id={headingId} className="office-sector-name">
          {label}
        </h2>
        <span className="office-sector-count">
          {assignments.length === 0
            ? "배정된 일 없음"
            : open.length === 0
              ? `${assignments.length}개 모두 완료`
              : `할 일 ${open.length}개`}
        </span>
      </header>

      <p className="office-sector-summary">{summary}</p>

      {/* 소품 — 방이 비어 보이지 않게 하는 배경. 공간 모드에서만 그린다. */}
      {spatial &&
        room.props.map((prop, i) => (
          <span key={i} aria-hidden="true" className="office-prop" style={{ left: prop.x, top: prop.y }}>
            {prop.glyph}
          </span>
        ))}
      {spatial && assignments.length === 0 && (
        <span aria-hidden="true" className="office-bystander" style={{ left: room.width / 2 - 17, top: room.height / 2 }}>
          <Bystander color={room.accent} />
        </span>
      )}

      {assignments.length === 0 ? (
        <p className="office-sector-empty">
          {spatial ? "지금 이 방에 당신 자리는 없습니다." : "지금 이 부서에 배정된 시험이 없습니다."}
        </p>
      ) : (
        <ul className={spatial ? "office-desk-slots" : "office-desk-list"}>
          {assignments.map((a, i) => (
            <li key={a.assessment_id}>
              <Desk
                assignment={a}
                spatial={spatial}
                armed={!spatial || entered}
                left={slots[i] ? slots[i].x - room.x : 0}
                top={slots[i] ? slots[i].y - room.y : 0}
                width={DESK.width}
                height={DESK.height}
                busy={busyId === a.assessment_id}
                onStart={() => onStart(a)}
                onEnterRoom={onEnter}
              />
            </li>
          ))}
        </ul>
      )}

      {/* 방으로 들어가기 — 공간 모드에서 방 전체를 누를 수 있게 한다.
          책상보다 뒤에 깔리므로 책상 클릭을 가로채지 않는다. */}
      {spatial && !entered && (
        <button
          type="button"
          className="office-sector-enter"
          onClick={onEnter}
          aria-label={`${label}에 들어가기. ${assignments.length === 0 ? "배정된 시험 없음" : `시험 ${assignments.length}개`}.`}
        >
          <span className="office-sector-enter-hint">들어가기</span>
        </button>
      )}
    </section>
  );
}
