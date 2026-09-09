"use client";

import type { MyAssignment } from "@/lib/types";
import { Desk } from "./Desk";
import { INNER_COLS, INNER_ROWS, TILE, innerOrigin, type RoomLayout } from "./floorplan";

/** 섹터 하나 = 부서 하나 = `<section>` 하나.
 *
 * **이 컴포넌트는 더 이상 건축물을 그리지 않는다.** 벽·바닥·러그·소품은 `OfficeStage`
 * 가 층 단위 레이어로 그린다. 이유는 z 순서다: 방이 자기 안에 벽을 들고 있으면, 그
 * 벽은 형제인 아바타 위로 절대 못 올라온다(쌓임 맥락에 갇힌다). 남쪽 방의 앞벽이
 * 아바타를 가려야 방에 '들어간' 것으로 보이는데, 그러려면 벽이 아바타의 형제여야 한다.
 *
 * 그래서 여기 남는 것은 **방 안쪽을 덮는 투명한 상호작용 영역**뿐이다. 벽을 눌러도
 * 아무 일이 없는 게 정직하다 — 거긴 걸어 들어갈 수 없는 곳이다.
 *
 * 공간 모드와 목록 모드가 **같은 트리**를 쓴다. 두 벌을 만들면 한쪽만 고치는 날이
 * 반드시 오고, 그때 목록으로 응시하는 사람이 조용히 뒤처진다.
 */
export function Sector({
  layout,
  label,
  summary,
  assignments,
  spatial,
  entered,
  busyId,
  onEnter,
  onStart,
  onPeek,
}: {
  layout: RoomLayout;
  label: string;
  summary: string;
  assignments: MyAssignment[];
  spatial: boolean;
  entered: boolean;
  busyId: string | null;
  onEnter: () => void;
  onStart: (assignment: MyAssignment) => void;
  onPeek: (assignment: MyAssignment | null) => void;
}) {
  const { room, desks } = layout;
  const inner = innerOrigin(room);
  const open = assignments.filter(
    (a) => a.attempt_status !== "submitted" && a.attempt_status !== "expired",
  );
  const headingId = `sector-${room.id}`;

  return (
    <section
      aria-labelledby={headingId}
      data-sector={room.id}
      data-entered={entered ? "true" : undefined}
      className={spatial ? "o-zone absolute" : "office-sector relative"}
      style={
        spatial
          ? {
              left: inner.x,
              top: inner.y,
              width: INNER_COLS * TILE,
              height: INNER_ROWS * TILE,
            }
          : { borderColor: `${room.accent}66` }
      }
    >
      {spatial ? (
        // 방 이름은 문패와 바닥 글자가 눈으로 알려 주고, 그 둘은 보조기술에서 감춰 둔다.
        // 여기 한 번만 남겨야 방 이름이 두 번 읽히지 않는다.
        <h2 id={headingId} className="sr-only">
          {label}
        </h2>
      ) : (
        <>
          <header className="office-sector-head">
            <span
              className="office-sector-mark"
              style={{ background: room.accent }}
              aria-hidden="true"
            />
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
        </>
      )}

      {assignments.length === 0 ? (
        !spatial && <p className="office-sector-empty">지금 이 부서에 배정된 시험이 없습니다.</p>
      ) : (
        <ul className={spatial ? "o-zone-slots" : "office-desk-list"}>
          {assignments.slice(0, desks.length).map((a, i) => (
            <li key={a.assessment_id}>
              <Desk
                assignment={a}
                spatial={spatial}
                armed={!spatial || entered}
                left={desks[i] ? desks[i].x - inner.x : 0}
                top={desks[i] ? desks[i].y - inner.y : 0}
                chairOffsetX={desks[i] ? desks[i].chairOffsetX : 0}
                busy={busyId === a.assessment_id}
                onStart={() => onStart(a)}
                onEnterRoom={onEnter}
                onPeek={onPeek}
              />
            </li>
          ))}
          {/* 자리보다 시험이 많으면 줄여 끼우지 않는다 — 줄여 끼우는 것이 겹침을
              만들던 장본인이다. 남는 것은 목록 쪽에서 같은 버튼으로 뜬다. */}
          {!spatial &&
            assignments.slice(desks.length).map((a) => (
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
                  onEnterRoom={onEnter}
                  onPeek={onPeek}
                />
              </li>
            ))}
        </ul>
      )}

      {/* 방 안 빈 바닥을 누르면 들어간다. 자리보다 아래에 깔려 자리 클릭을 가로채지 않고,
          자리 목록은 클릭을 흘려보내므로 바닥이 실제로 눌린다. */}
      {spatial && !entered && (
        <button
          type="button"
          className="o-zone-enter"
          onClick={onEnter}
          aria-label={`${label}에 들어가기. ${
            assignments.length === 0 ? "배정된 시험 없음" : `시험 ${assignments.length}개`
          }.`}
        />
      )}
    </section>
  );
}
