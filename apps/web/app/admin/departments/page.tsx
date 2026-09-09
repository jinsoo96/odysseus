"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import type { Department, ScenarioSummary } from "@/lib/types";
import { DIFFICULTY_LABEL } from "@/lib/format";
import { useUser } from "@/components/useUser";
import { Shell } from "@/components/Shell";
import { IconDelete } from "@/components/icons";
import { Button, Card, Field, IconButton, Spinner, inputCls } from "@/components/ui";
import { useToast } from "@/components/toast";

/** 새 시나리오를 만들 때 권할 앱 조합. 서버 `desktop.APP_PRESETS` 와 같은 키다. */
const PRESETS: { id: string; label: string }[] = [
  { id: "engineering", label: "엔지니어링 — 터미널·IDE·GitHub" },
  { id: "analysis", label: "분석 — 표 계산 중심" },
  { id: "office", label: "사무 — 문서·표·메일" },
  { id: "communication", label: "커뮤니케이션 — 메일과 문서" },
  { id: "coordination", label: "조율 — 달력·표·메일" },
];

/** 방 색 후보. 손으로 아무 색이나 넣게 두면 층이 색 견본처럼 되므로,
 *  밝기를 맞춰 둔 여덟 개 중에서 고르게 한다. */
const ACCENTS = [
  "#62A8C8",
  "#6FBDB4",
  "#8496D6",
  "#9B8FD1",
  "#C58FC9",
  "#6DBBA0",
  "#D28FA0",
  "#C9A96A",
];

const EMPTY = { slug: "", label: "", summary: "", accent: ACCENTS[0], app_preset: "office" };

