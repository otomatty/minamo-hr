// 給与計算 (1人・1か月分)
import type { PeriodSummary } from "./attendance";
import {
  calcSocialInsurance,
  careInsuranceApplies,
  employmentShare,
  healthGradeOf,
  insuredInMonth,
  rateToMilli,
  type Rates,
} from "./insurance";
import { kouTableYear, withholdingKou, withholdingOtsu } from "./tax";

export interface Allowance {
  name: string;
  amount: number;
  taxable: boolean;
  overtime_base: boolean; // 割増賃金の算定基礎に含めるか
}

export interface SalarySetting {
  pay_type: "monthly" | "hourly" | "daily";
  base_salary: number;
  hourly_wage: number;
  daily_wage: number;
  allowances: Allowance[];
  commute_allowance: number;
  other_deductions: Array<{ name: string; amount: number }>;
  standard_monthly_remuneration: number;
  health_insurance: boolean;
  pension_insurance: boolean;
  employment_insurance: boolean;
  care_insurance: "auto" | "yes" | "no";
  tax_column: "kou" | "otsu" | "none";
  tax_dependents_adjust: number;
  resident_tax_june: number;
  resident_tax_monthly: number;
  absence_deduction: boolean;
}

export interface PayLine {
  code: string;
  name: string;
  amount: number;
  taxable?: boolean;
  note?: string;
}

export interface PayrollInput {
  employee: {
    birth_date: string | null;
    hire_date: string;
    leave_date: string | null;
    employment_type: string;
  };
  setting: SalarySetting;
  attendance: PeriodSummary;
  workdayWorkDays: number; // 所定労働日に出勤した日数 (日給制の計算用)
  scheduledMinutesPerDay: number;
  monthlyAvgHours: number;
  payMonth: string; // 'YYYY-MM'
  payDate: string;
  insuranceMonth: string;
  rates: Rates;
  dependentsCount: number; // 源泉控除対象配偶者・親族の人数
  prorate: { numerator: number; denominator: number } | null; // 月給の日割り (所定労働日ベース)
  adjustments: Array<{ kind: "payment" | "deduction"; name: string; amount: number; taxable: boolean }>;
  expenseReimbursement: number; // 給与と合わせて精算する立替経費 (非課税)
}

export interface PayslipData {
  payments: PayLine[];
  deductions: PayLine[];
  totals: {
    gross: number;
    taxable: number;
    nonTaxable: number;
    socialInsurance: number;
    taxBase: number;
    deductions: number;
    net: number;
    employmentInsuranceWage: number;
  };
  employer: {
    health: number;
    childSupport: number;
    pension: number;
    employment: number;
    total: number;
  };
  meta: {
    hourlyBase: number;
    standard: number;
    healthGrade: number | null;
    careApplies: boolean;
    insured: boolean;
    taxColumn: string;
    taxTableYear: number;
    dependents: number;
    rates: Rates;
  };
  warnings: string[];
}

const COMMUTE_NONTAXABLE_LIMIT = 150000;

const yen = (x: number) => Math.round(x + 1e-9); // 50銭以上切上げ
const floorYen = (x: number) => Math.floor(x + 1e-9);

