"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { useToast } from "@/components/toast";
import { copyText, selectedText } from "@/lib/clipboard";
import { IconInbox, IconMail, IconRefresh, IconReply, IconSend } from "@/components/icons";
import { displayName, formatMail, isInboxPath, isMailFile, parseMail, quoteBody, replySubject } from "@/lib/mail";
import { ContextMenuView, MenuEntry, useContextMenu } from "../ContextMenu";
import { isKeepPath, useWorkspace } from "../workspace";

/** 단어 수 — 서버의 분량 체크와 같은 규칙(글자가 있는 공백 토큰만 센다). */
function countWords(text: string): number {
  return text.split(/\s+/).filter((t) => /[0-9A-Za-z가-힣]/.test(t)).length;
}

/** 파일 경로에서 기본 회신 파일명을 만든다 — 같은 이름을 덮어쓰지 않도록. */
function suggestReplyPath(existing: Set<string>, base: string): string {
  const clean = base.replace(/[^0-9A-Za-z가-힣_-]+/g, "_").replace(/^_+|_+$/g, "") || "reply";
  let path = `output/${clean}.md`;
  let n = 2;
  while (existing.has(path)) path = `output/${clean}_${n++}.md`;
  return path;
}

interface MailItem {
  path: string;
  subject: string;
  who: string;
  date: string;
  preview: string;
}

type Pane = { kind: "read"; path: string } | { kind: "compose" } | { kind: "empty" };

/** 메일 — 시험장의 사내 메일 클라이언트.
 *
 *  사무 업무의 절반은 "받은 메일에 어떻게 답하는가" 다. 그 절반을 문서 편집기로
 *  대신하면, 응시자는 누구에게 무엇을 보내는지가 아니라 파일을 만드는 일부터
 *  생각하게 된다. 그래서 받은 편지함과 작성 창을 따로 둔다.
 *
 *  다만 저장소는 새로 만들지 않는다. 받은 메일은 시나리오가 넣어 둔 `mail/`·`inbox/`
 *  파일이고, 보낸 메일은 `output/` 아래 파일이다. "보내기" 는 곧 저장이며, 그 파일을
 *  폴더·에이전트·자동 채점이 그대로 본다.
 *
 *  회신에 원문을 인용할지는 응시자가 고른다(기본은 인용하지 않음). 인용을 기본으로
 *  두면 고객이 쓴 문장이 회신문에 섞여 들어가 "무엇을 스스로 썼는가" 가 흐려진다.
 */