export default function DepartmentsPage() {
  const { user, loading } = useUser(["admin"]);
  const [rows, setRows] = useState<Department[] | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioSummary[] | null>(null);
  const [draft, setDraft] = useState<typeof EMPTY & { id?: string }>({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const { toast, confirm } = useToast();

  const load = useCallback(
    () =>
      Promise.all([api.get<Department[]>("/departments"), api.get<ScenarioSummary[]>("/scenarios")])
        .then(([depts, scen]) => {
          setRows(depts);
          setScenarios(scen);
        })
        .catch((e) => toast(String(e.message), "error")),
    [toast],
  );

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const save = async () => {
    if (!draft.slug.trim() || !draft.label.trim()) {
      toast("부서 키와 이름은 비울 수 없습니다", "error");
      return;
    }
    setBusy(true);
    try {
      const body = {
        slug: draft.slug.trim(),
        label: draft.label.trim(),
        summary: draft.summary.trim(),
        accent: draft.accent,
        app_preset: draft.app_preset,
      };
      if (draft.id) await api.put(`/departments/${draft.id}`, body);
      else await api.post("/departments", body);
      setDraft({ ...EMPTY });
      await load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "저장할 수 없습니다", "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (d: Department) => {
    const ok = await confirm({
      title: "이 방을 없앨까요?",
      message: `${d.label} — 층에서 방이 사라지고 남은 방들이 자리를 다시 잡습니다.`,
      danger: true,
      confirmLabel: "없애기",
    });
    if (!ok) return;
    try {
      await api.del(`/departments/${d.id}`);
      await load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "지울 수 없습니다", "error");
    }
  };

  /** 미션을 다른 방으로 옮긴다.
   *
   *  부서만 바꾸는 전용 요청을 쓴다 — 전체 저장으로 옮기면 스물다섯 번 왕복하는 동안
   *  인물과 초기 파일과 채점 기준을 매번 덮어쓰게 되고, 그만큼 잃을 여지가 생긴다. */
  const moveScenario = async (s: ScenarioSummary, department: string) => {
    setScenarios((prev) =>
      (prev ?? []).map((x) => (x.id === s.id ? { ...x, department } : x)),
    );
    try {
      await api.put(`/scenarios/${s.id}/department`, { department });
      await load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "옮길 수 없습니다", "error");
      await load();
    }
  };

  /** 순서가 곧 평면도의 배치다. 위 줄 왼쪽부터 채워지고 절반이 넘어가면 아래 줄로 내려간다. */
  const move = async (index: number, delta: number) => {
    if (!rows) return;
    const next = [...rows];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setRows(next);
    try {
      setRows(await api.put<Department[]>("/departments/order", { ids: next.map((d) => d.id) }));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "순서를 바꿀 수 없습니다", "error");
      await load();
    }
  };

  if (loading || !user) return <Spinner label="불러오는 중..." />;

  const topCount = rows ? Math.ceil(rows.length / 2) : 0;
  const known = new Set((rows ?? []).map((d) => d.slug));
  // 방이 없어진 미션은 사라지지 않고 로비에 모인다 — 여기서 다시 배치한다.
  const lobby = (scenarios ?? []).filter((s) => !s.is_archived && !known.has(s.department ?? ""));

  return (
    <Shell user={user}>
      <div className="mb-6">
        <h1 className="text-2xl font-black">부서 관리</h1>
        <p className="mt-1 text-sm text-slate-500">
          응시자가 출근하는 사무실의 방 목록입니다. 이 목록이 곧 평면도라, 부서를 하나 더 만들면
          층에 방이 하나 더 생기고 순서를 바꾸면 방이 옮겨 갑니다. 회사마다 뽑는 직군이 다르므로
          기본으로 들어 있는 여덟 개는 지우거나 바꾸라고 넣어 둔 것입니다.
        </p>
      </div>

      {!rows || !scenarios ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          <div className="space-y-3">
            {rows.map((d, i) => {
              const mine = scenarios.filter((s) => s.department === d.slug && !s.is_archived);
              const elsewhere = scenarios.filter((s) => !s.is_archived && s.department !== d.slug);
              return (
                <Card key={d.id} className="overflow-hidden">
                  <div className="flex flex-wrap items-start gap-3 border-b border-slate-100 p-4">
                    <span
                      className="mt-1 h-4 w-4 shrink-0 rounded-sm"
                      style={{ background: d.accent }}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-bold">{d.label}</h2>
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                          {d.slug}
                        </code>
                        <span className="text-xs text-slate-400">
                          {i < topCount ? "위" : "아래"} {(i < topCount ? i : i - topCount) + 1}번째 방
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-600">{d.summary}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        aria-label={`${d.label} 앞으로`}
                        className="rounded border border-slate-200 px-2 py-1 text-xs disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => move(i, 1)}
                        disabled={i === rows.length - 1}
                        aria-label={`${d.label} 뒤로`}
                        className="rounded border border-slate-200 px-2 py-1 text-xs disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => setDraft({ ...d })}
                        className="ml-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                      >
                        수정
                      </button>
                      <IconButton title="방 없애기" tone="danger" onClick={() => remove(d)}>
                        <IconDelete />
                      </IconButton>
                    </div>
                  </div>

                  {mine.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-amber-600">
                      이 방에는 미션이 없습니다. 응시자에게는 빈 방으로 보입니다.
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-50">
                      {mine.map((s) => (
                        <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                          <Link
                            href={`/admin/scenarios/${s.id}`}
                            className="min-w-0 flex-1 truncate text-sm hover:text-sky-600 hover:underline"
                          >
                            {s.title}
                          </Link>
                          <span className="shrink-0 text-xs text-slate-400">
                            {DIFFICULTY_LABEL[s.difficulty] ?? s.difficulty} · 체크 {s.check_count}개
                          </span>
                          <label className="shrink-0 text-xs text-slate-500">
                            <span className="sr-only">{s.title} 을 옮길 방</span>
                            <select
                              className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                              value={s.department ?? ""}
                              onChange={(e) => moveScenario(s, e.target.value)}
                            >
                              {rows.map((o) => (
                                <option key={o.id} value={o.slug}>
                                  {o.label}
                                </option>
                              ))}
                              <option value="">로비 (미배치)</option>
                            </select>
                          </label>
                          <button
                            type="button"
                            onClick={() => moveScenario(s, "")}
                            className="shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
                          >
                            빼기
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* 방을 채우는 두 가지 길 — 새로 쓰거나, 다른 방에서 가져오거나. */}
                  <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-2.5">
                    <Link
                      href={`/admin/scenarios/new?department=${d.slug}`}
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      + 이 방에 새 미션
                    </Link>
                    {elsewhere.length > 0 && (
                      <label className="text-xs text-slate-500">
                        <span className="sr-only">{d.label}에 넣을 미션</span>
                        <select
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                          value=""
                          onChange={(e) => {
                            const picked = elsewhere.find((x) => x.id === e.target.value);
                            if (picked) moveScenario(picked, d.slug);
                          }}
                        >
                          <option value="">다른 방에서 가져오기...</option>
                          {elsewhere.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.title}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          {lobby.length > 0 && (
            <Card className="overflow-hidden border-dashed">
              <div className="border-b border-slate-100 p-4">
                <h2 className="font-bold">로비 — 아직 방이 정해지지 않은 미션 {lobby.length}개</h2>
                <p className="mt-1 text-sm text-slate-500">
                  응시자 화면에서는 사무실 구석의 목록으로 보입니다. 방을 정해 주면 그 팀 자리로
                  옮겨 갑니다.
                </p>
              </div>
              <ul className="divide-y divide-slate-50">
                {lobby.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm">{s.title}</span>
                    <select
                      aria-label={`${s.title} 을 옮길 방`}
                      className="shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-xs"
                      value=""
                      onChange={(e) => moveScenario(s, e.target.value)}
                    >
                      <option value="">방 고르기...</option>
                      {rows.map((o) => (
                        <option key={o.id} value={o.slug}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="p-6">
            <h2 className="font-bold">{draft.id ? "부서 수정" : "부서 추가"}</h2>
            <p className="mt-1 text-sm text-slate-500">
              부서 키는 시나리오가 가리키는 이름입니다. 키를 바꾸면 그 방에 있던 시나리오도 같이
              옮겨 가므로, 이름을 고쳤다고 방이 비지는 않습니다.
            </p>

            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <Field label="부서 키 (영문 소문자)">
                <input
                  className={inputCls}
                  value={draft.slug}
                  onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
                  placeholder="예: backend"
                />
              </Field>
              <Field label="부서 이름">
                <input
                  className={inputCls}
                  value={draft.label}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                  placeholder="예: 백엔드 개발팀"
                />
              </Field>
              <Field label="새 시나리오에 권할 앱 조합">
                <select
                  className={inputCls}
                  value={draft.app_preset}
                  onChange={(e) => setDraft({ ...draft, app_preset: e.target.value })}
                >
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="mt-4">
              <Field label="방 설명 — 응시자가 이 방에 들어섰을 때 화면 아래에 보입니다">
                <input
                  className={inputCls}
                  value={draft.summary}
                  onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                  placeholder="예: API 와 데이터베이스. 코드를 읽어 계약을 되찾는 자리."
                />
              </Field>
            </div>

            <div className="mt-4">
              <p className="mb-2 text-sm font-medium text-slate-700">방 색</p>
              <p className="mb-2 text-xs text-slate-500">
                문패와 문턱, 불 켜진 모니터에만 쓰입니다. 바닥을 이 색으로 칠하지는 않습니다 —
                여덟 방을 각자의 색으로 칠하면 한 건물로 보이지 않기 때문입니다.
              </p>
              <div className="flex flex-wrap gap-2">
                {ACCENTS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setDraft({ ...draft, accent: c })}
                    aria-label={`색 ${c}`}
                    aria-pressed={draft.accent === c}
                    className={`h-8 w-8 rounded-md border-2 transition ${
                      draft.accent === c ? "border-slate-900" : "border-transparent"
                    }`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>

            <div className="mt-6 flex gap-2">
              <Button onClick={save} disabled={busy}>
                {busy ? "저장 중..." : draft.id ? "수정 저장" : "부서 추가"}
              </Button>
              {draft.id && (
                <Button variant="ghost" onClick={() => setDraft({ ...EMPTY })}>
                  취소
                </Button>
              )}
            </div>
          </Card>
        </div>
      )}
    </Shell>
  );
}
