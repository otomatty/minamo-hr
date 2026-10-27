import { all, first, parseJson, placeholders, run } from "../lib/db";
import { badRequest, conflict, notFound } from "../lib/context";
import { addDays, addMonths, attendancePeriod, daysInMonth, weekday } from "../../shared/dates";
import { calcPayslip, type SalarySetting } from "../../shared/calc/payroll";
import { insuranceMonthFor, pickRates } from "../../shared/calc/insurance";
import { computePeriods } from "./attendance";
import { notify, type Company } from "./common";

export function payDateFor(payMonth: string, payDay: number, holidays: Set<string>): string {
  const [y, m] = payMonth.split("-").map(Number);
  const day = !payDay ? daysInMonth(y, m) : Math.min(payDay, daysInMonth(y, m));
  let d = `${payMonth}-${String(day).padStart(2, "0")}`;
  // 土日祝の場合は前営業日に繰り上げ
  for (let i = 0; i < 10 && (weekday(d) === 0 || weekday(d) === 6 || holidays.has(d)); i++) d = addDays(d, -1);
  return d;
}

export async function createRun(db: D1Database, payMonth: string, company: Company) {
  if (!/^\d{4}-\d{2}$/.test(payMonth)) throw badRequest("支給年月を指定してください");
  if (await first(db, "SELECT id FROM payroll_runs WHERE pay_month = ?", payMonth)) throw conflict("この支給月の給与計算はすでに作成されています");
  const attendanceMonth = addMonths(payMonth, -company.pay_month_offset);
  const period = attendancePeriod(attendanceMonth, company.closing_day);
  const holidays = new Set(
    (await all<{ date: string }>(db, "SELECT date FROM holidays WHERE date LIKE ?", `${payMonth}%`)).map((h) => h.date),
  );
  const payDate = payDateFor(payMonth, company.pay_day, holidays);
  const insuranceMonth = insuranceMonthFor(payMonth, company.social_insurance_timing);
  const res = await run(
    db,
    `INSERT INTO payroll_runs (pay_month, pay_date, attendance_month, period_start, period_end, insurance_month)
     VALUES (?, ?, ?, ?, ?, ?)`,
    payMonth,
    payDate,
    attendanceMonth,
    period.start,
    period.end,
    insuranceMonth,
  );
  return Number(res.meta.last_row_id);
}

export function settingFromRow(r: any): SalarySetting {
  return {
    pay_type: r.pay_type,
    base_salary: r.base_salary,
    hourly_wage: r.hourly_wage,
    daily_wage: r.daily_wage,
    allowances: parseJson(r.allowances, []),
    commute_allowance: r.commute_allowance,
    other_deductions: parseJson(r.other_deductions, []),
    standard_monthly_remuneration: r.standard_monthly_remuneration,
    health_insurance: !!r.health_insurance,
    pension_insurance: !!r.pension_insurance,
    employment_insurance: !!r.employment_insurance,
    care_insurance: r.care_insurance,
    tax_column: r.tax_column,
    tax_dependents_adjust: r.tax_dependents_adjust,
    resident_tax_june: r.resident_tax_june,
    resident_tax_monthly: r.resident_tax_monthly,
    absence_deduction: !!r.absence_deduction,
  };
}

