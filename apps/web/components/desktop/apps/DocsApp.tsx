"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { useToast } from "@/components/toast";
import { copyText, selectedText } from "@/lib/clipboard";
import {
  IconAdd,
  IconDelete,
  IconFileText,
  IconRefresh,
  IconSave,
  IconView,
} from "@/components/icons";
import { ContextMenuView, MenuEntry, useContextMenu } from "../ContextMenu";
import { isKeepPath, useWorkspace } from "../workspace";

/** 문서로 다룰 확장자 — 보고서·회의록·공지문은 전부 여기에 들어간다. */
const DOC_EXTS = new Set(["md", "markdown", "txt"]);

function isDoc(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return DOC_EXTS.has(ext);
}

/** 단어 수 — 서버의 file_min_words 체크와 같은 규칙(글자가 있는 공백 토큰만 센다). */
function countWords(text: string): number {
  return text
    .split(/\s+/)
    .filter((t) => /[0-9A-Za-z가-힣]/.test(t)).length;
}

interface Template {
  key: string;
  label: string;
  body: string;
}

const TEMPLATES: Template[] = [
  {
    key: "blank",
    label: "빈 문서",
    body: "",
  },
  {
    key: "report",
    label: "보고서",
    body: `# 제목

작성자:
작성일:

## 1. 요약

## 2. 현황과 분석

## 3. 결론 및 제안
`,
  },
  {
    key: "minutes",
    label: "회의록",
    body: `# 회의록

- 일시:
- 장소:
- 참석자:
- 작성자:

## 논의 및 결정사항

## 보류 / 다음 논의

## 액션 아이템

| 담당 | 내용 | 기한 |
|---|---|---|
|  |  |  |

## 다음 회의
`,
  },
  {
    key: "notice",
    label: "공지·안내문",
    body: `# [공지] 제목

안녕하세요. OOO입니다.

## 안내 내용

## 조치 사항

## 문의

문의: 
`,
  },
  {
    key: "mail",
    label: "메일 초안",
    body: `# 제목

OOO 님께,

안녕하세요. OOO입니다.

(본문)

감사합니다.
OOO 드림
`,
  },
];

type ViewMode = "edit" | "split" | "preview";

/** 문서 편집기 — 워크스페이스의 문서 파일을 쓰고 다듬는 앱.
 *
 *  IDE 가 코드를 위한 도구인 것처럼, 이 앱은 보고서·회의록·공지문을 위한 도구다.
 *  같은 워크스페이스 파일을 다루므로 여기서 저장한 문서는 폴더·에이전트·채점이
 *  그대로 본다. 서식 도구는 마크다운을 넣어 주고, 상태바의 단어 수는 서버의
 *  분량 체크와 같은 방식으로 센다.
 */
