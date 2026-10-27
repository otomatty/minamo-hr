import { all, first, parseJson, placeholders, run } from "../lib/db";
import { badRequest, conflict } from "../lib/context";
import {
  calcDay,
  dayTypeOf,
  summarizePeriod,
  type BreakInterval,
  type DayResult,
  type LeaveOnDay,
  type PatternInfo,
  type PeriodSummary,
} from "../../shared/calc/attendance";
import { addDays, attendanceMonthOf, eachDay, weekday } from "../../shared/dates";
import { isLocked, type Company } from "./common";

export interface PatternRow {
  id: number;
  name: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  scheduled_minutes: number;
  work_days: string;
  late_grace_minutes: number;
  is_default: number;
}

export function toPattern(p: PatternRow | null | undefined): PatternInfo {
  if (!p) {
    return { startTime: "09:00", endTime: "18:00", breakMinutes: 60, scheduledMinutes: 480, workDays: [1, 2, 3, 4, 5], lateGraceMinutes: 0 };
  }
  return {
    startTime: p.start_time,
    endTime: p.end_time,
    breakMinutes: p.break_minutes,
    scheduledMinutes: p.scheduled_minutes,
    workDays: p.work_days.split(",").filter(Boolean).map(Number),
    lateGraceMinutes: p.late_grace_minutes,
  };
}

export interface AttendanceEmployee {
  id: number;
  hire_date: string;
  leave_date: string | null;
  work_pattern_id: number | null;
}

export interface DayView extends DayResult {
  breaks: BreakInterval[];
  note: string | null;
  inEmployment: boolean;
  holidayName: string | null;
}

export interface EmployeePeriod {
  days: DayView[];
  summary: PeriodSummary;
  fullScheduledDays: number; // 在籍に関係なく期間内の所定労働日数 (日割りの分母)
  workdayWorkDays: number;
  pattern: PatternInfo;
}

/** 複数従業員の期間勤怠をまとめて計算する */
export async function computePeriods(
  db: D1Database,
  employees: AttendanceEmployee[],
  start: string,
  end: string,
  today: string,
  company: Company,
): Promise<Map<number, EmployeePeriod>> {
  const result = new Map<number, EmployeePeriod>();
  if (!employees.length) return result;
  const weekStartDate = addDays(start, -((weekday(start) - company.week_start + 7) % 7));
  const ids = employees.map((e) => e.id);

  const [patterns, holidays, records, leaves] = await Promise.all([
    all<PatternRow>(db, "SELECT * FROM work_patterns"),
    all<{ date: string; name: string }>(db, "SELECT date, name FROM holidays WHERE date BETWEEN ? AND ?", weekStartDate, end),
    all<any>(
      db,
      `SELECT * FROM attendance_days WHERE employee_id IN (${placeholders(ids.length)}) AND work_date BETWEEN ? AND ?`,
      ...ids,
      weekStartDate,
      end,
    ),
    all<any>(
      db,
      `SELECT lr.employee_id, lr.leave_date, lr.unit, lt.name, lt.is_paid
         FROM leave_records lr JOIN leave_types lt ON lt.id = lr.leave_type_id
        WHERE lr.employee_id IN (${placeholders(ids.length)}) AND lr.leave_date BETWEEN ? AND ?`,
      ...ids,
      weekStartDate,
      end,
    ),
  ]);
  const holidaySet = new Set(holidays.map((h) => h.date));
  const holidayName = new Map(holidays.map((h) => [h.date, h.name]));
  const defaultPattern = patterns.find((p) => p.is_default) ?? patterns[0];
  const recMap = new Map<string, any>();
  for (const r of records) recMap.set(`${r.employee_id}:${r.work_date}`, r);
  const leaveMap = new Map<string, LeaveOnDay[]>();
  for (const l of leaves) {
    const k = `${l.employee_id}:${l.leave_date}`;
    if (!leaveMap.has(k)) leaveMap.set(k, []);
    leaveMap.get(k)!.push({ unit: l.unit, paid: !!l.is_paid, name: l.name });
  }

  const dates = eachDay(weekStartDate, end);
  const nextDates = new Map(dates.map((d) => [d, addDays(d, 1)]));
  for (const emp of employees) {
    const pattern = toPattern(patterns.find((p) => p.id === emp.work_pattern_id) ?? defaultPattern);
    let fullScheduledDays = 0;
    const views: DayView[] = [];
    for (const date of dates) {
      const rec = recMap.get(`${emp.id}:${date}`);
      const inEmployment = date >= emp.hire_date && (!emp.leave_date || date <= emp.leave_date);
      let dayType = dayTypeOf(date, pattern, holidaySet, company.legal_holiday_weekday);
      if (date >= start && dayType === "workday") fullScheduledDays++;
      if (!inEmployment && !rec) dayType = dayType === "legal_holiday" ? dayType : "scheduled_off";
      const breaks = parseJson<BreakInterval[]>(rec?.breaks, []);
      const r = calcDay(
        {
          date,
          clockIn: rec?.clock_in ?? null,
          clockOut: rec?.clock_out ?? null,
          breaks,
          dayType,
          leaves: leaveMap.get(`${emp.id}:${date}`) ?? [],
          nextDayType: dayTypeOf(nextDates.get(date)!, pattern, holidaySet, company.legal_holiday_weekday),
        },
        pattern,
        today,
      );
      views.push({ ...r, breaks, note: rec?.note ?? null, inEmployment, holidayName: holidayName.get(date) ?? null });
    }
    const { summary, days } = summarizePeriod(views, start, end, company.week_start);
    const merged = days.filter((d) => d.date >= start) as DayView[];
    const workdayWorkDays = merged.filter((d) => d.dayType === "workday" && d.workMinutes > 0).length;
    result.set(emp.id, { days: merged, summary, fullScheduledDays, workdayWorkDays, pattern });
  }
  return result;
}

