import { Hono } from "hono";
import { all, first, insert, run } from "../lib/db";
import { badRequest, conflict, tzOffset, type AppEnv } from "../lib/context";
import { requireRole } from "../lib/auth";
import { audit, loadCompany, subordinateIds } from "../domain/common";
import { holidayStatements } from "../lib/defaults";
import { punchState, computeEmployeePeriod } from "../domain/attendance";
import { leaveBalance } from "../domain/leave";
import { attendanceMonthOf, attendancePeriod, nowLocal, todayLocal } from "../../shared/dates";
import { NATIONAL_HOLIDAYS } from "../../shared/holidays";

export const settingsRoutes = new Hono<AppEnv>();
const admin = requireRole("admin");

/** 画面のプルダウン用マスタ一式 */
settingsRoutes.get("/lookups", async (c) => {
  const db = c.env.DB;
  const [departments, positions, workPatterns, leaveTypes, employees, forms, categories, routes] = await Promise.all([
    all(db, "SELECT id, name, parent_id, head_employee_id FROM departments ORDER BY sort_order, id"),
    all(db, "SELECT id, name, rank FROM positions ORDER BY rank DESC, id"),
    all(db, "SELECT * FROM work_patterns ORDER BY is_default DESC, id"),
    all(db, "SELECT * FROM leave_types WHERE active = 1 ORDER BY sort_order, id"),
    all(db, "SELECT id, code, last_name, first_name, department_id, status FROM employees WHERE status != 'retired' ORDER BY code"),
    all(db, "SELECT id, kind, name, description FROM request_forms WHERE active = 1 ORDER BY sort_order, id"),
    all(db, "SELECT * FROM expense_categories WHERE active = 1 ORDER BY sort_order, id"),
    all(db, "SELECT id, name FROM approval_routes ORDER BY id"),
  ]);
  return c.json({ departments, positions, workPatterns, leaveTypes, employees, forms, categories, routes });
});

