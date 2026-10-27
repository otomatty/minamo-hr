import { Hono } from "hono";
import { all, first, insert, run } from "../lib/db";
import { badRequest, forbidden, notFound, tzOffset, type AppEnv } from "../lib/context";
import { requireRole } from "../lib/auth";
import { audit, canViewEmployee, isLocked, loadCompany, subordinateIds } from "../domain/common";
import { computeEmployeePeriod, computePeriods, punch, punchState, saveDay, type PunchKind } from "../domain/attendance";
import { leaveBalance } from "../domain/leave";
import { attendanceMonthOf, attendancePeriod, formatMinutes, nowLocal, todayLocal, WEEKDAY_JA, weekday } from "../../shared/dates";
import { toCsv } from "../lib/csv";
import { csvResponse } from "./employees";

export const attendanceRoutes = new Hono<AppEnv>();

attendanceRoutes.get("/attendance/state", async (c) => {
  const user = c.get("user");
  return c.json(await punchState(c.env.DB, user.employeeId, nowLocal(tzOffset(c.env))));
});

attendanceRoutes.post("/attendance/punch", async (c) => {
  const user = c.get("user");
  const { kind } = await c.req.json<{ kind: PunchKind }>();
  if (!["clock_in", "clock_out", "break_start", "break_end"].includes(kind)) throw badRequest("打刻の種類が正しくありません");
  const company = (await loadCompany(c.env.DB))!;
  const state = await punch(c.env.DB, user.employeeId, kind, nowLocal(tzOffset(c.env)), company, c.req.header("CF-Connecting-IP") ?? null);
  return c.json(state);
});

/** 月次勤怠 (本人 / 部下 / 管理者) */
attendanceRoutes.get("/attendance/month", async (c) => {
  const user = c.get("user");
  const employeeId = Number(c.req.query("employeeId") ?? user.employeeId);
  if (!(await canViewEmployee(c.env.DB, user, employeeId))) throw forbidden();
  const company = (await loadCompany(c.env.DB))!;
  const today = todayLocal(tzOffset(c.env));
  const month = c.req.query("month") ?? attendanceMonthOf(today, company.closing_day);
  const { start, end } = attendancePeriod(month, company.closing_day);
  const result = await computeEmployeePeriod(c.env.DB, employeeId, start, end, today, company);
  const employee = await first<any>(
    c.env.DB,
    "SELECT e.id, e.code, e.last_name, e.first_name, d.name AS department_name FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE e.id = ?",
    employeeId,
  );
  const pendingFixes = await all<any>(
    c.env.DB,
    "SELECT id, json_extract(payload, '$.date') AS date, status FROM requests WHERE applicant_id = ? AND kind IN ('punch_fix', 'leave') AND status = 'pending'",
    employeeId,
  );
  return c.json({
    month,
    start,
    end,
    employee,
    locked: await isLocked(c.env.DB, month),
    days: result.days,
    summary: result.summary,
    pattern: result.pattern,
    overtimeAlertHours: company.overtime_alert_hours,
    pendingRequests: pendingFixes,
  });
});

/** 管理者・マネージャー: 1日分の勤怠を直接修正 */
attendanceRoutes.put("/attendance/day", requireRole("admin", "manager"), async (c) => {
  const user = c.get("user");
  const b = await c.req.json<any>();
  const employeeId = Number(b.employeeId);
  if (user.role !== "admin" && !(await subordinateIds(c.env.DB, user.employeeId)).includes(employeeId)) throw forbidden();
  const company = (await loadCompany(c.env.DB))!;
  await saveDay(c.env.DB, employeeId, b.date, { clock_in: b.clock_in || null, clock_out: b.clock_out || null, breaks: b.breaks ?? [], note: b.note ?? null }, company);
  await audit(c.env.DB, user, "attendance.edit", "employee", employeeId, { date: b.date, clock_in: b.clock_in, clock_out: b.clock_out });
  return c.json({ ok: true });
});

async function visibleEmployees(c: any) {
  const user = c.get("user");
  const rows = await all<any>(
    c.env.DB,
    `SELECT e.id, e.code, e.last_name, e.first_name, e.hire_date, e.leave_date, e.work_pattern_id, e.employment_type, e.department_id,
            d.name AS department_name
       FROM employees e LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.status != 'retired' OR e.leave_date >= date('now', '-62 days') ORDER BY e.code`,
  );
  if (user.role === "admin") return rows;
  const ids = new Set(await subordinateIds(c.env.DB, user.employeeId));
  return rows.filter((r) => ids.has(r.id));
}

