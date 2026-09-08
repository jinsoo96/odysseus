/** 일정 표(CSV) 해석 — 달력 앱이 쓴다.
 *
 * 시험장에는 일정 전용 저장소가 없다. 근무표·면접 일정·회의실 배정은 전부 표
 * 파일이고, 응시자가 만드는 산출물도 표다. 그래서 달력은 "표를 달력처럼 보여 주는
 * 창" 이다 — 새 데이터 모델을 만들지 않는다.
 *
 * 열 이름은 시나리오마다 다르다(`date`/`날짜`, `interviewer_1`/`담당자`). 규칙을
 * 하나로 고정하면 시나리오 작성자가 달력을 쓰기 위해 표를 뒤틀어야 한다. 그래서
 * 흔한 이름들을 별칭으로 받아들이고, 못 알아본 열은 부가 정보로 남긴다.
 */

import { parseCsv } from "./csv";

export interface ScheduleEvent {
  /** YYYY-MM-DD */
  date: string;
  /** 자정 기준 분. 시간이 없으면 null(종일) */
  startMin: number | null;
  endMin: number | null;
  title: string;
  who: string;
  where: string;
  /** 어느 파일에서 왔는가 (색 구분·출처 표시) */
  source: string;
  /** 알아보지 못한 나머지 열 — 클릭했을 때 보여 준다 */
  extra: [string, string][];
}

const DATE_KEYS = ["date", "날짜", "일자", "day", "start_date", "근무일", "일시"];
const START_KEYS = ["start", "start_time", "시작", "시작시간", "시작시각", "from", "time", "시간", "교시"];
const END_KEYS = ["end", "end_time", "종료", "종료시간", "종료시각", "to", "until"];
const TITLE_KEYS = [
  "title", "제목", "subject", "event", "일정", "meeting", "meeting_id", "task", "name", "이름",
  "candidate", "후보자", "지원자", "구분", "내용", "shift", "근무",
];
const WHO_KEYS = [
  "who", "owner", "person", "담당", "담당자", "attendee", "참석자", "interviewer", "interviewer_1",
  "staff", "근무자", "assignee", "member", "당직자", "responsible",
];
const WHERE_KEYS = ["room", "회의실", "location", "장소", "place", "site", "지점"];

function norm(value: string): string {
  return (value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function indexOfAny(header: string[], keys: string[]): number {
  const normalized = header.map(norm);
  for (const key of keys) {
    const i = normalized.indexOf(norm(key));
    if (i >= 0) return i;
  }
  return -1;
}

/** "09:00" · "9시" · "0930" · "9" → 자정 기준 분. 못 읽으면 null. */
export function parseTime(value: string): number | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  let m = /^(\d{1,2})\s*[:시]\s*(\d{1,2})?/.exec(raw);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }
  m = /^(\d{3,4})$/.exec(raw);
  if (m) {
    const n = Number(m[1]);
    const h = Math.floor(n / 100);
    const min = n % 100;
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }
  return null;
}

export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "2026-09-14" · "2026/9/14" · "9/14" 를 YYYY-MM-DD 로. 못 읽으면 빈 문자열. */
export function parseDate(value: string, fallbackYear?: number): string {
  const raw = (value ?? "").trim();
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(raw);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})[-./](\d{1,2})$/.exec(raw);
  if (m && fallbackYear) return `${fallbackYear}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/.exec(raw);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return "";
}

/** 이 CSV 를 일정표로 볼 수 있는가 — 날짜 열이 있고 데이터 행이 하나라도 있으면. */
export function looksLikeSchedule(text: string): boolean {
  const rows = parseCsv(text);
  if (rows.length < 2) return false;
  if (indexOfAny(rows[0], DATE_KEYS) < 0) return false;
  return rows.slice(1).some((r) => r.some((c) => c.trim()));
}

/** 일정표 CSV → 이벤트 목록. 날짜를 못 읽는 행은 버린다(표에 남아 있어도 달력에는 못 그린다). */
export function parseSchedule(text: string, source: string): ScheduleEvent[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0];
  const di = indexOfAny(header, DATE_KEYS);
  if (di < 0) return [];
  const si = indexOfAny(header, START_KEYS);
  const ei = indexOfAny(header, END_KEYS);
  const ti = indexOfAny(header, TITLE_KEYS);
  const wi = indexOfAny(header, WHO_KEYS);
  const li = indexOfAny(header, WHERE_KEYS);
  const known = new Set([di, si, ei, ti, wi, li].filter((i) => i >= 0));

  const year = new Date().getFullYear();
  const events: ScheduleEvent[] = [];
  for (const row of rows.slice(1)) {
    if (!row.some((c) => c.trim())) continue;
    const cell = (i: number) => (i >= 0 && i < row.length ? row[i].trim() : "");
    const date = parseDate(cell(di), year);
    if (!date) continue;

    // "09:00-11:00" 처럼 한 칸에 범위가 들어오는 표도 있다
    const startRaw = cell(si);
    const rangeMatch = /^(.+?)\s*[-~]\s*(.+)$/.exec(startRaw);
    let startMin = parseTime(rangeMatch ? rangeMatch[1] : startRaw);
    let endMin = parseTime(cell(ei)) ?? (rangeMatch ? parseTime(rangeMatch[2]) : null);
    if (startMin !== null && endMin !== null && endMin <= startMin) endMin = null;
    if (startMin !== null && endMin === null) endMin = Math.min(startMin + 60, 24 * 60);
    if (startMin === null) endMin = null;

    // 담당자는 여러 열(interviewer_1, interviewer_2)로 나뉘어 있을 수 있다
    const whoParts: string[] = [];
    header.forEach((h, i) => {
      if (WHO_KEYS.some((k) => norm(h).startsWith(norm(k))) && cell(i)) {
        whoParts.push(cell(i));
        known.add(i);
      }
    });

    events.push({
      date,
      startMin,
      endMin,
      title: cell(ti) || whoParts[0] || "(제목 없음)",
      who: [...new Set(whoParts)].join(", "),
      where: cell(li),
      source,
      extra: header
        .map((h, i) => [h, cell(i)] as [string, string])
        .filter(([, v], i) => v && !known.has(i)),
    });
  }
  return events;
}

/** 겹치는 이벤트끼리 나란히 놓기 위한 열 배치 (같은 날 안에서만). */
export function layoutDay(events: ScheduleEvent[]): { event: ScheduleEvent; column: number; columns: number }[] {
  const timed = events.filter((e) => e.startMin !== null).sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0));
  const placed: { event: ScheduleEvent; column: number; end: number }[] = [];
  for (const event of timed) {
    const start = event.startMin ?? 0;
    const used = new Set(placed.filter((p) => p.end > start).map((p) => p.column));
    let column = 0;
    while (used.has(column)) column++;
    placed.push({ event, column, end: event.endMin ?? start + 60 });
  }
  const columns = Math.max(1, ...placed.map((p) => p.column + 1));
  return placed.map((p) => ({ event: p.event, column: p.column, columns }));
}