export async function computeEmployeePeriod(
  db: D1Database,
  employeeId: number,
  start: string,
  end: string,
  today: string,
  company: Company,
): Promise<EmployeePeriod> {
  const emp = await first<AttendanceEmployee>(db, "SELECT id, hire_date, leave_date, work_pattern_id FROM employees WHERE id = ?", employeeId);
  if (!emp) throw badRequest("従業員が見つかりません");
  return (await computePeriods(db, [emp], start, end, today, company)).get(employeeId)!;
}

export type PunchKind = "clock_in" | "clock_out" | "break_start" | "break_end";

export interface PunchState {
  workDate: string | null;
  status: "off" | "working" | "on_break" | "done";
  clockIn: string | null;
  clockOut: string | null;
  breaks: BreakInterval[];
}

/** 現在の打刻状態 (日をまたぐ勤務に対応するため前日の未退勤レコードも見る) */
export async function punchState(db: D1Database, employeeId: number, now: string): Promise<PunchState> {
  const today = now.slice(0, 10);
  const rows = await all<any>(
    db,
    "SELECT * FROM attendance_days WHERE employee_id = ? AND work_date BETWEEN ? AND ? ORDER BY work_date DESC",
    employeeId,
    addDays(today, -1),
    today,
  );
  const open = rows.find((r) => r.clock_in && !r.clock_out);
  const rec = open ?? rows.find((r) => r.work_date === today);
  if (!rec) return { workDate: null, status: "off", clockIn: null, clockOut: null, breaks: [] };
  const breaks = parseJson<BreakInterval[]>(rec.breaks, []);
  let status: PunchState["status"] = "off";
  if (rec.clock_in && !rec.clock_out) status = breaks.some((b) => b.start && !b.end) ? "on_break" : "working";
  else if (rec.clock_in && rec.clock_out) status = "done";
  return { workDate: rec.work_date, status, clockIn: rec.clock_in, clockOut: rec.clock_out, breaks };
}

