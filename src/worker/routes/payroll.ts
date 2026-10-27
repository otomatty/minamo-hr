import { Hono } from "hono";
import { all, first, insert, parseJson, run } from "../lib/db";
import { badRequest, conflict, forbidden, notFound, tzOffset, type AppEnv } from "../lib/context";
import { requireRole } from "../lib/auth";
import { audit, loadCompany } from "../domain/common";
import { calculateRun, confirmRun, createRun, publishRun, reopenRun } from "../domain/payroll";
import { nowLocal, todayLocal } from "../../shared/dates";
import { toCsv } from "../lib/csv";
import { csvResponse } from "./employees";

export const payrollRoutes = new Hono<AppEnv>();
const admin = requireRole("admin");

payrollRoutes.get("/payroll/runs", admin, async (c) => {
  return c.json(
    await all(
      c.env.DB,
      `SELECT r.*, COUNT(p.id) AS slip_count, COALESCE(SUM(p.gross_pay), 0) AS gross_total, COALESCE(SUM(p.net_pay), 0) AS net_total
         FROM payroll_runs r LEFT JOIN payslips p ON p.run_id = r.id GROUP BY r.id ORDER BY r.pay_month DESC`,
    ),
  );
});

payrollRoutes.post("/payroll/runs", admin, async (c) => {
  const { payMonth } = await c.req.json<{ payMonth: string }>();
  const company = (await loadCompany(c.env.DB))!;
  const id = await createRun(c.env.DB, payMonth, company);
  await calculateRun(c.env.DB, id, company, todayLocal(tzOffset(c.env)));
  await audit(c.env.DB, c.get("user"), "payroll.create", "payroll_run", id, { payMonth });
  return c.json({ id });
});

payrollRoutes.get("/payroll/runs/:id", admin, async (c) => {
  const id = Number(c.req.param("id"));
  const runRow = await first<any>(c.env.DB, "SELECT * FROM payroll_runs WHERE id = ?", id);
  if (!runRow) throw notFound();
  const slips = await all<any>(
    c.env.DB,
    `SELECT p.*, e.code, e.last_name, e.first_name, e.employment_type, d.name AS department_name
       FROM payslips p JOIN employees e ON e.id = p.employee_id LEFT JOIN departments d ON d.id = e.department_id
      WHERE p.run_id = ? ORDER BY e.code`,
    id,
  );
  const adjustments = await all<any>(
    c.env.DB,
    "SELECT a.*, e.last_name || ' ' || e.first_name AS employee_name FROM payslip_adjustments a JOIN employees e ON e.id = a.employee_id WHERE a.run_id = ? ORDER BY a.id",
    id,
  );
  const missing = await all<any>(
    c.env.DB,
    `SELECT e.id, e.code, e.last_name, e.first_name FROM employees e LEFT JOIN salary_settings s ON s.employee_id = e.id
      WHERE s.employee_id IS NULL AND e.hire_date <= ? AND (e.leave_date IS NULL OR e.leave_date >= ?)`,
    runRow.period_end,
    runRow.period_start,
  );
  return c.json({
    run: runRow,
    slips: slips.map((s) => ({ ...s, payload: parseJson(s.payload, {}) })),
    adjustments,
    missingSettings: missing,
  });
});

payrollRoutes.post("/payroll/runs/:id/calculate", admin, async (c) => {
  const company = (await loadCompany(c.env.DB))!;
  const n = await calculateRun(c.env.DB, Number(c.req.param("id")), company, todayLocal(tzOffset(c.env)));
  return c.json({ ok: true, count: n });
});

payrollRoutes.post("/payroll/runs/:id/confirm", admin, async (c) => {
  await confirmRun(c.env.DB, Number(c.req.param("id")), nowLocal(tzOffset(c.env)));
  await audit(c.env.DB, c.get("user"), "payroll.confirm", "payroll_run", c.req.param("id"));
  return c.json({ ok: true });
});

payrollRoutes.post("/payroll/runs/:id/reopen", admin, async (c) => {
  await reopenRun(c.env.DB, Number(c.req.param("id")));
  await audit(c.env.DB, c.get("user"), "payroll.reopen", "payroll_run", c.req.param("id"));
  return c.json({ ok: true });
});

payrollRoutes.post("/payroll/runs/:id/publish", admin, async (c) => {
  await publishRun(c.env.DB, Number(c.req.param("id")), nowLocal(tzOffset(c.env)));
  await audit(c.env.DB, c.get("user"), "payroll.publish", "payroll_run", c.req.param("id"));
  return c.json({ ok: true });
});

payrollRoutes.delete("/payroll/runs/:id", admin, async (c) => {
  const r = await first<any>(c.env.DB, "SELECT status FROM payroll_runs WHERE id = ?", Number(c.req.param("id")));
  if (!r) throw notFound();
  if (r.status !== "draft") throw conflict("下書きの給与計算だけ削除できます");
  await run(c.env.DB, "DELETE FROM payroll_runs WHERE id = ?", Number(c.req.param("id")));
  return c.json({ ok: true });
});

