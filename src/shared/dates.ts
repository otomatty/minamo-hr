// 日付ユーティリティ。会社のローカル時刻 (JST) を 'YYYY-MM-DD' / 'YYYY-MM-DDTHH:MM:SS' の文字列で扱う。
// タイムゾーンの影響を受けないよう、内部では UTC として解釈した Date を使う。

export const pad2 = (n: number) => String(n).padStart(2, "0");

export function parseYmd(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return { y, m, d };
}

export function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function toUtcDate(s: string): Date {
  const { y, m, d } = parseYmd(s);
  return new Date(Date.UTC(y, m - 1, d));
}

export function fromUtcDate(dt: Date): string {
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(s: string, n: number): string {
  const dt = toUtcDate(s);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromUtcDate(dt);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 月を加算する。日が存在しない場合は月末に丸める (例: 1/31 + 1か月 = 2/28) */
export function addMonthsToDate(s: string, n: number): string {
  const { y, m, d } = parseYmd(s);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return ymd(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function weekday(s: string): number {
  return toUtcDate(s).getUTCDay();
}

export function diffDays(a: string, b: string): number {
  return Math.round((toUtcDate(b).getTime() - toUtcDate(a).getTime()) / 86400000);
}

export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 'YYYY-MM' を n か月ずらす */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad2((total % 12) + 1)}`;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * 勤怠月度の期間。締め日 0 は末日締め。
 * 締め日が 20 の場合、'2026-11' 月度は 2026-10-21〜2026-11-20 (締め日を含む月の名前で呼ぶ)。
 */
export function attendancePeriod(month: string, closingDay: number): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  if (!closingDay) {
    return { start: ymd(y, m, 1), end: ymd(y, m, daysInMonth(y, m)) };
  }
  const end = ymd(y, m, Math.min(closingDay, daysInMonth(y, m)));
  const prev = addMonths(month, -1);
  const [py, pm] = prev.split("-").map(Number);
  const startDay = Math.min(closingDay, daysInMonth(py, pm)) + 1;
  const start = startDay > daysInMonth(py, pm) ? ymd(y, m, 1) : ymd(py, pm, startDay);
  return { start, end };
}

/** ある日付が属する勤怠月度 */
export function attendanceMonthOf(date: string, closingDay: number): string {
  const { y, m, d } = parseYmd(date);
  const month = `${y}-${pad2(m)}`;
  if (!closingDay) return month;
  return d > Math.min(closingDay, daysInMonth(y, m)) ? addMonths(month, 1) : month;
}

/** 'YYYY-MM-DDTHH:MM[:SS]' → エポックからの分 */
export function toMinutes(dt: string): number {
  const { y, m, d } = parseYmd(dt);
  const hh = Number(dt.slice(11, 13) || 0);
  const mm = Number(dt.slice(14, 16) || 0);
  return Date.UTC(y, m - 1, d, hh, mm) / 60000;
}

export function fromMinutes(min: number): string {
  const dt = new Date(min * 60000);
  return `${fromUtcDate(dt)}T${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}:00`;
}

/** 日付 + 'HH:MM' → 分 */
export function dateTimeMinutes(date: string, hhmm: string): number {
  return toMinutes(`${date}T${hhmm}`);
}

/** 現在のローカル日時 (オフセット分, JST = 540) */
export function nowLocal(offsetMinutes = 540, now: Date = new Date()): string {
  const dt = new Date(now.getTime() + offsetMinutes * 60000);
  return `${fromUtcDate(dt)}T${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}:${pad2(dt.getUTCSeconds())}`;
}

export function todayLocal(offsetMinutes = 540, now: Date = new Date()): string {
  return nowLocal(offsetMinutes, now).slice(0, 10);
}

/** 満年齢 (誕生日の前日に加齢する民法の考え方ではなく、暦上の満年齢) */
export function ageOn(birthDate: string, on: string): number {
  const b = parseYmd(birthDate);
  const o = parseYmd(on);
  let age = o.y - b.y;
  if (o.m < b.m || (o.m === b.m && o.d < b.d)) age--;
  return age;
}

export function formatMinutes(min: number): string {
  const sign = min < 0 ? "-" : "";
  const a = Math.abs(Math.round(min));
  return `${sign}${Math.floor(a / 60)}:${pad2(a % 60)}`;
}

export const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];
