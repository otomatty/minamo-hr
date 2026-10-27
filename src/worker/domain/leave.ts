import { all, first, insert, run } from "../lib/db";
import { badRequest, conflict } from "../lib/context";
import { grantSchedule, nextGrant } from "../../shared/calc/leave";
import { addMonthsToDate, attendanceMonthOf } from "../../shared/dates";
import { isLocked, type Company } from "./common";

export interface LeaveBalance {
  available: number;
  pending: number;
  grants: Array<{ id: number; granted_on: string; expires_on: string; days: number; remaining: number; reason: string }>;
  next: { granted_on: string; days: number } | null;
  usedInCurrentYear: number; // 直近の付与日からの取得日数 (年5日の取得義務の確認用)
  currentGrant: { granted_on: string; days: number } | null;
}

export async function leaveBalance(db: D1Database, employeeId: number, today: string): Promise<LeaveBalance> {
  const emp = await first<any>(db, "SELECT hire_date, weekly_work_days, weekly_work_hours FROM employees WHERE id = ?", employeeId);
  const grants = await all<any>(
    db,
    "SELECT id, granted_on, expires_on, days, remaining, reason FROM leave_grants WHERE employee_id = ? ORDER BY granted_on DESC",
    employeeId,
  );
  const valid = grants.filter((g) => g.granted_on <= today && g.expires_on > today);
  const available = valid.reduce((t, g) => t + g.remaining, 0);
  const pendingRows = await all<any>(
    db,
    `SELECT r.payload FROM requests r JOIN request_forms f ON f.id = r.form_id
      WHERE r.applicant_id = ? AND r.kind = 'leave' AND r.status = 'pending'`,
    employeeId,
  );
  const annualTypeIds = new Set((await all<{ id: number }>(db, "SELECT id FROM leave_types WHERE uses_annual_leave = 1")).map((r) => r.id));
  let pending = 0;
  for (const r of pendingRows) {
    const p = JSON.parse(r.payload);
    if (annualTypeIds.has(Number(p.leave_type_id))) pending += requestedDays(p.dates ?? []);
  }
  const current = grants.find((g) => g.granted_on <= today && g.days >= 10) ?? null;
  let usedInCurrentYear = 0;
  if (current) {
    const end = addMonthsToDate(current.granted_on, 12);
    const row = await first<{ d: number }>(
      db,
      `SELECT COALESCE(SUM(lr.days), 0) AS d FROM leave_records lr JOIN leave_types lt ON lt.id = lr.leave_type_id
        WHERE lr.employee_id = ? AND lt.uses_annual_leave = 1 AND lr.leave_date >= ? AND lr.leave_date < ?`,
      employeeId,
      current.granted_on,
      end,
    );
    usedInCurrentYear = row?.d ?? 0;
  }
  const n = emp ? nextGrant(emp.hire_date, today, emp.weekly_work_days, emp.weekly_work_hours) : null;
  return {
    available,
    pending,
    grants,
    next: n ? { granted_on: n.grantedOn, days: n.days } : null,
    usedInCurrentYear,
    currentGrant: current ? { granted_on: current.granted_on, days: current.days } : null,
  };
}

export function requestedDays(dates: Array<{ date: string; unit: string }>): number {
  return dates.reduce((t, d) => t + (d.unit === "full" ? 1 : 0.5), 0);
}

export interface LeavePayload {
  leave_type_id: number;
  dates: Array<{ date: string; unit: "full" | "am" | "pm" }>;
  reason?: string;
}

export async function validateLeave(db: D1Database, employeeId: number, p: LeavePayload, today: string, company: Company, excludeRequestId?: number) {
  const type = await first<any>(db, "SELECT * FROM leave_types WHERE id = ? AND active = 1", p.leave_type_id);
  if (!type) throw badRequest("休暇の種類を選択してください");
  if (!Array.isArray(p.dates) || p.dates.length === 0) throw badRequest("取得日を1日以上指定してください");
  if (p.dates.length > 62) throw badRequest("一度に申請できるのは62日までです");
  const seen = new Set<string>();
  for (const d of p.dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) throw badRequest("日付の形式が正しくありません");
    if (!["full", "am", "pm"].includes(d.unit)) throw badRequest("取得単位が正しくありません");
    if (d.unit !== "full" && !type.allow_half_day) throw badRequest(`${type.name}は半日単位で取得できません`);
    if (seen.has(d.date)) throw badRequest("同じ日付が重複しています");
    seen.add(d.date);
    if (await isLocked(db, attendanceMonthOf(d.date, company.closing_day))) throw conflict(`${d.date} は勤怠締め済みの月です`);
  }
  // 取得済み・申請中の休暇と重複していないか (午前休と午後休の組み合わせは可)
  const taken: Array<{ date: string; unit: string }> = (
    await all<any>(
      db,
      `SELECT leave_date AS date, unit FROM leave_records WHERE employee_id = ? AND leave_date IN (${p.dates.map(() => "?").join(",")})`,
      employeeId,
      ...p.dates.map((d) => d.date),
    )
  ).slice();
  const pendingReqs = await all<any>(
    db,
    "SELECT id, payload FROM requests WHERE applicant_id = ? AND kind = 'leave' AND status = 'pending' AND id != ?",
    employeeId,
    excludeRequestId ?? 0,
  );
  for (const r of pendingReqs) for (const d of JSON.parse(r.payload).dates ?? []) taken.push({ date: d.date, unit: d.unit });
  const overlaps = p.dates.filter((d) => taken.some((t) => t.date === d.date && (t.unit === "full" || d.unit === "full" || t.unit === d.unit)));
  if (overlaps.length) throw conflict(`${overlaps.map((d) => d.date).join(", ")} はすでに休暇を取得済みか申請中です`);
  if (type.uses_annual_leave) {
    const bal = await leaveBalance(db, employeeId, today);
    let pending = bal.pending;
    if (excludeRequestId) {
      const cur = await first<any>(db, "SELECT payload, status FROM requests WHERE id = ?", excludeRequestId);
      if (cur?.status === "pending") pending -= requestedDays(JSON.parse(cur.payload).dates ?? []);
    }
    const need = requestedDays(p.dates);
    if (need > bal.available - pending) {
      throw conflict(`有給休暇の残日数が不足しています (残 ${bal.available}日、申請中 ${pending}日、今回 ${need}日)`);
    }
  }
  return type;
}