export function DocsApp() {
  const ws = useWorkspace();
  const { toast, confirm } = useToast();
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  const [path, setPath] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("split");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("output/새 문서.md");
  const [newTemplate, setNewTemplate] = useState("report");
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const docs = useMemo(
    () => ws.files.filter((f) => isDoc(f.path) && !isKeepPath(f.path)).map((f) => f.path).sort(),
    [ws.files],
  );

  const openDoc = useCallback(
    async (target: string) => {
      try {
        const fc = await ws.loadContent(target);
        setPath(target);
        setText(fc.content);
        setDirty(false);
        setSavedAt(null);
      } catch {
        toast("문서를 열 수 없습니다", "error");
      }
    },
    [ws, toast],
  );

  // 폴더/뷰어에서 "문서로 열기" 요청이 오면 그 파일을 연다
  useEffect(() => {
    const wanted = ws.pendingDocsOpen;
    if (!wanted) return;
    ws.consumeDocsOpen();
    openDoc(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.pendingDocsOpen]);

  // 처음 열었을 때 문서가 하나라도 있으면 첫 문서를 보여 준다 (빈 화면보다 낫다)
  useEffect(() => {
    if (path === null && docs.length > 0) openDoc(docs[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs.length]);

  const save = useCallback(async () => {
    if (!path) return;
    setSaving(true);
    try {
      await ws.saveContent(path, text);
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }));
    } catch {
      toast("저장에 실패했습니다", "error");
    } finally {
      setSaving(false);
    }
  }, [path, text, ws, toast]);

  // 자동 저장 — 2초 멈추면 저장한다. 시험 중 저장을 잊어 산출물이 사라지는 일을 막는다.
  useEffect(() => {
    if (!dirty || !path) return;
    const t = setTimeout(() => {
      save();
    }, 2000);
    return () => clearTimeout(t);
  }, [dirty, path, text, save]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
    }
  };

  /** 선택 영역을 감싸거나 줄 앞에 표식을 붙인다 (마크다운 서식 도구). */
  const applyFormat = (kind: string) => {
    const el = areaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const before = text.slice(0, start);
    const selected = text.slice(start, end);
    const after = text.slice(end);
    const lineStart = before.lastIndexOf("\n") + 1;

    let next = text;
    let caret = end;
    if (kind === "bold" || kind === "italic") {
      const mark = kind === "bold" ? "**" : "*";
      const body = selected || (kind === "bold" ? "굵게" : "기울임");
      next = `${before}${mark}${body}${mark}${after}`;
      caret = start + mark.length + body.length + mark.length;
    } else if (kind.startsWith("h")) {
      const hashes = "#".repeat(Number(kind.slice(1)));
      const head = text.slice(lineStart, start);
      next = `${text.slice(0, lineStart)}${hashes} ${head.replace(/^#+\s*/, "")}${text.slice(start)}`;
      caret = start + hashes.length + 1;
    } else if (kind === "list" || kind === "numbered" || kind === "quote") {
      const prefix = kind === "list" ? "- " : kind === "numbered" ? "1. " : "> ";
      const body = (selected || "").split("\n").map((l) => `${prefix}${l}`).join("\n");
      next = `${before}${selected ? body : prefix}${after}`;
      caret = start + (selected ? body.length : prefix.length);
    } else if (kind === "table") {
      const table = "\n| 항목 | 값 |\n|---|---|\n|  |  |\n";
      next = `${before}${table}${after}`;
      caret = start + table.length;
    } else if (kind === "divider") {
      next = `${before}\n---\n${after}`;
      caret = start + 5;
    }
    setText(next);
    setDirty(true);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  const createDoc = async () => {
    const target = newName.trim().replace(/^\/+/, "");
    if (!target) return;
    if (ws.files.some((f) => f.path === target)) {
      toast("같은 이름의 파일이 이미 있습니다", "error");
      return;
    }
    const body = TEMPLATES.find((t) => t.key === newTemplate)?.body ?? "";
    try {
      await ws.saveContent(target, body);
      setCreating(false);
      setPath(target);
      setText(body);
      setDirty(false);
      toast("새 문서를 만들었습니다", "success");
    } catch {
      toast("문서를 만들 수 없습니다", "error");
    }
  };

  const removeDoc = async (target: string) => {
    const ok = await confirm({
      title: "문서를 삭제할까요?",
      message: `${target} 파일이 워크스페이스에서 삭제됩니다.`,
      danger: true,
      confirmLabel: "삭제",
    });
    if (!ok) return;
    try {
      await ws.deleteFile(target);
      if (path === target) {
        setPath(null);
        setText("");
        setDirty(false);
      }
    } catch {
      toast("삭제에 실패했습니다", "error");
    }
  };

  const words = countWords(text);
  const chars = text.length;
  const charsNoSpace = text.replace(/\s/g, "").length;
  const lines = text ? text.split("\n").length : 0;

  const toolButton = "flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-slate-600 hover:bg-slate-200/70";

  return (
    <div className="flex h-full bg-white">
      {/* 문서 목록 */}
      <div className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-slate-50/70">
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-slate-200 px-2">
          <span className="flex-1 truncate text-[11px] font-bold uppercase tracking-wide text-slate-400">문서</span>
          <button title="새 문서" onClick={() => setCreating((v) => !v)} className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600">
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
                if (e.key === "Enter") createDoc();
                if (e.key === "Escape") setCreating(false);
              }}
              placeholder="output/report.md"
            />
            <select
              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
              value={newTemplate}
              onChange={(e) => setNewTemplate(e.target.value)}
            >
              {TEMPLATES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label} 서식
                </option>
              ))}
            </select>
            <div className="flex gap-1">
              <button onClick={createDoc} className="flex-1 rounded bg-slate-800 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-700">
                만들기
              </button>
              <button onClick={() => setCreating(false)} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-500">
                취소
              </button>
            </div>
          </div>
        )}
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto py-1">
          {docs.length === 0 && <p className="px-3 py-4 text-xs text-slate-400">문서가 없습니다. [+] 로 새로 만드세요.</p>}
          {docs.map((p) => (
            <button
              key={p}
              onClick={() => openDoc(p)}
              onContextMenu={(e) =>
                openMenu(e, [
                  { label: "열기", onClick: () => openDoc(p) },
                  { label: "경로 복사", onClick: () => copyText(p) },
                  "separator",
                  { label: "삭제", danger: true, onClick: () => removeDoc(p) },
                ] as MenuEntry[])
              }
              className={`flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs ${
                p === path ? "bg-sky-100 font-semibold text-sky-900" : "text-slate-600 hover:bg-slate-200/60"
              }`}
            >
              <IconFileText size={12} />
              <span className="truncate">{p}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 본문 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-1 border-b border-slate-200 px-2">
          <span className="mr-1 max-w-[240px] truncate text-xs font-semibold text-slate-700">
            {path ?? "문서를 선택하세요"}
            {dirty && <span className="ml-1 text-amber-500">•</span>}
          </span>
          {path && (
            <>
              <button className={toolButton} onClick={() => applyFormat("h1")}>
                제목1
              </button>
              <button className={toolButton} onClick={() => applyFormat("h2")}>
                제목2
              </button>
              <button className={`${toolButton} font-bold`} onClick={() => applyFormat("bold")}>
                B
              </button>
              <button className={`${toolButton} italic`} onClick={() => applyFormat("italic")}>
                I
              </button>
              <button className={toolButton} onClick={() => applyFormat("list")}>
                목록
              </button>
              <button className={toolButton} onClick={() => applyFormat("numbered")}>
                번호
              </button>
              <button className={toolButton} onClick={() => applyFormat("quote")}>
                인용
              </button>
              <button className={toolButton} onClick={() => applyFormat("table")}>
                표
              </button>
              <button className={toolButton} onClick={() => applyFormat("divider")}>
                구분선
              </button>
            </>
          )}
          <div className="ml-auto flex items-center gap-1">
            <div className="flex overflow-hidden rounded-md border border-slate-300">
              {(["edit", "split", "preview"] as ViewMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setView(m)}
                  className={`px-2 py-1 text-[11px] font-medium ${
                    view === m ? "bg-slate-700 text-white" : "bg-white text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  {m === "edit" ? "편집" : m === "split" ? "분할" : "미리보기"}
                </button>
              ))}
            </div>
            <button
              disabled={!path || saving}
              onClick={save}
              className="flex h-7 items-center gap-1 rounded-md bg-slate-800 px-2.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
            >
              <IconSave size={12} /> 저장
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {view !== "preview" && (
            <textarea
              ref={areaRef}
              value={text}
              disabled={!path}
              onChange={(e) => {
                setText(e.target.value);
                setDirty(true);
              }}
              onKeyDown={onKeyDown}
              onContextMenu={(e) => {
                const sel = selectedText();
                const items: MenuEntry[] = [];
                if (sel) items.push({ label: "선택 영역 복사", onClick: () => copyText(sel) });
                items.push({ label: "전체 복사", onClick: () => copyText(text) });
                if (path) items.push({ label: "저장", shortcut: "Ctrl+S", onClick: () => save() });
                openMenu(e, items);
              }}
              spellCheck={false}
              placeholder={path ? "여기에 문서를 작성하세요." : ""}
              className={`thin-scroll h-full ${view === "split" ? "w-1/2 border-r border-slate-200" : "w-full"} resize-none p-5 font-sans text-[13px] leading-7 text-slate-800 outline-none disabled:bg-slate-50`}
            />
          )}
          {view !== "edit" && (
            <div className={`thin-scroll h-full overflow-y-auto bg-white p-5 ${view === "split" ? "w-1/2" : "w-full"}`}>
              {text.trim() ? (
                <Markdown>{text}</Markdown>
              ) : (
                <p className="flex h-full items-center justify-center text-xs text-slate-300">
                  <IconView size={14} />
                  <span className="ml-1.5">미리보기</span>
                </p>
              )}
            </div>
          )}
        </div>

        {/* 상태바 — 분량은 채점 기준과 같은 방식으로 센다 */}
        <div className="flex h-7 shrink-0 items-center gap-4 border-t border-slate-200 bg-slate-50 px-3 text-[11px] text-slate-500">
          <span>단어 {words.toLocaleString("ko-KR")}</span>
          <span>글자 {chars.toLocaleString("ko-KR")}</span>
          <span>공백 제외 {charsNoSpace.toLocaleString("ko-KR")}</span>
          <span>{lines}줄</span>
          <span className="ml-auto">
            {saving ? "저장 중…" : dirty ? "저장되지 않음 — 2초 후 자동 저장" : savedAt ? `저장됨 ${savedAt}` : ""}
          </span>
        </div>
      </div>

      <ContextMenuView menu={menu} onClose={closeMenu} />
    </div>
  );
}
