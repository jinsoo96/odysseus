"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type { Attempt, MyAssignment } from "@/lib/types";
import { useUser, logout } from "@/components/useUser";
import { useToast } from "@/components/toast";
import { Spinner } from "@/components/ui";
import { OfficeStage } from "@/components/office/OfficeStage";

const VIEW_KEY = "odysseus:office-view";

/** 첫 화면을 무엇으로 열지.
 *
 * 기억해 둔 선택이 있으면 그것을 따르고, 없으면 **연출을 감당할 수 있는 화면인지**를
 * 보고 정한다. 좁은 화면과 `prefers-reduced-motion` 은 목록으로 연다 — 모바일로만
 * 지원하는 사람과 움직임에 약한 사람이 채용 화면에서 불리해질 이유가 없다.
 */
function initialSpatial(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    if (saved === "floor") return true;
    if (saved === "list") return false;
  } catch {
    // 저장소를 못 읽는 브라우저에서도 화면은 떠야 한다
  }
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  return window.innerWidth >= 900;
}

export default function OfficePage() {
  const { user, loading } = useUser(["candidate", "admin", "evaluator", "guest"]);
  const [assignments, setAssignments] = useState<MyAssignment[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [spatial, setSpatial] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  // 좁아서 목록으로 되돌린 적이 있으면, 그 창에서는 다시 층으로 튀어 오르지 않는다.
  const narrowedRef = useRef(false);
  const { toast } = useToast();
  const router = useRouter();

  const isStaff = user?.role === "admin" || user?.role === "evaluator";

  // 첫 렌더는 서버와 같아야 하므로(hydration), 화면 판단은 마운트 뒤에 한다.
  useEffect(() => setSpatial(initialSpatial()), []);

  useEffect(() => {
    if (!user) return;
    api
      .get<MyAssignment[]>("/my/assignments")
      .then(setAssignments)
      .catch((e) => setError(String(e.message)));
  }, [user]);

  /** 자리를 누를 수 없을 만큼 화면이 좁으면 층을 고집하지 않는다.
   *  채용 화면에서 공간 연출이 응시를 막는 일은 없어야 한다. */
  const handleTooNarrow = useCallback(() => {
    if (narrowedRef.current) return;
    narrowedRef.current = true;
    setSpatial(false);
    setAnnouncement("화면이 좁아 목록 화면으로 보여 줍니다.");
  }, []);

  const chooseView = (next: boolean) => {
    if (next) narrowedRef.current = false;
    setSpatial(next);
    try {
      localStorage.setItem(VIEW_KEY, next ? "floor" : "list");
    } catch {
      // 기억하지 못해도 이번 방문에는 적용된다
    }
  };

  /**
   * 자리에 앉는다 = 응시를 시작한다.
   *
   * `/dashboard` 의 시작 동작과 **같은 요청, 같은 이동**이다. 사무실은 시험을 고르는
   * 또 다른 방법일 뿐이고, 여기서부터 앞은 지금까지의 시험장 그대로다.
   */
  const start = useCallback(
    async (assignment: MyAssignment) => {
      if (assignment.attempt_status === "in_progress" && assignment.attempt_id) {
        router.push(`/exam/${assignment.attempt_id}`);
        return;
      }
      setBusyId(assignment.assessment_id);
      try {
        const attempt = await api.post<Attempt>(`/assessments/${assignment.assessment_id}/attempts`);
        router.push(`/exam/${attempt.id}`);
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "시작할 수 없습니다", "error");
        setBusyId(null);
      }
    },
    [router, toast],
  );

  if (loading || !user) return <Spinner label="불러오는 중..." />;

  return (
    <div className="office-page">
      <a href="#office-content" className="office-skip">
        사무실 화면을 건너뛰고 시험 목록으로 이동
      </a>

      <header className="office-header">
        <div className="min-w-0">
          <h1 className="text-lg font-black text-slate-100">
            Odysseus<span className="text-sky-400">.</span>
          </h1>
          <p className="mt-0.5 truncate text-xs text-slate-400">
            {user.name}님, 출근했습니다. 일이 있는 팀으로 가서 자리에 앉으세요.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="office-viewtoggle" role="group" aria-label="화면 보기 방식">
            <button
              type="button"
              onClick={() => chooseView(true)}
              aria-pressed={spatial}
              className={spatial ? "is-on" : ""}
            >
              사무실
            </button>
            <button
              type="button"
              onClick={() => chooseView(false)}
              aria-pressed={!spatial}
              className={!spatial ? "is-on" : ""}
            >
              목록
            </button>
          </div>
          <Link href="/dashboard" className="office-linkbtn">
            기본 화면
          </Link>
          {isStaff && (
            <Link href={user.role === "admin" ? "/admin/scenarios" : "/review"} className="office-linkbtn">
              관리자 콘솔
            </Link>
          )}
          <button type="button" className="office-ghostbtn" onClick={() => logout(router)}>
            로그아웃
          </button>
        </div>
      </header>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <main id="office-content" className="office-main">
        {error && <p className="office-error">{error}</p>}
        {!assignments ? (
          <Spinner />
        ) : assignments.length === 0 ? (
          <p className="office-empty">
            지금 배정된 시험이 없습니다. 사무실은 열려 있지만, 오늘 당신 자리는 아직 비어 있습니다.
          </p>
        ) : (
          <OfficeStage
            spatial={spatial}
            assignments={assignments}
            seed={user.id ?? user.name ?? "odysseus"}
            busyId={busyId}
            onStart={start}
            onAnnounce={setAnnouncement}
            onTooNarrow={handleTooNarrow}
          />
        )}
      </main>

      <footer className="office-footer">
        <span>
          아바타는 계정에서 자동으로 만들어지며 <b>평가에 쓰이지 않습니다.</b> 걷는 연출도 채점과 무관합니다 —
          목록 화면으로 응시해도 결과는 똑같습니다.
        </span>
      </footer>
    </div>
  );
}