/** 承認された休暇申請を反映する (年休は古い付与分から消化) */
export async function applyLeave(db: D1Database, requestId: number, employeeId: number, p: LeavePayload): Promise<void> {
  const type = await first<any>(db, "SELECT * FROM leave_types WHERE id = ?", p.leave_type_id);
  if (!type) throw badRequest("休暇の種類が見つかりません");
  for (const d of [...p.dates].sort((a, b) => a.date.localeCompare(b.date))) {
    const days = d.unit === "full" ? 1 : 0.5;
    const recordId = await insert(
      db,
      "INSERT INTO leave_records (employee_id, leave_type_id, leave_date, unit, days, request_id) VALUES (?, ?, ?, ?, ?, ?)",
      employeeId,
      p.leave_type_id,
      d.date,
      d.unit,
      days,
      requestId,
    );
    if (!type.uses_annual_leave) continue;
    let remain = days;
    const grants = await all<any>(
      db,
      "SELECT id, remaining FROM leave_grants WHERE employee_id = ? AND granted_on <= ? AND expires_on > ? AND remaining > 0 ORDER BY granted_on",
      employeeId,
      d.date,
      d.date,
    );
    for (const g of grants) {
      if (remain <= 0) break;
      const use = Math.min(remain, g.remaining);
      await run(db, "UPDATE leave_grants SET remaining = remaining - ? WHERE id = ?", use, g.id);
      await run(db, "INSERT INTO leave_grant_usages (leave_record_id, grant_id, days) VALUES (?, ?, ?)", recordId, g.id, use);
      remain -= use;
    }
    if (remain > 0) throw conflict(`${d.date} 時点の有給休暇の残日数が不足しています`);
  }
}

/** 休暇の取消 (付与残数を戻す) */
export async function revertLeave(db: D1Database, requestId: number): Promise<void> {
  const usages = await all<any>(
    db,
    "SELECT u.grant_id, u.days FROM leave_grant_usages u JOIN leave_records r ON r.id = u.leave_record_id WHERE r.request_id = ?",
    requestId,
  );
  for (const u of usages) await run(db, "UPDATE leave_grants SET remaining = remaining + ? WHERE id = ?", u.days, u.grant_id);
  await run(db, "DELETE FROM leave_records WHERE request_id = ?", requestId);
}

/** 有休の自動付与 (Cron から毎日実行)。失効前の付与で未登録のものを登録する */
export async function autoGrantLeave(db: D1Database, today: string, employeeId?: number): Promise<number> {
  const emps = await all<any>(
    db,
    `SELECT id, hire_date, weekly_work_days, weekly_work_hours FROM employees
      WHERE status IN ('active', 'leave_of_absence', 'pre_hire')${employeeId ? " AND id = ?" : ""}`,
    ...(employeeId ? [employeeId] : []),
  );
  let count = 0;
  for (const e of emps) {
    const plans = grantSchedule(e.hire_date, today, e.weekly_work_days, e.weekly_work_hours).filter((p) => p.expiresOn > today);
    if (!plans.length) continue;
    const existing = new Set(
      (await all<{ granted_on: string }>(db, "SELECT granted_on FROM leave_grants WHERE employee_id = ? AND reason = 'auto'", e.id)).map((r) => r.granted_on),
    );
    for (const p of plans) {
      if (existing.has(p.grantedOn)) continue;
      await run(
        db,
        "INSERT INTO leave_grants (employee_id, granted_on, expires_on, days, remaining, reason) VALUES (?, ?, ?, ?, ?, 'auto')",
        e.id,
        p.grantedOn,
        p.expiresOn,
        p.days,
        p.days,
      );
      count++;
    }
  }
  return count;
}