payrollRoutes.post("/payroll/runs/:id/adjustments", admin, async (c) => {
  const runId = Number(c.req.param("id"));
  const r = await first<any>(c.env.DB, "SELECT status FROM payroll_runs WHERE id = ?", runId);
  if (r?.status !== "draft") throw conflict("下書きの給与計算にだけ追加できます");
  const b = await c.req.json<any>();
  const amount = Number(b.amount);
  if (!b.employee_id || !b.name?.trim() || !Number.isInteger(amount) || amount <= 0) throw badRequest("従業員・項目名・金額を入力してください");
  await insert(
    c.env.DB,
    "INSERT INTO payslip_adjustments (run_id, employee_id, kind, name, amount, taxable) VALUES (?, ?, ?, ?, ?, ?)",
    runId,
    Number(b.employee_id),
    b.kind === "deduction" ? "deduction" : "payment",
    b.name.trim(),
    amount,
    b.taxable === false ? 0 : 1,
  );
  return c.json({ ok: true });
});

payrollRoutes.delete("/payroll/adjustments/:id", admin, async (c) => {
  const a = await first<any>(c.env.DB, "SELECT a.id, r.status FROM payslip_adjustments a JOIN payroll_runs r ON r.id = a.run_id WHERE a.id = ?", Number(c.req.param("id")));
  if (!a) throw notFound();
  if (a.status !== "draft") throw conflict("確定済みの給与計算は変更できません");
  await run(c.env.DB, "DELETE FROM payslip_adjustments WHERE id = ?", a.id);
  return c.json({ ok: true });
});

payrollRoutes.get("/payroll/runs/:id/export.csv", admin, async (c) => {
  const id = Number(c.req.param("id"));
  const runRow = await first<any>(c.env.DB, "SELECT * FROM payroll_runs WHERE id = ?", id);
  if (!runRow) throw notFound();
  const slips = await all<any>(
    c.env.DB,
    "SELECT p.*, e.code, e.last_name, e.first_name FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE p.run_id = ? ORDER BY e.code",
    id,
  );
  const parsed = slips.map((s) => ({ ...s, data: parseJson<any>(s.payload, {}) }));
  const payNames = [...new Set(parsed.flatMap((s) => s.data.payments.map((p: any) => p.name)))] as string[];
  const dedNames = [...new Set(parsed.flatMap((s) => s.data.deductions.map((d: any) => d.name)))] as string[];
  const sumBy = (lines: any[], name: string) => lines.filter((l) => l.name === name).reduce((t, l) => t + l.amount, 0);
  return csvResponse(
    toCsv(
      ["社員番号", "氏名", ...payNames, "総支給額", ...dedNames, "控除合計", "差引支給額", "課税対象額", "標準報酬月額"],
      parsed.map((s) => [
        s.code, `${s.last_name} ${s.first_name}`,
        ...payNames.map((n) => sumBy(s.data.payments, n)), s.gross_pay,
        ...dedNames.map((n) => sumBy(s.data.deductions, n)), s.total_deductions, s.net_pay,
        s.data.totals.taxable, s.data.meta.standard,
      ]),
    ),
    `payroll-${runRow.pay_month}.csv`,
  );
});

payrollRoutes.get("/payroll/runs/:id/bank.csv", admin, async (c) => {
  const id = Number(c.req.param("id"));
  const runRow = await first<any>(c.env.DB, "SELECT * FROM payroll_runs WHERE id = ?", id);
  if (!runRow) throw notFound();
  const rows = await all<any>(
    c.env.DB,
    `SELECT e.code, e.last_name, e.first_name, e.bank_name, e.bank_branch, e.bank_account_type, e.bank_account_number, e.bank_account_holder, p.net_pay
       FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE p.run_id = ? AND p.net_pay > 0 ORDER BY e.code`,
    id,
  );
  return csvResponse(
    toCsv(
      ["振込日", "社員番号", "氏名", "銀行名", "支店名", "預金種目", "口座番号", "口座名義", "振込金額"],
      rows.map((r) => [runRow.pay_date, r.code, `${r.last_name} ${r.first_name}`, r.bank_name, r.bank_branch, r.bank_account_type, r.bank_account_number, r.bank_account_holder, r.net_pay]),
    ),
    `bank-transfer-${runRow.pay_month}.csv`,
  );
});

// ── 給与設定
payrollRoutes.get("/payroll/settings", admin, async (c) => {
  const rows = await all<any>(
    c.env.DB,
    `SELECT s.*, s.employee_id AS has_setting, e.id AS eid, e.code, e.last_name, e.first_name, e.employment_type, e.status
       FROM employees e LEFT JOIN salary_settings s ON s.employee_id = e.id WHERE e.status != 'retired' ORDER BY e.code`,
  );
  return c.json(rows.map((r) => ({ ...r, employee_id: r.eid, has_setting: !!r.has_setting, allowances: parseJson(r.allowances, []), other_deductions: parseJson(r.other_deductions, []) })));
});

