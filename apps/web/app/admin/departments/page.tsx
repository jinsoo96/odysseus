"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Department } from "@/lib/types";
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
  const [draft, setDraft] = useState<typeof EMPTY & { id?: string }>({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const { toast, confirm } = useToast();

  const load = useCallback(
    () =>
      api
        .get<Department[]>("/departments")
        .then(setRows)
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

      {!rows ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
                <tr>
                  <th className="px-4 py-3">자리</th>
                  <th className="px-4 py-3">부서</th>
                  <th className="px-4 py-3">방 설명</th>
                  <th className="px-4 py-3">시나리오</th>
                  <th className="px-4 py-3 text-right">순서</th>
                  <th className="w-24 px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((d, i) => (
                  <tr key={d.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-400">
                      {i < topCount ? "위" : "아래"} {(i < topCount ? i : i - topCount) + 1}번째
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 shrink-0 rounded-sm"
                          style={{ background: d.accent }}
                          aria-hidden="true"
                        />
                        <span className="font-semibold">{d.label}</span>
                      </div>
                      <code className="mt-0.5 block text-[11px] text-slate-400">{d.slug}</code>
                    </td>
                    <td className="max-w-md px-4 py-3 text-slate-600">{d.summary}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {d.scenario_count ? (
                        <span className="text-slate-700">{d.scenario_count}개</span>
                      ) : (
                        <span className="text-amber-600">비어 있음</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
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
                        className="ml-1 rounded border border-slate-200 px-2 py-1 text-xs disabled:opacity-30"
                      >
                        ↓
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button
                        onClick={() => setDraft({ ...d })}
                        className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                      >
                        수정
                      </button>
                      <IconButton title="삭제" tone="danger" onClick={() => remove(d)}>
                        <IconDelete />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

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
