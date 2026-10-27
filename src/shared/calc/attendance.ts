// 勤怠計算 (労働基準法の法定労働時間 1日8時間・週40時間、深夜 22:00〜5:00、法定休日)
import { addDays, dateTimeMinutes, toMinutes, weekday } from "../dates";

export type DayType = "workday" | "scheduled_off" | "legal_holiday";
export type LeaveUnit = "full" | "am" | "pm";

export interface PatternInfo {
  startTime: string; // 'HH:MM'
  endTime: string;
  breakMinutes: number;
  scheduledMinutes: number;
  workDays: number[]; // 0=日〜6=土
  lateGraceMinutes: number;
}

export interface BreakInterval {
  start: string;
  end: string | null;
}

export interface LeaveOnDay {
  unit: LeaveUnit;
  paid: boolean;
  name: string;
}

export interface DayInput {
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  breaks: BreakInterval[];
  dayType: DayType;
  leaves: LeaveOnDay[];
  nextDayType?: DayType; // 翌日の区分 (日をまたぐ勤務で法定休日にかかる部分を分けるため)
}

export interface DayResult {
  date: string;
  dayType: DayType;
  clockIn: string | null;
  clockOut: string | null;
  workMinutes: number; // 実労働時間
  breakMinutes: number;
  regularMinutes: number; // 所定内労働
  withinLegalOvertime: number; // 法定内残業 (所定超〜8時間)
  legalOvertime: number; // 法定外残業 (8時間超・週40時間超)
  legalOvertimeFromRegular: number; // 週40時間超のうち所定内労働から振り替えた分 (割増のみ支払う)
  nonScheduledMinutes: number; // 所定休日労働 (8時間以内)
  legalHolidayMinutes: number; // 法定休日労働
  lateNightMinutes: number; // 深夜労働
  lateMinutes: number;
  earlyLeaveMinutes: number;
  absent: boolean;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  leaveNames: string[];
  leaveUnit: LeaveUnit | null;
  incomplete: boolean; // 出勤のみで退勤打刻がない
  autoBreak: boolean;
}

export const LEGAL_DAILY_MINUTES = 8 * 60;
export const LEGAL_WEEKLY_MINUTES = 40 * 60;

export function dayTypeOf(
  date: string,
  pattern: Pick<PatternInfo, "workDays">,
  holidays: Set<string>,
  legalHolidayWeekday: number,
): DayType {
  const wd = weekday(date);
  if (wd === legalHolidayWeekday) return "legal_holiday";
  if (holidays.has(date)) return "scheduled_off";
  return pattern.workDays.includes(wd) ? "workday" : "scheduled_off";
}