payrollRoutes.get("/payroll/settings/:employeeId", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("employeeId"));
  if (user.role !== "admin" && user.employeeId !== id) throw forbidden();
  const row = await first<any>(c.env.DB, "SELECT * FROM salary_settings WHERE employee_id = ?", id);
  const deps = await first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM dependents WHERE employee_id = ? AND withholding_target = 1", id);
  return c.json({
    setting: row ? { ...row, allowances: parseJson(row.allowances, []), other_deductions: parseJson(row.other_deductions, []) } : null,
    dependentsCount: deps?.n ?? 0,
  });
});

payrollRoutes.put("/payroll/settings/:employeeId", admin, async (c) => {
  const id = Number(c.req.param("employeeId"));
  const b = await c.req.json<any>();
  const int = (v: any) => {
    const n = Math.round(Number(v ?? 0));
    if (Number.isNaN(n) || n < 0) throw badRequest("金額は0以上の数値で入力してください");
    return n;
  };
  const allowances = (b.allowances ?? [])
    .filter((a: any) => a.name?.trim())
    .map((a: any) => ({ name: a.name.trim(), amount: int(a.amount), taxable: a.taxable !== false, overtime_base: a.overtime_base !== false }));
  const deductions = (b.other_deductions ?? []).filter((d: any) => d.name?.trim()).map((d: any) => ({ name: d.name.trim(), amount: int(d.amount) }));
  const payType = ["monthly", "hourly", "daily"].includes(b.pay_type) ? b.pay_type : "monthly";
  await run(
    c.env.DB,
    `INSERT INTO salary_settings (employee_id, pay_type, base_salary, hourly_wage, daily_wage, allowances, commute_allowance, other_deductions,
       standard_monthly_remuneration, health_insurance, pension_insurance, employment_insurance, care_insurance, tax_column,
       tax_dependents_adjust, resident_tax_june, resident_tax_monthly, absence_deduction, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (employee_id) DO UPDATE SET pay_type = excluded.pay_type, base_salary = excluded.base_salary, hourly_wage = excluded.hourly_wage,
       daily_wage = excluded.daily_wage, allowances = excluded.allowances, commute_allowance = excluded.commute_allowance,
       other_deductions = excluded.other_deductions, standard_monthly_remuneration = excluded.standard_monthly_remuneration,
       health_insurance = excluded.health_insurance, pension_insurance = excluded.pension_insurance, employment_insurance = excluded.employment_insurance,
       care_insurance = excluded.care_insurance, tax_column = excluded.tax_column, tax_dependents_adjust = excluded.tax_dependents_adjust,
       resident_tax_june = excluded.resident_tax_june, resident_tax_monthly = excluded.resident_tax_monthly,
       absence_deduction = excluded.absence_deduction, updated_at = datetime('now')`,
    id,
    payType,
    int(b.base_salary),
    int(b.hourly_wage),
    int(b.daily_wage),
    JSON.stringify(allowances),
    int(b.commute_allowance),
    JSON.stringify(deductions),
    int(b.standard_monthly_remuneration),
    b.health_insurance === false ? 0 : 1,
    b.pension_insurance === false ? 0 : 1,
    b.employment_insurance === false ? 0 : 1,
    ["auto", "yes", "no"].includes(b.care_insurance) ? b.care_insurance : "auto",
    ["kou", "otsu", "none"].includes(b.tax_column) ? b.tax_column : "kou",
    Math.round(Number(b.tax_dependents_adjust ?? 0)) || 0,
    int(b.resident_tax_june),
    int(b.resident_tax_monthly),
    b.absence_deduction === false ? 0 : 1,
  );
  await audit(c.env.DB, c.get("user"), "salary.update", "employee", id);
  return c.json({ ok: true });
});

// ── 給与明細 (従業員)
payrollRoutes.get("/payslips", async (c) => {
  const user = c.get("user");
  const employeeId = Number(c.req.query("employeeId") ?? user.employeeId);
  if (user.role !== "admin" && employeeId !== user.employeeId) throw forbidden();
  return c.json(
    await all(
      c.env.DB,
      `SELECT p.id, p.gross_pay, p.total_deductions, p.net_pay, r.pay_month, r.pay_date, r.status
         FROM payslips p JOIN payroll_runs r ON r.id = p.run_id
        WHERE p.employee_id = ? ${user.role === "admin" ? "" : "AND r.status = 'published'"} ORDER BY r.pay_month DESC`,
      employeeId,
    ),
  );
});

payrollRoutes.get("/payslips/:id", async (c) => {
  const user = c.get("user");
  const slip = await first<any>(
    c.env.DB,
    `SELECT p.*, r.pay_month, r.pay_date, r.status AS run_status, r.period_start, r.period_end, r.insurance_month,
            e.code, e.last_name, e.first_name, d.name AS department_name
       FROM payslips p JOIN payroll_runs r ON r.id = p.run_id JOIN employees e ON e.id = p.employee_id
       LEFT JOIN departments d ON d.id = e.department_id WHERE p.id = ?`,
    Number(c.req.param("id")),
  );
  if (!slip) throw notFound();
  if (user.role !== "admin" && (slip.employee_id !== user.employeeId || slip.run_status !== "published")) throw forbidden();
  const company = await loadCompany(c.env.DB);
  return c.json({ ...slip, payload: parseJson(slip.payload, {}), company_name: company?.name });
});