export async function punch(
  db: D1Database,
  employeeId: number,
  kind: PunchKind,
  now: string,
  company: Company,
  ip: string | null,
): Promise<PunchState> {
  const state = await punchState(db, employeeId, now);
  const today = now.slice(0, 10);
  const workDate = kind === "clock_in" ? today : state.workDate;
  if (!workDate) throw conflict("出勤打刻がありません");
  if (await isLocked(db, attendanceMonthOf(workDate, company.closing_day))) throw conflict("この月の勤怠は締め済みのため打刻できません");

  if (kind === "clock_in") {
    if ((state.status === "working" || state.status === "on_break") && state.workDate === today) throw conflict("すでに出勤しています");
    if (state.workDate === today && state.status === "done") throw conflict("本日はすでに退勤しています。修正する場合は打刻修正申請をしてください");
    await run(
      db,
      `INSERT INTO attendance_days (employee_id, work_date, clock_in, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT (employee_id, work_date) DO UPDATE SET clock_in = excluded.clock_in, updated_at = datetime('now')`,
      employeeId,
      today,
      now,
    );
  } else {
    if (state.status !== "working" && state.status !== "on_break") throw conflict("出勤中ではありません");
    const breaks = [...state.breaks];
    if (kind === "break_start") {
      if (state.status === "on_break") throw conflict("すでに休憩中です");
      breaks.push({ start: now, end: null });
      await run(db, "UPDATE attendance_days SET breaks = ?, updated_at = datetime('now') WHERE employee_id = ? AND work_date = ?", JSON.stringify(breaks), employeeId, workDate);
    } else if (kind === "break_end") {
      if (state.status !== "on_break") throw conflict("休憩中ではありません");
      const open = breaks.find((b) => !b.end)!;
      open.end = now;
      await run(db, "UPDATE attendance_days SET breaks = ?, updated_at = datetime('now') WHERE employee_id = ? AND work_date = ?", JSON.stringify(breaks), employeeId, workDate);
    } else {
      for (const b of breaks) if (!b.end) b.end = now; // 休憩中に退勤した場合は休憩を閉じる
      await run(
        db,
        "UPDATE attendance_days SET clock_out = ?, breaks = ?, updated_at = datetime('now') WHERE employee_id = ? AND work_date = ?",
        now,
        JSON.stringify(breaks),
        employeeId,
        workDate,
      );
    }
  }
  await run(db, "INSERT INTO punches (employee_id, punched_at, kind, ip) VALUES (?, ?, ?, ?)", employeeId, now, kind, ip);
  return punchState(db, employeeId, now);
}

export interface DayEdit {
  clock_in: string | null;
  clock_out: string | null;
  breaks: BreakInterval[];
  note?: string | null;
}

export function validateDayEdit(date: string, edit: DayEdit): void {
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
  for (const v of [edit.clock_in, edit.clock_out, ...edit.breaks.flatMap((b) => [b.start, b.end])]) {
    if (v && !iso.test(v)) throw badRequest("時刻の形式が正しくありません");
  }
  if (edit.clock_in && edit.clock_in.slice(0, 10) !== date && edit.clock_in.slice(0, 10) !== addDays(date, 1)) {
    throw badRequest("出勤時刻の日付が勤務日と一致しません");
  }
  if (edit.clock_in && edit.clock_out && edit.clock_out <= edit.clock_in) throw badRequest("退勤は出勤より後にしてください");
  if (!edit.clock_in && edit.clock_out) throw badRequest("出勤時刻を入力してください");
  for (const b of edit.breaks) {
    if (!b.start || !b.end) throw badRequest("休憩の開始と終了を入力してください");
    if (b.end <= b.start) throw badRequest("休憩の終了は開始より後にしてください");
    if (edit.clock_in && b.start < edit.clock_in) throw badRequest("休憩は勤務時間内にしてください");
    if (edit.clock_out && b.end > edit.clock_out) throw badRequest("休憩は勤務時間内にしてください");
  }
}

export async function saveDay(db: D1Database, employeeId: number, date: string, edit: DayEdit, company: Company): Promise<void> {
  if (await isLocked(db, attendanceMonthOf(date, company.closing_day))) throw conflict("この月の勤怠は締め済みです。締めを解除してから修正してください");
  validateDayEdit(date, edit);
  const s = (v: string | null) => (v && v.length === 16 ? `${v}:00` : v);
  await run(
    db,
    `INSERT INTO attendance_days (employee_id, work_date, clock_in, clock_out, breaks, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (employee_id, work_date) DO UPDATE SET clock_in = excluded.clock_in, clock_out = excluded.clock_out,
       breaks = excluded.breaks, note = excluded.note, updated_at = datetime('now')`,
    employeeId,
    date,
    s(edit.clock_in),
    s(edit.clock_out),
    JSON.stringify(edit.breaks.map((b) => ({ start: s(b.start), end: s(b.end) }))),
    edit.note ?? null,
  );
}