/** 管理者・マネージャー: 全員の月次集計 */
attendanceRoutes.get("/attendance/summary", requireRole("admin", "manager"), async (c) => {
  const company = (await loadCompany(c.env.DB))!;
  const today = todayLocal(tzOffset(c.env));
  const month = c.req.query("month") ?? attendanceMonthOf(today, company.closing_day);
  const { start, end } = attendancePeriod(month, company.closing_day);
  const emps = (await visibleEmployees(c)).filter((e: any) => e.hire_date <= end && (!e.leave_date || e.leave_date >= start));
  const periods = await computePeriods(c.env.DB, emps, start, end, today, company);
  return c.json({
    month,
    start,
    end,
    locked: await isLocked(c.env.DB, month),
    overtimeAlertHours: company.overtime_alert_hours,
    rows: emps.map((e: any) => ({ employee: e, summary: periods.get(e.id)!.summary })),
  });
});

/** 本日の出勤状況 */
attendanceRoutes.get("/attendance/today", requireRole("admin", "manager"), async (c) => {
  const today = todayLocal(tzOffset(c.env));
  const emps = (await visibleEmployees(c)).filter((e: any) => e.hire_date <= today && (!e.leave_date || e.leave_date >= today));
  const recs = await all<any>(c.env.DB, "SELECT * FROM attendance_days WHERE work_date = ?", today);
  const leaves = await all<any>(
    c.env.DB,
    "SELECT lr.employee_id, lr.unit, lt.name FROM leave_records lr JOIN leave_types lt ON lt.id = lr.leave_type_id WHERE lr.leave_date = ?",
    today,
  );
  return c.json(
    emps.map((e: any) => {
      const r = recs.find((x) => x.employee_id === e.id);
      const breaks = r ? JSON.parse(r.breaks) : [];
      const status = !r?.clock_in ? "off" : r.clock_out ? "done" : breaks.some((b: any) => !b.end) ? "on_break" : "working";
      return { employee: e, clock_in: r?.clock_in ?? null, clock_out: r?.clock_out ?? null, status, leave: leaves.find((l) => l.employee_id === e.id) ?? null };
    }),
  );
});

attendanceRoutes.post("/attendance/lock", requireRole("admin"), async (c) => {
  const { month } = await c.req.json<{ month: string }>();
  if (!/^\d{4}-\d{2}$/.test(month)) throw badRequest("月を指定してください");
  await run(c.env.DB, "INSERT OR IGNORE INTO attendance_locks (period, locked_by) VALUES (?, ?)", month, c.get("user").employeeId);
  await audit(c.env.DB, c.get("user"), "attendance.lock", "period", month);
  return c.json({ ok: true });
});

attendanceRoutes.delete("/attendance/lock/:month", requireRole("admin"), async (c) => {
  await run(c.env.DB, "DELETE FROM attendance_locks WHERE period = ?", c.req.param("month"));
  await audit(c.env.DB, c.get("user"), "attendance.unlock", "period", c.req.param("month"));
  return c.json({ ok: true });
});

attendanceRoutes.get("/attendance/export.csv", requireRole("admin"), async (c) => {
  const company = (await loadCompany(c.env.DB))!;
  const today = todayLocal(tzOffset(c.env));
  const month = c.req.query("month") ?? attendanceMonthOf(today, company.closing_day);
  const detail = c.req.query("detail") === "1";
  const { start, end } = attendancePeriod(month, company.closing_day);
  const emps = (await visibleEmployees(c)).filter((e: any) => e.hire_date <= end && (!e.leave_date || e.leave_date >= start));
  const periods = await computePeriods(c.env.DB, emps, start, end, today, company);
  const h = (m: number) => formatMinutes(m);
  if (detail) {
    const rows: unknown[][] = [];
    for (const e of emps) {
      for (const d of periods.get(e.id)!.days) {
        rows.push([
          e.code, `${e.last_name} ${e.first_name}`, d.date, WEEKDAY_JA[weekday(d.date)],
          d.dayType === "workday" ? "出勤日" : d.dayType === "legal_holiday" ? "法定休日" : "所定休日",
          d.clockIn?.slice(11, 16) ?? "", d.clockOut?.slice(11, 16) ?? "", h(d.breakMinutes), h(d.workMinutes),
          h(d.withinLegalOvertime + d.nonScheduledMinutes), h(d.legalOvertime), h(d.lateNightMinutes), h(d.legalHolidayMinutes),
          d.leaveNames.join("/"), d.absent ? "欠勤" : "",
        ]);
      }
    }
    return csvResponse(
      toCsv(["社員番号", "氏名", "日付", "曜日", "区分", "出勤", "退勤", "休憩", "実働", "法定内残業", "法定外残業", "深夜", "法定休日", "休暇", "欠勤"], rows),
      `attendance-detail-${month}.csv`,
    );
  }
  const rows = emps.map((e: any) => {
    const s = periods.get(e.id)!.summary;
    return [
      e.code, `${e.last_name} ${e.first_name}`, e.department_name, s.scheduledDays, s.workDays, s.absenceDays, s.paidLeaveDays,
      s.unpaidLeaveDays, h(s.totalWorkMinutes), h(s.withinLegalOvertime + s.nonScheduledMinutes), h(s.legalOvertime),
      h(s.over60Minutes), h(s.lateNightMinutes), h(s.legalHolidayMinutes), s.lateCount, s.earlyLeaveCount,
    ];
  });
  return csvResponse(
    toCsv(
      ["社員番号", "氏名", "部署", "所定労働日数", "出勤日数", "欠勤日数", "有給取得日数", "無給休暇日数", "総労働時間", "法定内残業", "法定外残業", "60時間超", "深夜労働", "法定休日労働", "遅刻回数", "早退回数"],
      rows,
    ),
    `attendance-${month}.csv`,
  );
});

