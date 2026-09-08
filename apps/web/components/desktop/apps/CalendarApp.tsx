"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/toast";
import { IconCalendar, IconChevronLeft, IconChevronRight, IconRefresh, IconSheet } from "@/components/icons";
import {
  ScheduleEvent,
  formatTime,
  layoutDay,
  looksLikeSchedule,
  parseSchedule,
} from "@/lib/schedule";
import { isKeepPath, useWorkspace } from "../workspace";

const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

/** 파일별 색 — 원본 데이터와 내가 만든 배정표를 눈으로 구분하기 위한 것. */
const PALETTE = [
  { bar: "bg-indigo-500", chip: "bg-indigo-50 border-indigo-200 text-indigo-900" },
  { bar: "bg-emerald-500", chip: "bg-emerald-50 border-emerald-200 text-emerald-900" },
  { bar: "bg-amber-500", chip: "bg-amber-50 border-amber-200 text-amber-900" },
  { bar: "bg-rose-500", chip: "bg-rose-50 border-rose-200 text-rose-900" },
  { bar: "bg-sky-500", chip: "bg-sky-50 border-sky-200 text-sky-900" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 그 날짜가 속한 주의 월요일 */
function weekStart(iso: string): string {
  const d = toDate(iso);
  const dow = (d.getUTCDay() + 6) % 7; // 월=0
  return toIso(new Date(d.getTime() - dow * DAY_MS));
}

/** 달력 — 일정 표(CSV)를 주 단위 격자로 본다.
 *
 *  조율 과제의 첫 질문은 언제나 "누가 언제 비어 있는가" 다. 표만 보고 그걸 머릿속에
 *  그리는 것은 이 시험이 재려는 능력이 아니다(엔지니어에게 터미널을 주는 것과 같은
 *  이유다). 그래서 표를 달력으로 보여 준다.
 *
 *  대신 판단은 하지 않는다 — "이 배정은 충돌입니다" 같은 판정을 내리지 않고, 겹치는
 *  일정을 나란히 그려 눈에 보이게만 한다. 충돌을 알아보는 것까지가 응시자의 몫이다.
 *  편집도 하지 않는다. 일정을 고치는 곳은 표 계산 앱이고, 저장하는 순간 여기 반영된다.
 */
export function CalendarApp() {
  const ws = useWorkspace();
  const { toast } = useToast();

  const [texts, setTexts] = useState<Record<string, string>>({});
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [picked, setPicked] = useState<ScheduleEvent | null>(null);

  const csvPaths = useMemo(
    () => ws.files.map((f) => f.path).filter((p) => !isKeepPath(p) && p.toLowerCase().endsWith(".csv")).sort(),
    [ws.files],
  );

  // 표 내용을 읽어 둔다 — 일정표인지 아닌지는 헤더를 봐야 알 수 있다
  useEffect(() => {
    const missing = csvPaths.filter((p) => texts[p] === undefined).slice(0, 40);
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
      setTexts((prev) => {
        const next = { ...prev };
        for (const [p, text] of pairs) next[p] = text;
        return next;
      });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvPaths.join("|")]);

  const schedulePaths = useMemo(
    () => csvPaths.filter((p) => texts[p] !== undefined && looksLikeSchedule(texts[p])),
    [csvPaths, texts],
  );

  const colorOf = useCallback(
    (path: string) => PALETTE[Math.max(0, schedulePaths.indexOf(path)) % PALETTE.length],
    [schedulePaths],
  );

  const events = useMemo(
    () =>
      schedulePaths
        .filter((p) => !hidden.has(p))
        .flatMap((p) => parseSchedule(texts[p] ?? "", p)),
    [schedulePaths, texts, hidden],
  );

  // 처음 열면 가장 이른 일정이 있는 주를 보여 준다 (오늘이 아니라 — 시나리오의 시간은 따로 흐른다)
  useEffect(() => {
    if (anchor || !events.length) return;
    const first = events.map((e) => e.date).sort()[0];
    setAnchor(weekStart(first));
  }, [events, anchor]);

  const start = anchor ?? weekStart(toIso(new Date()));
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => toIso(new Date(toDate(start).getTime() + i * DAY_MS))),
    [start],
  );

  const inWeek = useMemo(() => events.filter((e) => days.includes(e.date)), [events, days]);
  const outOfWeek = events.length - inWeek.length;

  // 시간 축 — 실제 일정이 있는 범위에 맞춘다 (빈 새벽 시간으로 화면을 낭비하지 않게)
  const timed = inWeek.filter((e) => e.startMin !== null);
  const minHour = Math.max(0, Math.min(8, ...timed.map((e) => Math.floor((e.startMin ?? 0) / 60))));
  const maxHour = Math.min(24, Math.max(19, ...timed.map((e) => Math.ceil((e.endMin ?? 0) / 60))) + 1);
  const hours = Array.from({ length: Math.max(1, maxHour - minHour) }, (_, i) => minHour + i);
  const HOUR_PX = 44;

  const shiftWeek = (weeks: number) => setAnchor(toIso(new Date(toDate(start).getTime() + weeks * 7 * DAY_MS)));

  if (!schedulePaths.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-white text-sm text-slate-400">
        <IconCalendar size={28} />
        일정으로 읽을 표가 없습니다
        <p className="max-w-sm text-center text-xs leading-relaxed">
          날짜 열(<code className="font-mono">date</code> · <code className="font-mono">날짜</code>)이 있는 CSV 파일을 만들면
          여기에 달력으로 나타납니다. 표는 표 계산 앱에서 만들고 고칩니다.
        </p>
        <button
          onClick={() => ws.refresh()}
          className="mt-1 flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
        >
          <IconRefresh size={13} /> 새로 고침
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white">
      {/* 상단 — 주 이동과 표 선택 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
        <button onClick={() => shiftWeek(-1)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <IconChevronLeft size={15} />
        </button>
        <span className="text-sm font-semibold text-slate-700">
          {days[0]} ~ {days[6]}
        </span>
        <button onClick={() => shiftWeek(1)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <IconChevronRight size={15} />
        </button>
        <button
          onClick={() => {
            const first = events.map((e) => e.date).sort()[0];
            if (first) setAnchor(weekStart(first));
          }}
          className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-50"
        >
          첫 일정으로
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {schedulePaths.map((p) => {
            const on = !hidden.has(p);
            const color = colorOf(p);
            return (
              <button
                key={p}
                onClick={() =>
                  setHidden((prev) => {
                    const next = new Set(prev);
                    if (next.has(p)) next.delete(p);
                    else next.add(p);
                    return next;
                  })
                }
                title={p}
                className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] ${
                  on ? "border-slate-200 bg-white text-slate-600" : "border-slate-100 bg-slate-50 text-slate-300"
                }`}
              >
                <span className={`h-2.5 w-2.5 rounded-sm ${on ? color.bar : "bg-slate-300"}`} />
                <span className="max-w-40 truncate font-mono">{p}</span>
              </button>
            );
          })}
          <button
            onClick={() => ws.refresh()}
            title="새로 고침"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <IconRefresh size={13} />
          </button>
        </div>
      </div>

      {/* 종일 일정 (시간이 없는 행) */}
      {inWeek.some((e) => e.startMin === null) && (
        <div className="grid border-b border-slate-200" style={{ gridTemplateColumns: `48px repeat(7, minmax(0,1fr))` }}>
          <div className="border-r border-slate-100 px-1 py-1 text-[10px] text-slate-400">종일</div>
          {days.map((d) => (
            <div key={d} className="min-h-8 space-y-1 border-r border-slate-100 p-1">
              {inWeek
                .filter((e) => e.date === d && e.startMin === null)
                .map((e, i) => (
                  <button
                    key={i}
                    onClick={() => setPicked(e)}
                    className={`block w-full truncate rounded border px-1.5 py-0.5 text-left text-[11px] ${colorOf(e.source).chip}`}
                  >
                    {e.title}
                    {e.who ? ` · ${e.who}` : ""}
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}

      {/* 주 격자 */}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="grid" style={{ gridTemplateColumns: `48px repeat(7, minmax(0,1fr))` }}>
          <div className="sticky top-0 z-10 border-b border-r border-slate-200 bg-white" />
          {days.map((d) => (
            <div
              key={d}
              className="sticky top-0 z-10 border-b border-r border-slate-100 bg-white px-2 py-1.5 text-center"
            >
              <div className="text-[11px] text-slate-400">{DAY_LABELS[toDate(d).getUTCDay()]}</div>
              <div className="text-xs font-semibold text-slate-700">{d.slice(5)}</div>
            </div>
          ))}

          {/* 시간 축 */}
          <div className="border-r border-slate-200">
            {hours.map((h) => (
              <div key={h} className="border-b border-slate-100 pr-1 text-right text-[10px] text-slate-400" style={{ height: HOUR_PX }}>
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {days.map((d) => {
            const dayEvents = inWeek.filter((e) => e.date === d && e.startMin !== null);
            const laid = layoutDay(dayEvents);
            return (
              <div key={d} className="relative border-r border-slate-100" style={{ height: hours.length * HOUR_PX }}>
                {hours.map((h) => (
                  <div key={h} className="border-b border-slate-100" style={{ height: HOUR_PX }} />
                ))}
                {laid.map(({ event, column, columns }, i) => {
                  const startMin = event.startMin ?? 0;
                  const endMin = event.endMin ?? startMin + 60;
                  const top = ((startMin - minHour * 60) / 60) * HOUR_PX;
                  const height = Math.max(18, ((endMin - startMin) / 60) * HOUR_PX - 2);
                  const color = colorOf(event.source);
                  return (
                    <button
                      key={i}
                      onClick={() => setPicked(event)}
                      className={`absolute overflow-hidden rounded border px-1.5 py-0.5 text-left text-[11px] leading-tight ${color.chip}`}
                      style={{
                        top,
                        height,
                        left: `${(column / columns) * 100}%`,
                        width: `calc(${100 / columns}% - 3px)`,
                      }}
                    >
                      <span className="block truncate font-medium">{event.title}</span>
                      <span className="block truncate opacity-70">
                        {formatTime(startMin)}–{formatTime(endMin)}
                        {event.who ? ` · ${event.who}` : ""}
                        {event.where ? ` · ${event.where}` : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* 하단 — 선택한 일정의 원본 행 */}
      <div className="flex items-center gap-3 border-t border-slate-200 px-3 py-1.5 text-[11px] text-slate-500">
        {picked ? (
          <>
            <span className="font-medium text-slate-700">{picked.title}</span>
            <span>
              {picked.date}
              {picked.startMin !== null ? ` ${formatTime(picked.startMin)}–${formatTime(picked.endMin ?? picked.startMin)}` : " (종일)"}
            </span>
            {picked.who && <span>담당 {picked.who}</span>}
            {picked.where && <span>장소 {picked.where}</span>}
            {picked.extra.slice(0, 3).map(([k, v]) => (
              <span key={k}>
                {k} {v}
              </span>
            ))}
            <button
              onClick={() => {
                ws.requestOpenInSheet(picked.source);
                toast(`${picked.source} 을(를) 표 계산에서 엽니다`, "success");
              }}
              className="ml-auto flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 hover:bg-slate-50"
            >
              <IconSheet size={12} /> 표에서 열기
            </button>
          </>
        ) : (
          <span>
            일정 {inWeek.length}건 표시 중{outOfWeek > 0 ? ` · 다른 주에 ${outOfWeek}건 더 있음` : ""}
          </span>
        )}
      </div>
    </div>
  );
}