function overlap(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

/** 区間 [s, e) のうち 22:00〜翌5:00 にかかる分数 */
export function lateNightOverlap(s: number, e: number): number {
  if (e <= s) return 0;
  let total = 0;
  const dayStart = Math.floor(s / 1440) * 1440 - 1440;
  for (let d = dayStart; d < e; d += 1440) {
    total += overlap(s, e, d + 22 * 60, d + 29 * 60);
  }
  return total;
}

export function calcDay(input: DayInput, pattern: PatternInfo, today: string): DayResult {
  const fullLeave = input.leaves.find((l) => l.unit === "full");
  const amLeave = input.leaves.some((l) => l.unit === "am");
  const pmLeave = input.leaves.some((l) => l.unit === "pm");
  let paidLeaveDays = 0;
  let unpaidLeaveDays = 0;
  for (const l of input.leaves) {
    const days = l.unit === "full" ? 1 : 0.5;
    if (l.paid) paidLeaveDays += days;
    else unpaidLeaveDays += days;
  }
  const base: DayResult = {
    date: input.date,
    dayType: input.dayType,
    clockIn: input.clockIn,
    clockOut: input.clockOut,
    workMinutes: 0,
    breakMinutes: 0,
    regularMinutes: 0,
    withinLegalOvertime: 0,
    legalOvertime: 0,
    legalOvertimeFromRegular: 0,
    nonScheduledMinutes: 0,
    legalHolidayMinutes: 0,
    lateNightMinutes: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    absent: false,
    paidLeaveDays: Math.min(1, paidLeaveDays),
    unpaidLeaveDays: Math.min(1, unpaidLeaveDays),
    leaveNames: input.leaves.map((l) => (l.unit === "full" ? l.name : `${l.name} (${l.unit === "am" ? "午前" : "午後"})`)),
    leaveUnit: fullLeave ? "full" : amLeave && pmLeave ? "full" : amLeave ? "am" : pmLeave ? "pm" : null,
    incomplete: false,
    autoBreak: false,
  };

  if (!input.clockIn) {
    if (input.dayType === "workday" && !fullLeave && input.date < today) {
      // 半休を片方だけ取得して出勤していない場合は、残り半日を欠勤扱いにする
      if (amLeave !== pmLeave) base.unpaidLeaveDays = Math.min(1, base.unpaidLeaveDays + 0.5);
      else if (!amLeave) base.absent = true;
    }
    return base;
  }
  if (!input.clockOut) {
    base.incomplete = input.date < today;
    return base;
  }

  const s = toMinutes(input.clockIn);
  const e = toMinutes(input.clockOut);
  if (e <= s) return base;

  // 休憩: 打刻があればその区間、無ければ勤務パターンの休憩を 6時間超の勤務に自動で充てる
  const breaks: Array<[number, number]> = [];
  for (const b of input.breaks) {
    if (!b.start || !b.end) continue;
    const bs = Math.max(s, toMinutes(b.start));
    const be = Math.min(e, toMinutes(b.end));
    if (be > bs) breaks.push([bs, be]);
  }
  if (breaks.length === 0 && pattern.breakMinutes > 0 && e - s > 6 * 60) {
    const noon = dateTimeMinutes(input.date, "12:00");
    const bs = noon >= s && noon + pattern.breakMinutes <= e ? noon : s + Math.floor((e - s - pattern.breakMinutes) / 2);
    breaks.push([bs, bs + pattern.breakMinutes]);
    base.autoBreak = true;
  }
  const breakMinutes = breaks.reduce((a, [bs, be]) => a + (be - bs), 0);
  const work = Math.max(0, e - s - breakMinutes);

  let night = lateNightOverlap(s, e);
  for (const [bs, be] of breaks) night -= lateNightOverlap(bs, be);

  base.breakMinutes = breakMinutes;
  base.workMinutes = work;
  base.lateNightMinutes = Math.max(0, night);

  // 法定休日は暦日 (0:00〜24:00) で判定する。日をまたぐ勤務は 0:00 で分ける
  const midnight = dateTimeMinutes(input.date, "00:00") + 1440;
  let afterMidnight = Math.max(0, e - Math.max(s, midnight));
  for (const [bs, be] of breaks) afterMidnight -= overlap(bs, be, midnight, Infinity);
  afterMidnight = Math.max(0, afterMidnight);
  const nextIsLegalHoliday = input.nextDayType === "legal_holiday";

  if (input.dayType === "legal_holiday") {
    const after = nextIsLegalHoliday ? 0 : afterMidnight;
    base.legalHolidayMinutes = work - after;
    // 翌日 (法定休日でない日) にかかった部分は通常の時間外として扱う
    base.nonScheduledMinutes = Math.min(after, LEGAL_DAILY_MINUTES);
    base.legalOvertime = Math.max(0, after - LEGAL_DAILY_MINUTES);
    return base;
  }

  const holidayPart = nextIsLegalHoliday ? afterMidnight : 0;
  base.legalHolidayMinutes = holidayPart;
  const ordinary = work - holidayPart;
  const legalOT = Math.max(0, ordinary - LEGAL_DAILY_MINUTES);
  const withinLegal8h = ordinary - legalOT;
  base.legalOvertime = legalOT;

  if (input.dayType === "scheduled_off") {
    base.nonScheduledMinutes = withinLegal8h;
    return base;
  }

  // 所定労働日
  let scheduled = pattern.scheduledMinutes;
  if (fullLeave) scheduled = 0;
  else if (amLeave || pmLeave) scheduled = Math.round(scheduled / 2);
  base.regularMinutes = Math.min(withinLegal8h, scheduled);
  base.withinLegalOvertime = Math.max(0, withinLegal8h - scheduled);

  if (!fullLeave) {
    const startMin = dateTimeMinutes(input.date, pattern.startTime);
    let endMin = dateTimeMinutes(input.date, pattern.endTime);
    if (endMin <= startMin) endMin += 1440;
    if (!amLeave) {
      const late = s - startMin;
      if (late > pattern.lateGraceMinutes) base.lateMinutes = late;
    }
    if (!pmLeave) {
      const early = endMin - e;
      if (early > 0) base.earlyLeaveMinutes = early;
    }
  }
  return base;
}

export interface PeriodSummary {
  scheduledDays: number;
  workDays: number;
  absenceDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  holidayWorkDays: number;
  totalWorkMinutes: number;
  regularMinutes: number;
  withinLegalOvertime: number;
  legalOvertime: number;
  legalOvertimeFromRegular: number;
  over60Minutes: number;
  nonScheduledMinutes: number;
  legalHolidayMinutes: number;
  lateNightMinutes: number;
  lateCount: number;
  lateMinutes: number;
  earlyLeaveCount: number;
  earlyLeaveMinutes: number;
  incompleteDays: number;
}

export function emptySummary(): PeriodSummary {
  return {
    scheduledDays: 0,
    workDays: 0,
    absenceDays: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    holidayWorkDays: 0,
    totalWorkMinutes: 0,
    regularMinutes: 0,
    withinLegalOvertime: 0,
    legalOvertime: 0,
    legalOvertimeFromRegular: 0,
    over60Minutes: 0,
    nonScheduledMinutes: 0,
    legalHolidayMinutes: 0,
    lateNightMinutes: 0,
    lateCount: 0,
    lateMinutes: 0,
    earlyLeaveCount: 0,
    earlyLeaveMinutes: 0,
    incompleteDays: 0,
  };
}

/**
 * 週40時間超の振替を行い、期間の集計を返す。
 * days には期間開始日を含む週の起算日から期間末日までの日を渡す (期間前の日は週の累計にだけ使う)。
 * 振替後の日別結果も返す (days と同じ並び)。
 */
export function summarizePeriod(
  days: DayResult[],
  periodStart: string,
  periodEnd: string,
  weekStart: number,
): { summary: PeriodSummary; days: DayResult[] } {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ ...d }));
  const sum = emptySummary();
  let weekKey = "";
  let acc = 0;
  for (const d of sorted) {
    const wd = weekday(d.date);
    const key = addDays(d.date, -((wd - weekStart + 7) % 7));
    if (key !== weekKey) {
      weekKey = key;
      acc = 0;
    }
    if (d.dayType !== "legal_holiday") {
      const counted = d.regularMinutes + d.withinLegalOvertime + d.nonScheduledMinutes;
      const before = acc;
      acc += counted;
      let excess = Math.max(0, acc - LEGAL_WEEKLY_MINUTES) - Math.max(0, before - LEGAL_WEEKLY_MINUTES);
      if (excess > 0) {
        const fromNon = Math.min(excess, d.nonScheduledMinutes);
        d.nonScheduledMinutes -= fromNon;
        excess -= fromNon;
        const fromWithin = Math.min(excess, d.withinLegalOvertime);
        d.withinLegalOvertime -= fromWithin;
        excess -= fromWithin;
        const fromRegular = Math.min(excess, d.regularMinutes);
        d.regularMinutes -= fromRegular;
        d.legalOvertimeFromRegular += fromRegular;
        d.legalOvertime += fromNon + fromWithin + fromRegular;
      }
    }
    if (d.date < periodStart || d.date > periodEnd) continue;
    if (d.dayType === "workday") sum.scheduledDays++;
    if (d.workMinutes > 0) sum.workDays++;
    if (d.absent) sum.absenceDays++;
    sum.paidLeaveDays += d.paidLeaveDays;
    sum.unpaidLeaveDays += d.unpaidLeaveDays;
    if (d.legalHolidayMinutes > 0) sum.holidayWorkDays++;
    sum.totalWorkMinutes += d.workMinutes;
    sum.regularMinutes += d.regularMinutes;
    sum.withinLegalOvertime += d.withinLegalOvertime;
    sum.legalOvertime += d.legalOvertime;
    sum.legalOvertimeFromRegular += d.legalOvertimeFromRegular;
    sum.nonScheduledMinutes += d.nonScheduledMinutes;
    sum.legalHolidayMinutes += d.legalHolidayMinutes;
    sum.lateNightMinutes += d.lateNightMinutes;
    if (d.lateMinutes > 0) {
      sum.lateCount++;
      sum.lateMinutes += d.lateMinutes;
    }
    if (d.earlyLeaveMinutes > 0) {
      sum.earlyLeaveCount++;
      sum.earlyLeaveMinutes += d.earlyLeaveMinutes;
    }
    if (d.incomplete) sum.incompleteDays++;
  }
  sum.over60Minutes = Math.max(0, sum.legalOvertime - 60 * 60);
  return { summary: sum, days: sorted };
}