export function MailApp() {
  const ws = useWorkspace();
  const { toast } = useToast();
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  const [box, setBox] = useState<"inbox" | "sent">("inbox");
  const [pane, setPane] = useState<Pane>({ kind: "empty" });
  const [bodies, setBodies] = useState<Record<string, string>>({});

  // 작성 상태
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [savePath, setSavePath] = useState("output/reply.md");
  const [quote, setQuote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sentAt, setSentAt] = useState<string | null>(null);

  const paths = useMemo(() => ws.files.map((f) => f.path).filter((p) => !isKeepPath(p)), [ws.files]);

  const inboxPaths = useMemo(() => paths.filter((p) => isInboxPath(p) && isMailFile(p)).sort(), [paths]);

  /** 보낸 편지함 — 메일 앱이 쓴 파일(헤더에 받는사람/제목이 있는 output 문서). */
  const sentPaths = useMemo(
    () =>
      paths
        .filter((p) => !isInboxPath(p) && isMailFile(p))
        .filter((p) => {
          const text = bodies[p];
          if (text === undefined) return false;
          const parsed = parseMail(text);
          return parsed.hasHeaders && !!(parsed.headers.to || parsed.headers.subject);
        })
        .sort(),
    [paths, bodies],
  );

  // 목록에 보여 줄 만큼은 내용을 미리 읽어 둔다 (제목·발신자·미리보기)
  useEffect(() => {
    const missing = paths.filter((p) => isMailFile(p) && bodies[p] === undefined).slice(0, 60);
    if (!missing.length) return;
    let alive = true;
    Promise.all(
      missing.map((p) =>
        ws
          .loadContent(p)
          .then((fc) => [p, fc.content] as const)
          .catch(() => [p, ""] as const),
      ),
    ).then((pairs) => {
      if (!alive) return;
      setBodies((prev) => {
        const next = { ...prev };
        for (const [p, text] of pairs) next[p] = text;
        return next;
      });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths.join("|")]);

  const itemOf = useCallback(
    (path: string): MailItem => {
      const text = bodies[path] ?? "";
      const { headers, body: mailBody } = parseMail(text);
      const name = path.split("/").pop() ?? path;
      return {
        path,
        subject: headers.subject?.trim() || name,
        who: displayName(box === "inbox" ? headers.from : headers.to) || (box === "inbox" ? "(발신자 없음)" : "(수신자 없음)"),
        date: headers.date?.trim() ?? "",
        preview: mailBody.replace(/[#>*_`|-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 70),
      };
    },
    [bodies, box],
  );

  const list = useMemo(
    () => (box === "inbox" ? inboxPaths : sentPaths).map(itemOf),
    [box, inboxPaths, sentPaths, itemOf],
  );

  // 처음 열면 받은 메일 중 첫 통을 보여 준다 (빈 화면보다 낫다)
  useEffect(() => {
    if (pane.kind === "empty" && inboxPaths.length) setPane({ kind: "read", path: inboxPaths[0] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboxPaths.length]);

  const startCompose = useCallback(
    (source?: { path: string }) => {
      const existing = new Set(paths);
      if (!source) {
        setTo("");
        setCc("");
        setSubject("");
        setBody("");
        setQuote(null);
        setSavePath(suggestReplyPath(existing, "mail"));
      } else {
        const { headers, body: original } = parseMail(bodies[source.path] ?? "");
        setTo(headers.from ?? "");
        setCc("");
        setSubject(replySubject(headers.subject ?? ""));
        setBody("");
        setQuote(quoteBody(original, displayName(headers.from)));
        const base = (source.path.split("/").pop() ?? "reply").replace(/\.[^.]+$/, "");
        setSavePath(suggestReplyPath(existing, `reply_to_${base}`));
      }
      setSentAt(null);
      setPane({ kind: "compose" });
    },
    [bodies, paths],
  );

  const openSent = useCallback(
    (path: string) => {
      const { headers, body: text } = parseMail(bodies[path] ?? "");
      setTo(headers.to ?? "");
      setCc(headers.cc ?? "");
      setSubject(headers.subject ?? "");
      setBody(text);
      setQuote(null);
      setSavePath(path);
      setSentAt(null);
      setPane({ kind: "compose" });
    },
    [bodies],
  );

  const send = useCallback(
    async (withQuote: boolean) => {
      const path = savePath.trim();
      if (!path) {
        toast("저장 경로를 입력하세요", "error");
        return;
      }
      if (!subject.trim()) {
        toast("제목이 비어 있습니다", "error");
        return;
      }
      const content = formatMail({
        to: to || "(수신자 미정)",
        cc,
        subject,
        body: withQuote && quote ? `${body}${quote}` : body,
      });
      setSending(true);
      try {
        await ws.saveContent(path, content);
        setBodies((prev) => ({ ...prev, [path]: content }));
        setSentAt(new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }));
        toast(`발송함에 저장했습니다 — ${path}`, "success");
      } catch {
        toast("저장에 실패했습니다", "error");
      } finally {
        setSending(false);
      }
    },
    [body, cc, quote, savePath, subject, to, ws, toast],
  );

  const copy = async (text: string, label: string) => {
    if (await copyText(text)) toast(`${label}을(를) 복사했습니다`, "success");
    else toast("복사에 실패했습니다", "error");
  };

  const inputCls =
    "w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-rose-400";

  return (
    <div className="flex h-full bg-white text-slate-800">
      {/* 좌측 — 편지함과 목록 */}
      <div className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-slate-50">
        <div className="flex items-center gap-1 border-b border-slate-200 p-2">
          <button
            onClick={() => setBox("inbox")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium ${
              box === "inbox" ? "bg-white text-rose-600 shadow-sm" : "text-slate-500 hover:bg-white/70"
            }`}
          >
            <IconInbox size={13} /> 받은 편지함
            <span className="text-[10px] text-slate-400">{inboxPaths.length}</span>
          </button>
          <button
            onClick={() => setBox("sent")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium ${
              box === "sent" ? "bg-white text-rose-600 shadow-sm" : "text-slate-500 hover:bg-white/70"
            }`}
          >
            <IconSend size={13} /> 보낸 편지함
            <span className="text-[10px] text-slate-400">{sentPaths.length}</span>
          </button>
        </div>
        <div className="flex items-center gap-1 border-b border-slate-200 px-2 py-1.5">
          <button
            onClick={() => startCompose()}
            className="flex items-center gap-1.5 rounded-lg bg-rose-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-rose-600"
          >
            <IconMail size={13} /> 새 메일
          </button>
          <button
            onClick={() => ws.refresh()}
            title="새로 고침"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-slate-600"
          >
            <IconRefresh size={13} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {list.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-slate-400">
              {box === "inbox" ? "받은 메일이 없습니다" : "보낸 메일이 없습니다"}
            </div>
          )}
          {list.map((m) => {
            const active = pane.kind === "read" && pane.path === m.path;
            return (
              <button
                key={m.path}
                onClick={() => (box === "inbox" ? setPane({ kind: "read", path: m.path }) : openSent(m.path))}
                className={`block w-full border-b border-slate-100 px-3 py-2.5 text-left hover:bg-white ${
                  active ? "bg-white" : ""
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-slate-700">{m.who}</span>
                  <span className="shrink-0 text-[10px] text-slate-400">{m.date}</span>
                </div>
                <div className="truncate text-sm text-slate-800">{m.subject}</div>
                <div className="truncate text-[11px] text-slate-400">{m.preview}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 우측 — 읽기 / 작성 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {pane.kind === "read" && (
          <ReadPane
            path={pane.path}
            text={bodies[pane.path] ?? ""}
            onReply={() => startCompose({ path: pane.path })}
            onContext={(e) => {
              const sel = selectedText();
              const items: MenuEntry[] = [];
              if (sel) items.push({ label: "선택 영역 복사", onClick: () => copy(sel, "선택 영역") });
              items.push({ label: "메일 전문 복사", onClick: () => copy(bodies[pane.path] ?? "", "메일") });
              items.push({ label: "파일 경로 복사", onClick: () => copy(pane.path, "경로") });
              items.push("separator");
              items.push({ label: "문서 편집기로 열기", onClick: () => ws.requestOpenInDocs(pane.path) });
              openMenu(e, items);
            }}
          />
        )}

        {pane.kind === "compose" && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="space-y-1.5 border-b border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-xs text-slate-500">받는사람</span>
                <input className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} placeholder="이름 <메일주소>" />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-xs text-slate-500">참조</span>
                <input className={inputCls} value={cc} onChange={(e) => setCc(e.target.value)} placeholder="(선택)" />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-xs text-slate-500">제목</span>
                <input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="제목" />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-xs text-slate-500">저장</span>
                <input
                  className={`${inputCls} font-mono text-xs`}
                  value={savePath}
                  onChange={(e) => setSavePath(e.target.value)}
                  placeholder="output/reply.md"
                />
              </div>
            </div>
            <textarea
              className="min-h-0 flex-1 resize-none p-4 font-sans text-sm leading-relaxed outline-none"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="본문을 작성하세요."
              spellCheck={false}
            />
            {quote && (
              <div className="max-h-24 overflow-auto border-t border-slate-100 bg-slate-50 px-4 py-2 font-mono text-[11px] whitespace-pre-wrap text-slate-400">
                {quote.trim().slice(0, 600)}
              </div>
            )}
            <div className="flex items-center gap-2 border-t border-slate-200 bg-white px-3 py-2">
              <button
                disabled={sending}
                onClick={() => send(false)}
                className="flex items-center gap-1.5 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-600 disabled:opacity-50"
              >
                <IconSend size={13} /> 보내기
              </button>
              {quote && (
                <button
                  disabled={sending}
                  onClick={() => send(true)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  원문 인용해 보내기
                </button>
              )}
              <span className="ml-auto text-[11px] text-slate-400">
                {countWords(body)} 단어{sentAt ? ` · ${sentAt} 저장됨` : ""}
              </span>
            </div>
          </div>
        )}

        {pane.kind === "empty" && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-400">
            <IconMail size={28} />
            받은 메일이 없습니다
            <button onClick={() => startCompose()} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50">
              새 메일 쓰기
            </button>
          </div>
        )}
      </div>
      <ContextMenuView menu={menu} onClose={closeMenu} />
    </div>
  );
}

function ReadPane({
  path,
  text,
  onReply,
  onContext,
}: {
  path: string;
  text: string;
  onReply: () => void;
  onContext: (e: React.MouseEvent) => void;
}) {
  const { headers, body } = parseMail(text);
  const name = path.split("/").pop() ?? path;
  return (
    <div className="flex min-h-0 flex-1 flex-col" onContextMenu={onContext}>
      <div className="border-b border-slate-200 px-5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-800">{headers.subject?.trim() || name}</h2>
            <div className="mt-0.5 truncate text-xs text-slate-500">
              {headers.from ? `보낸사람 ${headers.from}` : path}
              {headers.to ? ` · 받는사람 ${headers.to}` : ""}
              {headers.date ? ` · ${headers.date}` : ""}
            </div>
          </div>
          <button
            onClick={onReply}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            <IconReply size={13} /> 답장
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        {/^\s*(#|\*|\||-\s)/m.test(body) ? (
          <Markdown>{body}</Markdown>
        ) : (
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-700">{body}</pre>
        )}
      </div>
    </div>
  );
}