settingsRoutes.get("/dashboard", async (c) => {
  const user = c.get("user");
  const db = c.env.DB;
  const company = (await loadCompany(db))!;
  const now = nowLocal(tzOffset(c.env));
  const today = now.slice(0, 10);
  const month = attendanceMonthOf(today, company.closing_day);
  const { start, end } = attendancePeriod(month, company.closing_day);
  const [state, period, leave, announcements, myPending] = await Promise.all([
    punchState(db, user.employeeId, now),
    computeEmployeePeriod(db, user.employeeId, start, end, today, company),
    leaveBalance(db, user.employeeId, today),
    all(db, "SELECT * FROM announcements WHERE published_on <= ? ORDER BY published_on DESC, id DESC LIMIT 5", today),
    all(db, "SELECT id, title, status, kind, submitted_at FROM requests WHERE applicant_id = ? AND status IN ('pending', 'returned', 'draft') ORDER BY id DESC LIMIT 5", user.employeeId),
  ]);
  const approvals = await first<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM requests r WHERE r.status = 'pending' AND r.applicant_id != ? AND EXISTS (
       SELECT 1 FROM request_steps s WHERE s.request_id = r.id AND s.status = 'pending'
         AND (s.approver_id = ? OR (s.approver_role IS NOT NULL AND s.approver_role = ?)))`,
    user.employeeId,
    user.employeeId,
    user.role,
  );
  const latestSlip = await first<any>(
    db,
    `SELECT p.id, p.net_pay, r.pay_month, r.pay_date FROM payslips p JOIN payroll_runs r ON r.id = p.run_id
      WHERE p.employee_id = ? AND r.status = 'published' ORDER BY r.pay_month DESC LIMIT 1`,
    user.employeeId,
  );
  let teamStats: any = null;
  if (user.role !== "employee") {
    const ids = user.role === "admin"
      ? (await all<{ id: number }>(db, "SELECT id FROM employees WHERE status IN ('active', 'leave_of_absence') AND hire_date <= ?", today)).map((r) => r.id)
      : await subordinateIds(db, user.employeeId);
    const recs = ids.length ? await all<any>(db, `SELECT employee_id, clock_in, clock_out FROM attendance_days WHERE work_date = ? AND employee_id IN (${ids.map(() => "?").join(",")})`, today, ...ids) : [];
    const onLeave = ids.length ? await first<{ n: number }>(db, `SELECT COUNT(DISTINCT employee_id) AS n FROM leave_records WHERE leave_date = ? AND employee_id IN (${ids.map(() => "?").join(",")})`, today, ...ids) : { n: 0 };
    teamStats = {
      total: ids.length,
      working: recs.filter((r) => r.clock_in && !r.clock_out).length,
      done: recs.filter((r) => r.clock_out).length,
      onLeave: onLeave?.n ?? 0,
    };
  }
  let adminAlerts: any = null;
  if (user.role === "admin") {
    const payables = await first<{ n: number; total: number }>(
      db,
      "SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM requests WHERE kind = 'expense' AND status = 'approved' AND paid_at IS NULL AND json_extract(payload, '$.settlement') = 'transfer'",
    );
    const noSalary = await first<{ n: number }>(
      db,
      "SELECT COUNT(*) AS n FROM employees e LEFT JOIN salary_settings s ON s.employee_id = e.id WHERE e.status != 'retired' AND s.employee_id IS NULL",
    );
    const upcoming = await all<any>(
      db,
      "SELECT id, last_name, first_name, hire_date, leave_date, status FROM employees WHERE (hire_date > ? AND hire_date <= date(?, '+30 days')) OR (leave_date >= ? AND leave_date <= date(?, '+30 days')) ORDER BY COALESCE(leave_date, hire_date)",
      today,
      today,
      today,
      today,
    );
    adminAlerts = { unpaidExpenses: payables, employeesWithoutSalary: noSalary?.n ?? 0, upcoming };
  }
  return c.json({
    now,
    today,
    month,
    punch: state,
    summary: period.summary,
    leave: { available: leave.available, pending: leave.pending, next: leave.next },
    approvals: approvals?.n ?? 0,
    myPending,
    announcements,
    latestSlip,
    teamStats,
    adminAlerts,
    overtimeAlertHours: company.overtime_alert_hours,
  });
});

// ── 会社設定
settingsRoutes.get("/settings/company", async (c) => c.json(await loadCompany(c.env.DB)));

settingsRoutes.put("/settings/company", admin, async (c) => {
  const b = await c.req.json<any>();
  const closing = Number(b.closing_day);
  if (!(closing >= 0 && closing <= 28)) throw badRequest("締め日は末日 (0) か 1〜28 で指定してください");
  const payDay = Number(b.pay_day);
  if (!(payDay >= 0 && payDay <= 31)) throw badRequest("支給日が正しくありません");
  await run(
    c.env.DB,
    `UPDATE company SET name = ?, app_name = ?, closing_day = ?, pay_day = ?, pay_month_offset = ?, social_insurance_timing = ?,
       legal_holiday_weekday = ?, week_start = ?, monthly_avg_hours = ?, overtime_alert_hours = ? WHERE id = 1`,
    String(b.name ?? "").trim() || "未設定",
    String(b.app_name ?? "").trim() || "ミナモ",
    closing,
    payDay,
    Number(b.pay_month_offset) === 0 ? 0 : 1,
    b.social_insurance_timing === "current" ? "current" : "next",
    Number(b.legal_holiday_weekday ?? 0) % 7,
    Number(b.week_start ?? 0) % 7,
    Number(b.monthly_avg_hours) > 0 ? Number(b.monthly_avg_hours) : 160,
    Number(b.overtime_alert_hours) > 0 ? Number(b.overtime_alert_hours) : 45,
  );
  await audit(c.env.DB, c.get("user"), "company.update", "company", 1, b);
  return c.json({ ok: true });
});

// ── 勤務パターン
settingsRoutes.get("/settings/work-patterns", async (c) => c.json(await all(c.env.DB, "SELECT * FROM work_patterns ORDER BY is_default DESC, id")));

function patternValues(b: any) {
  const hhmm = /^\d{2}:\d{2}$/;
  if (!b.name?.trim()) throw badRequest("名称を入力してください");
  if (!hhmm.test(b.start_time) || !hhmm.test(b.end_time)) throw badRequest("始業・終業時刻を HH:MM で入力してください");
  const days = (Array.isArray(b.work_days) ? b.work_days : String(b.work_days ?? "").split(",")).map(Number).filter((n: number) => n >= 0 && n <= 6);
  return [b.name.trim(), b.start_time, b.end_time, Number(b.break_minutes ?? 60), Number(b.scheduled_minutes ?? 480), [...new Set(days)].sort().join(","), Number(b.late_grace_minutes ?? 0)];
}

settingsRoutes.post("/settings/work-patterns", admin, async (c) => {
  const v = patternValues(await c.req.json<any>());
  return c.json({ id: await insert(c.env.DB, "INSERT INTO work_patterns (name, start_time, end_time, break_minutes, scheduled_minutes, work_days, late_grace_minutes) VALUES (?, ?, ?, ?, ?, ?, ?)", ...v) });
});

settingsRoutes.put("/settings/work-patterns/:id", admin, async (c) => {
  const b = await c.req.json<any>();
  const id = Number(c.req.param("id"));
  await run(c.env.DB, "UPDATE work_patterns SET name = ?, start_time = ?, end_time = ?, break_minutes = ?, scheduled_minutes = ?, work_days = ?, late_grace_minutes = ? WHERE id = ?", ...patternValues(b), id);
  if (b.is_default) await run(c.env.DB, "UPDATE work_patterns SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END", id);
  return c.json({ ok: true });
});

settingsRoutes.delete("/settings/work-patterns/:id", admin, async (c) => {
  const id = Number(c.req.param("id"));
  const used = await first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM employees WHERE work_pattern_id = ?", id);
  if (used?.n) throw conflict("この勤務パターンを使っている従業員がいます");
  await run(c.env.DB, "DELETE FROM work_patterns WHERE id = ? AND is_default = 0", id);
  return c.json({ ok: true });
});

// ── 休日カレンダー
settingsRoutes.get("/settings/holidays", async (c) => {
  const year = c.req.query("year") ?? todayLocal(tzOffset(c.env)).slice(0, 4);
  return c.json({
    holidays: await all(c.env.DB, "SELECT * FROM holidays WHERE date LIKE ? ORDER BY date", `${year}%`),
    importableYears: Object.keys(NATIONAL_HOLIDAYS).map(Number),
  });
});

settingsRoutes.post("/settings/holidays", admin, async (c) => {
  const b = await c.req.json<any>();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date ?? "") || !b.name?.trim()) throw badRequest("日付と名称を入力してください");
  await run(c.env.DB, "INSERT OR REPLACE INTO holidays (date, name, kind) VALUES (?, ?, ?)", b.date, b.name.trim(), b.kind === "national" ? "national" : "company");
  return c.json({ ok: true });
});

settingsRoutes.post("/settings/holidays/import", admin, async (c) => {
  const { year } = await c.req.json<{ year: number }>();
  const stmts = holidayStatements(c.env.DB, [Number(year)]);
  if (!stmts.length) throw badRequest(`${year}年の祝日データは同梱されていません。手動で登録してください`);
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, count: stmts.length });
});

settingsRoutes.delete("/settings/holidays/:date", admin, async (c) => {
  await run(c.env.DB, "DELETE FROM holidays WHERE date = ?", c.req.param("date"));
  return c.json({ ok: true });
});

// ── 休暇種別
settingsRoutes.get("/settings/leave-types", async (c) => c.json(await all(c.env.DB, "SELECT * FROM leave_types ORDER BY sort_order, id")));

settingsRoutes.post("/settings/leave-types", admin, async (c) => {
  const b = await c.req.json<any>();
  if (!b.name?.trim()) throw badRequest("名称を入力してください");
  const code = String(b.code || `custom_${Date.now()}`);
  return c.json({
    id: await insert(c.env.DB, "INSERT INTO leave_types (name, code, is_paid, uses_annual_leave, allow_half_day, sort_order) VALUES (?, ?, ?, 0, ?, 100)", b.name.trim(), code, b.is_paid ? 1 : 0, b.allow_half_day ? 1 : 0),
  });
});

settingsRoutes.put("/settings/leave-types/:id", admin, async (c) => {
  const b = await c.req.json<any>();
  await run(
    c.env.DB,
    "UPDATE leave_types SET name = ?, is_paid = ?, allow_half_day = ?, active = ? WHERE id = ?",
    b.name,
    b.is_paid ? 1 : 0,
    b.allow_half_day ? 1 : 0,
    b.active === false ? 0 : 1,
    Number(c.req.param("id")),
  );
  return c.json({ ok: true });
});

// ── 保険料率
settingsRoutes.get("/settings/insurance-rates", admin, async (c) => c.json(await all(c.env.DB, "SELECT * FROM insurance_rates ORDER BY kind, effective_from DESC")));

settingsRoutes.post("/settings/insurance-rates", admin, async (c) => {
  const b = await c.req.json<any>();
  const kinds = ["health", "care", "child_support", "pension", "employment_employee", "employment_employer"];
  if (!kinds.includes(b.kind)) throw badRequest("種類が正しくありません");
  if (!/^\d{4}-\d{2}$/.test(b.effective_from ?? "")) throw badRequest("適用開始月を YYYY-MM で入力してください");
  const rate = Number(b.rate);
  if (!(rate >= 0 && rate < 100)) throw badRequest("料率 (%) を正しく入力してください");
  await run(c.env.DB, "INSERT OR REPLACE INTO insurance_rates (kind, effective_from, rate, note) VALUES (?, ?, ?, ?)", b.kind, b.effective_from, rate, b.note ?? "");
  await audit(c.env.DB, c.get("user"), "rate.upsert", "insurance_rate", `${b.kind}:${b.effective_from}`, { rate });
  return c.json({ ok: true });
});

settingsRoutes.delete("/settings/insurance-rates/:id", admin, async (c) => {
  await run(c.env.DB, "DELETE FROM insurance_rates WHERE id = ?", Number(c.req.param("id")));
  return c.json({ ok: true });
});

// ── お知らせ
settingsRoutes.get("/announcements", async (c) => c.json(await all(c.env.DB, "SELECT * FROM announcements ORDER BY published_on DESC, id DESC LIMIT 100")));
settingsRoutes.post("/announcements", admin, async (c) => {
  const b = await c.req.json<any>();
  if (!b.title?.trim()) throw badRequest("タイトルを入力してください");
  await insert(c.env.DB, "INSERT INTO announcements (title, body, published_on, created_by) VALUES (?, ?, ?, ?)", b.title.trim(), b.body ?? "", b.published_on || todayLocal(tzOffset(c.env)), c.get("user").employeeId);
  return c.json({ ok: true });
});
settingsRoutes.delete("/announcements/:id", admin, async (c) => {
  await run(c.env.DB, "DELETE FROM announcements WHERE id = ?", Number(c.req.param("id")));
  return c.json({ ok: true });
});

settingsRoutes.get("/audit-logs", admin, async (c) => {
  return c.json(
    await all(
      c.env.DB,
      `SELECT a.*, e.last_name || ' ' || e.first_name AS user_name FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id LEFT JOIN employees e ON e.id = u.employee_id ORDER BY a.id DESC LIMIT 200`,
    ),
  );
});
