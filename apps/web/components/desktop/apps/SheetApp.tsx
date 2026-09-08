"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/toast";
import { copyText } from "@/lib/clipboard";
import { columnLabel, formatNumber, numericStats, parseCsv, toCsv } from "@/lib/csv";
import { IconAdd, IconDelete, IconRefresh, IconSave, IconFileText } from "@/components/icons";
import { ContextMenuView, MenuEntry, useContextMenu } from "../ContextMenu";
import { isKeepPath, useWorkspace } from "../workspace";

function isSheet(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return ext === "csv" || ext === "tsv";
}

interface Cell {
  r: number;
  c: number;
}

/** 표 편집기 — 워크스페이스의 CSV 를 스프레드시트처럼 다룬다.
 *
 *  사무 과제의 산출물은 문서와 **표**다. 표를 만들라고 해 놓고 텍스트 편집기만
 *  주면, 쉼표를 손으로 맞추는 것이 과제가 되어 버린다. 이 앱은 셀 편집·행/열
 *  추가·정렬·합계처럼 표를 다루는 최소한의 도구를 준다. 저장하면 같은 워크스페이스
 *  파일이 되므로 채점(csv_cell)이 그대로 읽는다.
 */
export function SheetApp() {
  const ws = useWorkspace();
  const { toast, confirm } = useToast();
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  const [path, setPath] = useState<string | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [sel, setSel] = useState<Cell | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("output/summary.csv");
  const [newHeader, setNewHeader] = useState("항목,값");

  const sheets = useMemo(
    () => ws.files.filter((f) => isSheet(f.path) && !isKeepPath(f.path)).map((f) => f.path).sort(),
    [ws.files],
  );

  const openSheet = useCallback(
    async (target: string) => {
      try {
        const fc = await ws.loadContent(target);
        const parsed = parseCsv(fc.content);
        setPath(target);
        setRows(parsed.length ? parsed : [[""]]);
        setDirty(false);
        setSel(null);
        setSavedAt(null);
      } catch {
        toast("표를 열 수 없습니다", "error");
      }
    },
    [ws, toast],
  );

  useEffect(() => {
    const wanted = ws.pendingSheetOpen;
    if (!wanted) return;
    ws.consumeSheetOpen();
    openSheet(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.pendingSheetOpen]);

  useEffect(() => {
    if (path === null && sheets.length > 0) openSheet(sheets[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheets.length]);

  const save = useCallback(async () => {
    if (!path) return;
    setSaving(true);
    try {
      await ws.saveContent(path, toCsv(rows));
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }));
    } catch {
      toast("저장에 실패했습니다", "error");
    } finally {
      setSaving(false);
    }
  }, [path, rows, ws, toast]);

  useEffect(() => {
    if (!dirty || !path) return;
    const t = setTimeout(() => save(), 2000);
    return () => clearTimeout(t);
  }, [dirty, path, rows, save]);

  const width = useMemo(() => rows.reduce((m, r) => Math.max(m, r.length), 1), [rows]);

  const setCell = (r: number, c: number, value: string) => {
    setRows((prev) => {
      const next = prev.map((row) => [...row]);
      while (next[r].length < width) next[r].push("");
      next[r][c] = value;
      return next;
    });
    setDirty(true);
  };

  const addRow = (at?: number) => {
    setRows((prev) => {
      const next = prev.map((r) => [...r]);
      const blank = Array.from({ length: width }, () => "");
      next.splice(at ?? next.length, 0, blank);
      return next;
    });
    setDirty(true);
  };

  const removeRow = (at: number) => {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((_, i) => i !== at));
    setDirty(true);
  };

  const addColumn = (at?: number) => {
    setRows((prev) =>
      prev.map((r) => {
        const row = [...r];
        while (row.length < width) row.push("");
        row.splice(at ?? width, 0, "");
        return row;
      }),
    );
    setDirty(true);
  };

  const removeColumn = (at: number) => {
    if (width <= 1) return;
    setRows((prev) => prev.map((r) => r.filter((_, i) => i !== at)));
    setDirty(true);
  };

  /** 헤더를 고정하고 본문만 정렬한다. 숫자로 읽히면 수치 정렬. */
  const sortByColumn = (c: number, dir: "asc" | "desc") => {
    setRows((prev) => {
      if (prev.length < 3) return prev;
      const [header, ...body] = prev;
      const num = (v: string) => {
        const cleaned = String(v ?? "").replace(/[,\s₩$%원]/g, "");
        const n = Number(cleaned);
        return cleaned !== "" && Number.isFinite(n) ? n : null;
      };
      const sorted = [...body].sort((a, b) => {
        const av = a[c] ?? "";
        const bv = b[c] ?? "";
        const an = num(av);
        const bn = num(bv);
        const cmp = an !== null && bn !== null ? an - bn : String(av).localeCompare(String(bv), "ko-KR");
        return dir === "asc" ? cmp : -cmp;
      });
      return [header, ...sorted];
    });
    setDirty(true);
  };

  const createSheet = async () => {
    const target = newName.trim().replace(/^\/+/, "");
    if (!target) return;
    if (ws.files.some((f) => f.path === target)) {
      toast("같은 이름의 파일이 이미 있습니다", "error");
      return;
    }
    const header = newHeader.split(",").map((h) => h.trim());
    const body = toCsv([header, header.map(() => "")]);
    try {
      await ws.saveContent(target, body);
      setCreating(false);
      setPath(target);
      setRows(parseCsv(body));
      setDirty(false);
      toast("새 표를 만들었습니다", "success");
    } catch {
      toast("표를 만들 수 없습니다", "error");
    }
  };

  const removeSheet = async (target: string) => {
    const ok = await confirm({
      title: "표를 삭제할까요?",
      message: `${target} 파일이 워크스페이스에서 삭제됩니다.`,
      danger: true,
      confirmLabel: "삭제",
    });
    if (!ok) return;
    try {
      await ws.deleteFile(target);
      if (path === target) {
        setPath(null);
        setRows([]);
      }
    } catch {
      toast("삭제에 실패했습니다", "error");
    }
  };

  const stats = useMemo(() => {
    if (!sel || rows.length < 2) return null;
    return numericStats(rows.slice(1).map((r) => r[sel.c] ?? ""));
  }, [sel, rows]);

  return (
    <div className="flex h-full bg-white">
      <div className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-slate-50/70">
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-slate-200 px-2">
          <span className="flex-1 truncate text-[11px] font-bold uppercase tracking-wide text-slate-400">표</span>
          <button title="새 표" onClick={() => setCreating((v) => !v)} className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600">
            <IconAdd size={14} />
          </button>
          <button title="새로고침" onClick={() => ws.refresh()} className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600">
            <IconRefresh size={13} />
          </button>
        </div>
        {creating && (
          <div className="space-y-1.5 border-b border-slate-200 bg-white p-2">
            <input
              autoFocus
              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createSheet();
                if (e.key === "Escape") setCreating(false);
              }}
              placeholder="output/summary.csv"
            />
            <input
              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
              value={newHeader}
              onChange={(e) => setNewHeader(e.target.value)}
              placeholder="헤더 (쉼표로 구분)"
            />
            <div className="flex gap-1">
              <button onClick={createSheet} className="flex-1 rounded bg-slate-800 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-700">
                만들기
              </button>
              <button onClick={() => setCreating(false)} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-500">
                취소
              </button>
            </div>
          </div>
        )}
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto py-1">
          {sheets.length === 0 && <p className="px-3 py-4 text-xs text-slate-400">표 파일이 없습니다. [+] 로 새로 만드세요.</p>}
          {sheets.map((p) => (
            <button
              key={p}
              onClick={() => openSheet(p)}
              onContextMenu={(e) =>
                openMenu(e, [
                  { label: "열기", onClick: () => openSheet(p) },
                  { label: "경로 복사", onClick: () => copyText(p) },
                  "separator",
                  { label: "삭제", danger: true, onClick: () => removeSheet(p) },
                ] as MenuEntry[])
              }
              className={`flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs ${
                p === path ? "bg-emerald-100 font-semibold text-emerald-900" : "text-slate-600 hover:bg-slate-200/60"
              }`}
            >
              <IconFileText size={12} />
              <span className="truncate">{p}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-slate-200 px-2">
          <span className="mr-1 max-w-[220px] truncate text-xs font-semibold text-slate-700">
            {path ?? "표를 선택하세요"}
            {dirty && <span className="ml-1 text-amber-500">•</span>}
          </span>
          <button disabled={!path} onClick={() => addRow()} className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-200/70 disabled:opacity-40">
            행 추가
          </button>
          <button disabled={!path} onClick={() => addColumn()} className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-200/70 disabled:opacity-40">
            열 추가
          </button>
          <button
            disabled={!path || !sel}
            onClick={() => sel && removeRow(sel.r)}
            className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-200/70 disabled:opacity-40"
          >
            행 삭제
          </button>
          <button
            disabled={!path || !sel}
            onClick={() => sel && removeColumn(sel.c)}
            className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-200/70 disabled:opacity-40"
          >
            열 삭제
          </button>
          <button
            disabled={!path || !sel}
            onClick={() => sel && sortByColumn(sel.c, "asc")}
            className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-200/70 disabled:opacity-40"
          >
            오름차순
          </button>
          <button
            disabled={!path || !sel}
            onClick={() => sel && sortByColumn(sel.c, "desc")}
            className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-200/70 disabled:opacity-40"
          >
            내림차순
          </button>
          <button
            disabled={!path || saving}
            onClick={save}
            className="ml-auto flex h-7 items-center gap-1 rounded-md bg-slate-800 px-2.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
          >
            <IconSave size={12} /> 저장
          </button>
        </div>

        <div className="thin-scroll min-h-0 flex-1 overflow-auto">
          {path ? (
            <table className="border-collapse text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-20 w-10 border border-slate-200 bg-slate-100 text-[10px] font-normal text-slate-400" />
                  {Array.from({ length: width }, (_, c) => (
                    <th
                      key={c}
                      onClick={() => setSel({ r: 0, c })}
                      className="sticky top-0 z-10 min-w-[120px] border border-slate-200 bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500"
                    >
                      {columnLabel(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, r) => (
                  <tr key={r}>
                    <td
                      onClick={() => setSel({ r, c: 0 })}
                      className="sticky left-0 z-10 border border-slate-200 bg-slate-100 px-1 text-center text-[10px] text-slate-400"
                    >
                      {r + 1}
                    </td>
                    {Array.from({ length: width }, (_, c) => {
                      const value = row[c] ?? "";
                      const selected = sel?.r === r && sel?.c === c;
                      return (
                        <td
                          key={c}
                          className={`border p-0 ${selected ? "border-sky-500 ring-1 ring-sky-400" : "border-slate-200"} ${
                            r === 0 ? "bg-slate-50 font-semibold" : ""
                          }`}
                        >
                          <input
                            value={value}
                            onFocus={() => setSel({ r, c })}
                            onChange={(e) => setCell(r, c, e.target.value)}
                            onKeyDown={(e) => {
                              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
                                e.preventDefault();
                                save();
                              }
                            }}
                            className="w-full min-w-[120px] bg-transparent px-2 py-1 outline-none"
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-400">
              왼쪽에서 표 파일을 고르거나 새로 만드세요.
            </div>
          )}
        </div>

        <div className="flex h-7 shrink-0 items-center gap-4 border-t border-slate-200 bg-slate-50 px-3 text-[11px] text-slate-500">
          <span>{rows.length}행 × {width}열</span>
          {sel && (
            <span>
              선택 {columnLabel(sel.c)}
              {sel.r + 1}
            </span>
          )}
          {stats && (
            <>
              <span>합계 {formatNumber(stats.sum)}</span>
              <span>평균 {formatNumber(stats.avg)}</span>
              <span>숫자 {stats.count}개</span>
            </>
          )}
          <span className="ml-auto">
            {saving ? "저장 중…" : dirty ? "저장되지 않음 — 2초 후 자동 저장" : savedAt ? `저장됨 ${savedAt}` : ""}
          </span>
        </div>
      </div>

      <ContextMenuView menu={menu} onClose={closeMenu} />
    </div>
  );
}