// ── 休暇
attendanceRoutes.get("/leave/balance", async (c) => {
  const user = c.get("user");
  const employeeId = Number(c.req.query("employeeId") ?? user.employeeId);
  if (!(await canViewEmployee(c.env.DB, user, employeeId))) throw forbidden();
  const today = todayLocal(tzOffset(c.env));
  const records = await all<any>(
    c.env.DB,
    `SELECT lr.*, lt.name AS type_name FROM leave_records lr JOIN leave_types lt ON lt.id = lr.leave_type_id
      WHERE lr.employee_id = ? ORDER BY lr.leave_date DESC LIMIT 100`,
    employeeId,
  );
  return c.json({ ...(await leaveBalance(c.env.DB, employeeId, today)), records });
});

attendanceRoutes.post("/leave/grants", requireRole("admin"), async (c) => {
  const b = await c.req.json<any>();
  const days = Number(b.days);
  if (!b.employee_id || !b.granted_on || !b.expires_on || !(days > 0)) throw badRequest("付与日・失効日・日数を入力してください");
  if (b.expires_on <= b.granted_on) throw badRequest("失効日は付与日より後にしてください");
  await insert(
    c.env.DB,
    "INSERT INTO leave_grants (employee_id, granted_on, expires_on, days, remaining, reason) VALUES (?, ?, ?, ?, ?, ?)",
    Number(b.employee_id),
    b.granted_on,
    b.expires_on,
    days,
    b.remaining !== undefined && b.remaining !== "" ? Number(b.remaining) : days,
    b.reason === "carryover" ? "carryover" : "manual",
  );
  await audit(c.env.DB, c.get("user"), "leave.grant", "employee", b.employee_id, b);
  return c.json({ ok: true });
});

attendanceRoutes.put("/leave/grants/:id", requireRole("admin"), async (c) => {
  const b = await c.req.json<any>();
  const g = await first<any>(c.env.DB, "SELECT * FROM leave_grants WHERE id = ?", Number(c.req.param("id")));
  if (!g) throw notFound();
  const remaining = Number(b.remaining);
  if (Number.isNaN(remaining) || remaining < 0) throw badRequest("残日数を正しく入力してください");
  await run(c.env.DB, "UPDATE leave_grants SET remaining = ?, expires_on = COALESCE(?, expires_on) WHERE id = ?", remaining, b.expires_on || null, g.id);
  await audit(c.env.DB, c.get("user"), "leave.grant_adjust", "employee", g.employee_id, { grant: g.id, remaining });
  return c.json({ ok: true });
});

attendanceRoutes.delete("/leave/grants/:id", requireRole("admin"), async (c) => {
  await run(c.env.DB, "DELETE FROM leave_grants WHERE id = ?", Number(c.req.param("id")));
  return c.json({ ok: true });
});

/** 年5日の取得義務の状況 (10日以上付与された従業員) */
attendanceRoutes.get("/leave/obligation", requireRole("admin", "manager"), async (c) => {
  const today = todayLocal(tzOffset(c.env));
  const emps = await visibleEmployees(c);
  const out = [];
  for (const e of emps) {
    const b = await leaveBalance(c.env.DB, e.id, today);
    if (!b.currentGrant) continue;
    out.push({ employee: e, grantedOn: b.currentGrant.granted_on, grantedDays: b.currentGrant.days, used: b.usedInCurrentYear, available: b.available });
  }
  return c.json(out);
});