export function calcPayslip(input: PayrollInput): PayslipData {
  const s = input.setting;
  const a = input.attendance;
  const warnings: string[] = [];
  const payments: PayLine[] = [];
  const deductions: PayLine[] = [];

  const otBaseAllowances = s.allowances.filter((x) => x.overtime_base).reduce((t, x) => t + x.amount, 0);
  let hourlyBase = 0;
  if (s.pay_type === "monthly") {
    hourlyBase = input.monthlyAvgHours > 0 ? (s.base_salary + otBaseAllowances) / input.monthlyAvgHours : 0;
  } else if (s.pay_type === "hourly") {
    hourlyBase = s.hourly_wage;
  } else {
    const hoursPerDay = input.scheduledMinutesPerDay / 60;
    hourlyBase = hoursPerDay > 0 ? s.daily_wage / hoursPerDay : 0;
  }

  const ratio = input.prorate && input.prorate.denominator > 0
    ? Math.min(1, input.prorate.numerator / input.prorate.denominator)
    : 1;

  // ── 基本給
  if (s.pay_type === "monthly") {
    const amt = ratio < 1 ? floorYen(s.base_salary * ratio) : s.base_salary;
    payments.push({ code: "base", name: "基本給", amount: amt, taxable: true, note: ratio < 1 ? `日割 ${input.prorate!.numerator}/${input.prorate!.denominator}日` : undefined });
  } else if (s.pay_type === "hourly") {
    payments.push({
      code: "base",
      name: "基本給 (時給)",
      amount: yen((s.hourly_wage * a.totalWorkMinutes) / 60),
      taxable: true,
      note: `${s.hourly_wage.toLocaleString()}円 × ${(a.totalWorkMinutes / 60).toFixed(2)}h`,
    });
  } else {
    payments.push({
      code: "base",
      name: "基本給 (日給)",
      amount: s.daily_wage * input.workdayWorkDays,
      taxable: true,
      note: `${s.daily_wage.toLocaleString()}円 × ${input.workdayWorkDays}日`,
    });
  }

  // ── 手当
  for (const al of s.allowances) {
    if (!al.amount) continue;
    const amt = s.pay_type === "monthly" && ratio < 1 ? floorYen(al.amount * ratio) : al.amount;
    payments.push({ code: "allowance", name: al.name, amount: amt, taxable: al.taxable });
  }

  // ── 割増賃金
  const h = hourlyBase;
  if (s.pay_type === "hourly") {
    const ot = yen((h * a.legalOvertime * 0.25) / 60);
    if (ot) payments.push({ code: "overtime", name: "時間外労働割増", amount: ot, taxable: true, note: hm(a.legalOvertime) });
  } else {
    const within = a.withinLegalOvertime + a.nonScheduledMinutes;
    const withinPay = yen((h * within) / 60);
    if (withinPay) payments.push({ code: "overtime_within", name: "法定内残業手当", amount: withinPay, taxable: true, note: hm(within) });
    const legal = a.legalOvertime - a.legalOvertimeFromRegular;
    const otPay = yen((h * (legal * 1.25 + a.legalOvertimeFromRegular * 0.25)) / 60);
    if (otPay) payments.push({ code: "overtime", name: "時間外労働手当", amount: otPay, taxable: true, note: hm(a.legalOvertime) });
  }
  const over60 = yen((h * a.over60Minutes * 0.25) / 60);
  if (over60) payments.push({ code: "overtime60", name: "月60時間超割増", amount: over60, taxable: true, note: hm(a.over60Minutes) });
  const holidayRate = s.pay_type === "hourly" ? 0.35 : 1.35;
  const holidayPay = yen((h * a.legalHolidayMinutes * holidayRate) / 60);
  if (holidayPay) payments.push({ code: "holiday", name: "休日労働手当", amount: holidayPay, taxable: true, note: hm(a.legalHolidayMinutes) });
  const nightPay = yen((h * a.lateNightMinutes * 0.25) / 60);
  if (nightPay) payments.push({ code: "night", name: "深夜労働手当", amount: nightPay, taxable: true, note: hm(a.lateNightMinutes) });

  // ── 欠勤・遅刻早退控除 (月給制)
  if (s.pay_type === "monthly" && s.absence_deduction) {
    const absent = a.absenceDays + a.unpaidLeaveDays;
    if (absent > 0 && a.scheduledDays > 0) {
      const amt = floorYen(((s.base_salary + otBaseAllowances) / a.scheduledDays) * absent);
      payments.push({ code: "absence", name: "欠勤控除", amount: -amt, taxable: true, note: `${absent}日` });
    }
    const lateEarly = a.lateMinutes + a.earlyLeaveMinutes;
    if (lateEarly > 0) {
      const amt = floorYen((h * lateEarly) / 60);
      payments.push({ code: "late", name: "遅刻早退控除", amount: -amt, taxable: true, note: hm(lateEarly) });
    }
  }

  // ── 通勤手当 (月15万円まで非課税)
  if (s.commute_allowance > 0) {
    const nonTax = Math.min(s.commute_allowance, COMMUTE_NONTAXABLE_LIMIT);
    payments.push({ code: "commute", name: "通勤手当", amount: nonTax, taxable: false });
    if (s.commute_allowance > nonTax) {
      payments.push({ code: "commute_taxable", name: "通勤手当 (課税分)", amount: s.commute_allowance - nonTax, taxable: true });
    }
  }

  for (const adj of input.adjustments.filter((x) => x.kind === "payment")) {
    payments.push({ code: "adjustment", name: adj.name, amount: adj.amount, taxable: adj.taxable });
  }

  const wagePayments = payments.reduce((t, p) => t + p.amount, 0);
  if (input.expenseReimbursement > 0) {
    payments.push({ code: "expense", name: "立替経費精算", amount: input.expenseReimbursement, taxable: false });
  }

  const gross = payments.reduce((t, p) => t + p.amount, 0);
  const taxable = payments.filter((p) => p.taxable).reduce((t, p) => t + p.amount, 0);

  // ── 社会保険
  const insured = insuredInMonth(input.employee.hire_date, input.employee.leave_date, input.insuranceMonth);
  const careApplies = s.care_insurance === "yes" ? true : s.care_insurance === "no" ? false : careInsuranceApplies(input.employee.birth_date, input.insuranceMonth);
  const standard = s.standard_monthly_remuneration;
  if ((s.health_insurance || s.pension_insurance) && !standard) warnings.push("標準報酬月額が未設定のため社会保険料を計算していません");
  if (standard && healthGradeOf(standard) === null) warnings.push(`標準報酬月額 ${standard.toLocaleString()}円 は等級表にない金額です`);
  const si = calcSocialInsurance({
    standard,
    rates: input.rates,
    careApplies,
    health: insured && s.health_insurance,
    pension: insured && s.pension_insurance,
  });
  if (si.health) deductions.push({ code: "health", name: "健康保険料", amount: si.health });
  if (si.care) deductions.push({ code: "care", name: "介護保険料", amount: si.care });
  if (si.childSupport) deductions.push({ code: "child_support", name: "子ども・子育て支援金", amount: si.childSupport });
  if (si.pension) deductions.push({ code: "pension", name: "厚生年金保険料", amount: si.pension });

  // ── 雇用保険 (役員は対象外)
  const employmentWage = Math.max(0, wagePayments);
  let employment = 0;
  let employmentEmployer = 0;
  if (s.employment_insurance && input.employee.employment_type !== "executive") {
    employment = employmentShare(employmentWage, input.rates.employment_employee);
    employmentEmployer = Math.floor((employmentWage * rateToMilli(input.rates.employment_employer)) / 100000);
    if (employment) deductions.push({ code: "employment", name: "雇用保険料", amount: employment });
  }

  const socialTotal = si.health + si.care + si.childSupport + si.pension + employment;

  // ── 源泉所得税
  const payYear = Number(input.payDate.slice(0, 4));
  const taxBase = Math.max(0, taxable - socialTotal);
  const dependents = Math.max(0, input.dependentsCount + s.tax_dependents_adjust);
  let incomeTax = 0;
  if (s.tax_column === "kou") incomeTax = withholdingKou(taxBase, dependents, payYear);
  else if (s.tax_column === "otsu") {
    incomeTax = withholdingOtsu(taxBase);
    if (payYear >= 2027) warnings.push("乙欄は令和8年分の算式で計算しています。令和9年分の税額表で確認してください");
  }
  if (incomeTax) deductions.push({ code: "income_tax", name: "所得税", amount: incomeTax });

  // ── 住民税 (特別徴収: 6月は初回月の金額)
  const residentTax = input.payMonth.endsWith("-06") ? s.resident_tax_june : s.resident_tax_monthly;
  if (residentTax) deductions.push({ code: "resident_tax", name: "住民税", amount: residentTax });

  for (const d of s.other_deductions) {
    if (d.amount) deductions.push({ code: "other", name: d.name, amount: d.amount });
  }
  for (const adj of input.adjustments.filter((x) => x.kind === "deduction")) {
    deductions.push({ code: "adjustment", name: adj.name, amount: adj.amount });
  }

  const totalDeductions = deductions.reduce((t, d) => t + d.amount, 0);
  if (a.incompleteDays > 0) warnings.push(`退勤打刻のない日が ${a.incompleteDays} 日あります`);

  return {
    payments,
    deductions,
    totals: {
      gross,
      taxable,
      nonTaxable: gross - taxable,
      socialInsurance: socialTotal,
      taxBase,
      deductions: totalDeductions,
      net: gross - totalDeductions,
      employmentInsuranceWage: employmentWage,
    },
    employer: {
      health: si.employerHealth,
      childSupport: si.employerChildSupport,
      pension: si.employerPension,
      employment: employmentEmployer,
      total: si.employerHealth + si.employerChildSupport + si.employerPension + employmentEmployer,
    },
    meta: {
      hourlyBase: Math.round(hourlyBase * 100) / 100,
      standard,
      healthGrade: standard ? healthGradeOf(standard) : null,
      careApplies,
      insured,
      taxColumn: s.tax_column,
      taxTableYear: kouTableYear(payYear),
      dependents,
      rates: input.rates,
    },
    warnings,
  };
}

function hm(min: number): string {
  return `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, "0")}`;
}
