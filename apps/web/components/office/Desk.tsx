"use client";

import type { MyAssignment } from "@/lib/types";
import { DEPARTMENT_LABEL } from "@/lib/format";

/** 자리 하나 = 시험 하나.
 *
 * 시나리오가 아니라 **시험**인 이유는 서버가 순차 진행을 강제하기 때문이다. 응시자는
 * 시험 안에서 문제를 고를 수 없고, 아직 도달하지 않은 문제는 서버가 잠근 채 지문조차
 * 내려 주지 않는다. 책상을 문제 단위로 놓으면 잠긴 자리만 늘어선 방이 된다.
 *
 * 공간 모드든 목록 모드든 **같은 `<button>`** 이다. 좌표만 붙었다 떨어진다.
 *
 * 방에 들어가기 전에는 이 버튼이 **자리에 앉히지 않고 방으로 데려간다.** 두 번에
 * 나눈 이유는 연출 때문이 아니라 안전 때문이다 — 응시를 시작하는 순간 서버가 마감
 * 시각을 박으므로, 지나가다 잘못 누른 한 번이 시험을 열어 버리면 되돌릴 수 없다.
 */
export function Desk({
  assignment,
  spatial,
  armed,
  left,
  top,
  width,
  height,
  busy,
  onStart,
  onEnterRoom,
}: {
  assignment: MyAssignment;
  spatial: boolean;
  /** 이 자리가 있는 방에 이미 들어와 있는가. 아니라면 누를 때 방으로 먼저 간다. */
  armed: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
  busy: boolean;
  onStart: () => void;
  onEnterRoom: () => void;
}) {
  const finished = Boolean(assignment.attempt_status && assignment.attempt_status !== "in_progress");
  const resuming = assignment.attempt_status === "in_progress";
  // 배포 중에는 새 화면이 옛 API 를 만날 수 있다 — 그때 이 필드는 아예 오지 않는다.
  const visiting = (assignment.departments ?? []).slice(1);

  const state = finished ? "응시 완료" : resuming ? "응시 중" : "빈자리";
  const action = finished
    ? "응시 완료"
    : !armed
      ? "가서 보기"
      : resuming
        ? "이어서 응시하기"
        : "이 자리에 앉기";

  return (
    <button
      type="button"
      onClick={armed ? onStart : onEnterRoom}
      onFocus={(e) => {
        // 키보드로 옮겨 온 포커스만 방 이동으로 친다. 마우스 클릭이 만든 포커스까지
        // 여기서 처리하면 focus 가 click 보다 먼저 도착하는 탓에 **한 번의 클릭이
        // '들어가기'와 '앉기'를 동시에 해 버린다** — 두 단계로 나눈 의미가 사라진다.
        try {
          if (e.currentTarget.matches(":focus-visible")) onEnterRoom();
        } catch {
          // :focus-visible 을 모르는 브라우저에서는 방을 따라 옮기지 않는다.
          // 자리에 앉는 것은 어차피 버튼을 눌러야 하므로 아무것도 잃지 않는다.
        }
      }}
      disabled={finished || busy}
      aria-label={
        `${assignment.title} — ${state}. 시나리오 ${assignment.scenario_count}개, 제한시간 ${assignment.duration_min}분.` +
        (armed || finished ? "" : " 누르면 이 자리로 갑니다 — 아직 시험은 시작되지 않습니다.")
      }
      className={[
        "office-desk group text-left",
        finished ? "office-desk-done" : "",
        resuming ? "office-desk-resume" : "",
        spatial ? "absolute" : "relative w-full",
      ].join(" ")}
      style={spatial ? { left, top, width, height } : undefined}
    >
      <span className="office-desk-top" aria-hidden="true">
        <span className="office-desk-monitor" />
        <span className="office-desk-chair" />
      </span>

      <span className="office-desk-body">
        <span className="office-desk-title">{assignment.title}</span>
        <span className="office-desk-meta">
          시나리오 {assignment.scenario_count}개 · {assignment.duration_min}분
        </span>
        {visiting.length > 0 && (
          <span className="office-desk-meta office-desk-visiting">
            {visiting.map((d) => DEPARTMENT_LABEL[d] ?? d).join("·")}까지 이어집니다
          </span>
        )}
        {!spatial && assignment.description && (
          <span className="office-desk-desc">{assignment.description}</span>
        )}
      </span>

      <span className={`office-desk-state office-desk-state-${finished ? "done" : resuming ? "resume" : "open"}`}>
        {busy ? "준비 중..." : action}
      </span>
    </button>
  );
}