/** 給与を計算して明細を作成 (下書き状態の間は何度でも再計算できる) */
export async function calculateRun(db: D1Database, runId: number, company: Company, today: string): Promise<number> {
  const runRow = await first<any>(db, "SELECT * FROM payroll_runs WHERE id = ?", runId);
  if (!runRow) throw notFound();
  if (runRow.status !== "draft") throw conflict("確定済みの給与は再計算できません。確定を解除してください");

  const employees = await all<any>(
    db,
    `SELECT e.*, s.employee_id AS has_setting, s.pay_type, s.base_salary, s.hourly_wage, s.daily_wage, s.allowances, s.commute_allowance,
            s.other_deductions, s.standard_monthly_remuneration, s.health_insurance, s.pension_insurance, s.employment_insurance,
            s.care_insurance, s.tax_column, s.tax_dependents_adjust, s.resident_tax_june, s.resident_tax_monthly, s.absence_deduction
       FROM employees e JOIN salary_settings s ON s.employee_id = e.id
      WHERE e.hire_date <= ? AND (e.leave_date IS NULL OR e.leave_date >= ?)`,
    runRow.period_end,
    runRow.period_start,
  );
  if (!employees.length) {
    await run(db, "DELETE FROM payslips WHERE run_id = ?", runId);
    await run(db, "UPDATE payroll_runs SET calculated_at = datetime('now') WHERE id = ?", runId);
    return 0;
  }
  const ids = employees.map((e) => e.id);
  const periods = await computePeriods(db, employees, runRow.period_start, runRow.period_end, today, company);
  const rateRows = await all<any>(db, "SELECT kind, effective_from, rate FROM insurance_rates");
  const rates = pickRates(rateRows, runRow.insurance_month, runRow.period_end.slice(0, 7));
  const deps = await all<{ employee_id: number; n: number }>(
    db,
    `SELECT employee_id, COUNT(*) AS n FROM dependents WHERE withholding_target = 1 AND employee_id IN (${placeholders(ids.length)}) GROUP BY employee_id`,
    ...ids,
  );
  const depMap = new Map(deps.map((d) => [d.employee_id, d.n]));
  const adjustments = await all<any>(db, "SELECT * FROM payslip_adjustments WHERE run_id = ?", runId);
  const expenses = await all<any>(
    db,
    `SELECT id, applicant_id, amount FROM requests
      WHERE kind = 'expense' AND status = 'approved' AND paid_at IS NULL AND json_extract(payload, '$.settlement') = 'payroll'
        AND (payroll_run_id IS NULL OR payroll_run_id = ?)`,
    runId,
  );

  const stmts: D1PreparedStatement[] = [db.prepare("DELETE FROM payslips WHERE run_id = ?").bind(runId)];
  for (const e of employees) {
    const p = periods.get(e.id)!;
    const setting = settingFromRow(e);
    const myExpenses = expenses.filter((x) => x.applicant_id === e.id);
    const prorate =
      setting.pay_type === "monthly" && p.summary.scheduledDays < p.fullScheduledDays && (e.hire_date > runRow.period_start || (e.leave_date && e.leave_date < runRow.period_end))
        ? { numerator: p.summary.scheduledDays, denominator: p.fullScheduledDays }
        : null;
    const data = calcPayslip({
      employee: { birth_date: e.birth_date, hire_date: e.hire_date, leave_date: e.leave_date, employment_type: e.employment_type },
      setting,
      attendance: p.summary,
      workdayWorkDays: p.workdayWorkDays,
      scheduledMinutesPerDay: p.pattern.scheduledMinutes,
      monthlyAvgHours: company.monthly_avg_hours,
      payMonth: runRow.pay_month,
      payDate: runRow.pay_date,
      insuranceMonth: runRow.insurance_month,
      rates,
      dependentsCount: depMap.get(e.id) ?? 0,
      prorate,
      adjustments: adjustments
        .filter((a) => a.employee_id === e.id)
        .map((a) => ({ kind: a.kind, name: a.name, amount: a.amount, taxable: !!a.taxable })),
      expenseReimbursement: myExpenses.reduce((t, x) => t + x.amount, 0),
    });
    const payload = {
      ...data,
      attendance: p.summary,
      employee: {
        code: e.code,
        name: `${e.last_name} ${e.first_name}`,
        department_id: e.department_id,
        pay_type: setting.pay_type,
      },
      expenseRequestIds: myExpenses.map((x) => x.id),
    };
    stmts.push(
      db
        .prepare("INSERT INTO payslips (run_id, employee_id, payload, gross_pay, total_deductions, net_pay) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(runId, e.id, JSON.stringify(payload), data.totals.gross, data.totals.deductions, data.totals.net),
    );
  }
  stmts.push(db.prepare("UPDATE payroll_runs SET calculated_at = datetime('now') WHERE id = ?").bind(runId));
  await db.batch(stmts);
  return employees.length;
}

export async function confirmRun(db: D1Database, runId: number, now: string) {
  const r = await first<any>(db, "SELECT * FROM payroll_runs WHERE id = ?", runId);
  if (!r) throw notFound();
  if (r.status !== "draft") throw conflict("下書きの給与計算だけ確定できます");
  if (!r.calculated_at) throw conflict("先に計算を実行してください");
  const slips = await all<any>(db, "SELECT payload FROM payslips WHERE run_id = ?", runId);
  const expenseIds = slips.flatMap((s) => parseJson<any>(s.payload, {}).expenseRequestIds ?? []);
  const stmts = [db.prepare("UPDATE payroll_runs SET status = 'confirmed', confirmed_at = ? WHERE id = ?").bind(now, runId)];
  for (const id of expenseIds) {
    stmts.push(db.prepare("UPDATE requests SET paid_at = ?, paid_via = 'payroll', payroll_run_id = ? WHERE id = ?").bind(r.pay_date, runId, id));
  }
  await db.batch(stmts);
}

export async function reopenRun(db: D1Database, runId: number) {
  const r = await first<any>(db, "SELECT * FROM payroll_runs WHERE id = ?", runId);
  if (!r) throw notFound();
  if (r.status !== "confirmed") throw conflict("確定済み (未公開) の給与計算だけ解除できます");
  await db.batch([
    db.prepare("UPDATE payroll_runs SET status = 'draft', confirmed_at = NULL WHERE id = ?").bind(runId),
    db.prepare("UPDATE requests SET paid_at = NULL, paid_via = NULL, payroll_run_id = NULL WHERE payroll_run_id = ? AND paid_via = 'payroll'").bind(runId),
  ]);
}

export async function publishRun(db: D1Database, runId: number, now: string) {
  const r = await first<any>(db, "SELECT * FROM payroll_runs WHERE id = ?", runId);
  if (!r) throw notFound();
  if (r.status !== "confirmed") throw conflict("確定済みの給与計算だけ公開できます");
  await run(db, "UPDATE payroll_runs SET status = 'published', published_at = ? WHERE id = ?", now, runId);
  const slips = await all<{ id: number; employee_id: number }>(db, "SELECT id, employee_id FROM payslips WHERE run_id = ?", runId);
  const [y, m] = r.pay_month.split("-");
  for (const s of slips) {
    await notify(db, [s.employee_id], `${y}年${Number(m)}月分の給与明細が公開されました`, `支給日: ${r.pay_date}`, `/payslips/${s.id}`);
  }
}
