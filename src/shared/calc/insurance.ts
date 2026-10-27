// 社会保険料・雇用保険料の計算
// 出典: 協会けんぽ 令和8年度保険料額表 (令和8年3月分から)、厚生労働省 令和8年度雇用保険料率
import { addDays, addMonths, monthOf } from "../dates";

/** 健康保険の標準報酬月額 [等級, 標準報酬月額, 報酬月額の下限(以上)] */
export const HEALTH_GRADES: Array<[number, number, number]> = [
  [1, 58000, 0], [2, 68000, 63000], [3, 78000, 73000], [4, 88000, 83000], [5, 98000, 93000],
  [6, 104000, 101000], [7, 110000, 107000], [8, 118000, 114000], [9, 126000, 122000], [10, 134000, 130000],
  [11, 142000, 138000], [12, 150000, 146000], [13, 160000, 155000], [14, 170000, 165000], [15, 180000, 175000],
  [16, 190000, 185000], [17, 200000, 195000], [18, 220000, 210000], [19, 240000, 230000], [20, 260000, 250000],
  [21, 280000, 270000], [22, 300000, 290000], [23, 320000, 310000], [24, 340000, 330000], [25, 360000, 350000],
  [26, 380000, 370000], [27, 410000, 395000], [28, 440000, 425000], [29, 470000, 455000], [30, 500000, 485000],
  [31, 530000, 515000], [32, 560000, 545000], [33, 590000, 575000], [34, 620000, 605000], [35, 650000, 635000],
  [36, 680000, 665000], [37, 710000, 695000], [38, 750000, 730000], [39, 790000, 770000], [40, 830000, 810000],
  [41, 880000, 855000], [42, 930000, 905000], [43, 980000, 955000], [44, 1030000, 1005000], [45, 1090000, 1055000],
  [46, 1150000, 1115000], [47, 1210000, 1175000], [48, 1270000, 1235000], [49, 1330000, 1295000], [50, 1390000, 1355000],
];

export const PENSION_MIN = 88000;
export const PENSION_MAX = 650000;
// 令和7年の年金制度改正法 (2025-06-20 公布) による厚生年金の標準報酬月額の上限の引き上げ
const PENSION_CAP_SCHEDULE: Array<[string, number]> = [
  ["2029-09", 750000], // 第35級
  ["2028-09", 710000], // 第34級
  ["2027-09", 680000], // 第33級
];

/** その月 (保険料の対象月) の厚生年金の標準報酬月額の上限 */
export function pensionMaxFor(insuranceMonth?: string): number {
  if (!insuranceMonth) return PENSION_MAX;
  return PENSION_CAP_SCHEDULE.find(([from]) => insuranceMonth >= from)?.[1] ?? PENSION_MAX;
}

export function standardFromRemuneration(remuneration: number, insuranceMonth?: string): {
  healthGrade: number;
  healthStandard: number;
  pensionGrade: number;
  pensionStandard: number;
} {
  let g = HEALTH_GRADES[0];
  for (const row of HEALTH_GRADES) if (remuneration >= row[2]) g = row;
  const pensionStandard = pensionStandardOf(g[1], insuranceMonth);
  const pensionGrade = HEALTH_GRADES.find((r) => r[1] === pensionStandard)![0] - 3;
  return { healthGrade: g[0], healthStandard: g[1], pensionGrade, pensionStandard };
}

export function pensionStandardOf(healthStandard: number, insuranceMonth?: string): number {
  return Math.min(pensionMaxFor(insuranceMonth), Math.max(PENSION_MIN, healthStandard));
}

export function healthGradeOf(standard: number): number | null {
  return HEALTH_GRADES.find((r) => r[1] === standard)?.[0] ?? null;
}

/** 料率(%)を 1/100000 単位の整数に (9.85% → 9850) */
export function rateToMilli(ratePercent: number): number {
  return Math.round(ratePercent * 1000);
}

/**
 * 被保険者負担分の端数処理 (給与から控除する場合):
 * 50銭以下は切り捨て、50銭を超える場合は切り上げ。num/den 円を整数演算で丸める。
 */
export function roundEmployeeShare(num: number, den: number): number {
  const q = Math.floor(num / den);
  const r = num - q * den;
  return r * 2 > den ? q + 1 : q;
}

/** 標準報酬 × 料率 ÷ 2 (被保険者負担) */
export function halfShare(standard: number, ratePercent: number): number {
  return roundEmployeeShare(standard * rateToMilli(ratePercent), 200000);
}

/** 賃金 × 料率 (雇用保険の被保険者負担) */
export function employmentShare(wage: number, ratePercent: number): number {
  return roundEmployeeShare(wage * rateToMilli(ratePercent), 100000);
}

/**
 * 介護保険第2号被保険者 (40歳以上65歳未満) に該当する月か。
 * 40歳に達した日 (誕生日の前日) の属する月から、65歳に達した日の属する月の前月まで。
 */
export function careInsuranceApplies(birthDate: string | null | undefined, insuranceMonth: string): boolean {
  if (!birthDate) return false;
  const y = Number(birthDate.slice(0, 4));
  const md = birthDate.slice(4);
  const reach40 = addDays(`${y + 40}${md === "-02-29" ? "-03-01" : md}`, -1);
  const reach65 = addDays(`${y + 65}${md === "-02-29" ? "-03-01" : md}`, -1);
  return insuranceMonth >= monthOf(reach40) && insuranceMonth < monthOf(reach65);
}

/**
 * 資格取得月〜喪失月の前月 が保険料の対象。喪失日は退職日の翌日。
 * 同じ月に取得と喪失をした場合 (同月得喪) は、その月の保険料がかかる (健保法156条3項・厚年法19条2項)。
 */
export function insuredInMonth(hireDate: string, leaveDate: string | null | undefined, insuranceMonth: string): boolean {
  const hireMonth = monthOf(hireDate);
  if (insuranceMonth < hireMonth) return false;
  if (leaveDate) {
    const lossMonth = monthOf(addDays(leaveDate, 1));
    if (insuranceMonth >= lossMonth) return lossMonth === hireMonth && insuranceMonth === hireMonth;
  }
  return true;
}

export interface Rates {
  health: number;
  care: number;
  child_support: number;
  pension: number;
  employment_employee: number;
  employment_employer: number;
}

export interface SocialInsuranceResult {
  health: number; // 健康保険料 (介護分を除く)
  care: number; // 介護保険料
  childSupport: number; // 子ども・子育て支援金
  pension: number; // 厚生年金保険料
  employerHealth: number;
  employerCare: number;
  employerChildSupport: number;
  employerPension: number;
}

export function calcSocialInsurance(opts: {
  standard: number;
  rates: Rates;
  careApplies: boolean;
  health: boolean;
  pension: boolean;
  insuranceMonth?: string;
}): SocialInsuranceResult {
  const { standard, rates } = opts;
  const r: SocialInsuranceResult = {
    health: 0, care: 0, childSupport: 0, pension: 0,
    employerHealth: 0, employerCare: 0, employerChildSupport: 0, employerPension: 0,
  };
  if (opts.health && standard > 0) {
    // 健康保険料は 標準報酬月額 × (一般保険料率 + 介護保険料率 + 子ども・子育て支援金率) で一つの額 (健保法156条)。
    // 合算した料率で被保険者負担分を端数処理し、明細の内訳として介護分と支援金分を分ける。
    const careRate = opts.careApplies ? rates.care : 0;
    const childRate = rates.child_support > 0 ? rates.child_support : 0;
    const total = halfShare(standard, rates.health + careRate + childRate);
    r.care = careRate ? halfShare(standard, careRate) : 0;
    r.childSupport = childRate ? halfShare(standard, childRate) : 0;
    r.health = total - r.care - r.childSupport;
    const full = Math.floor((standard * rateToMilli(rates.health + careRate + childRate)) / 100000);
    const fullChild = Math.floor((standard * rateToMilli(childRate)) / 100000);
    r.employerChildSupport = fullChild - r.childSupport;
    r.employerHealth = full - total - r.employerChildSupport;
    r.employerCare = 0;
  }
  if (opts.pension && standard > 0) {
    const ps = pensionStandardOf(standard, opts.insuranceMonth);
    r.pension = halfShare(ps, rates.pension);
    r.employerPension = Math.floor((ps * rateToMilli(rates.pension)) / 100000) - r.pension;
  }
  return r;
}

/** 社会保険料の対象月 (翌月徴収なら支給月の前月) */
export function insuranceMonthFor(payMonth: string, timing: "next" | "current"): string {
  return timing === "next" ? addMonths(payMonth, -1) : payMonth;
}

/** 令和8年度時点の既定料率 (協会けんぽ東京支部 / 一般の事業) */
export const DEFAULT_RATE_ROWS: Array<{ kind: keyof Rates; effective_from: string; rate: number; note: string }> = [
  { kind: "health", effective_from: "2025-03", rate: 9.91, note: "協会けんぽ東京支部 令和7年度" },
  { kind: "health", effective_from: "2026-03", rate: 9.85, note: "協会けんぽ東京支部 令和8年度 (3月分から)" },
  { kind: "care", effective_from: "2025-03", rate: 1.59, note: "令和7年度 介護保険料率" },
  { kind: "care", effective_from: "2026-03", rate: 1.62, note: "令和8年度 介護保険料率 (3月分から)" },
  { kind: "child_support", effective_from: "2026-04", rate: 0.23, note: "子ども・子育て支援金率 (令和8年4月分から)" },
  { kind: "pension", effective_from: "2017-09", rate: 18.3, note: "厚生年金保険料率" },
  { kind: "employment_employee", effective_from: "2025-04", rate: 0.55, note: "令和7年度 一般の事業" },
  { kind: "employment_employee", effective_from: "2026-04", rate: 0.5, note: "令和8年度 一般の事業 (5/1000)" },
  { kind: "employment_employer", effective_from: "2025-04", rate: 0.9, note: "令和7年度 一般の事業" },
  { kind: "employment_employer", effective_from: "2026-04", rate: 0.85, note: "令和8年度 一般の事業 (8.5/1000)" },
];

export function pickRates(
  rows: Array<{ kind: string; effective_from: string; rate: number }>,
  insuranceMonth: string,
  wageMonth: string,
): Rates {
  const pick = (kind: keyof Rates, month: string) => {
    let best: { effective_from: string; rate: number } | null = null;
    for (const r of rows) {
      if (r.kind !== kind || r.effective_from > month) continue;
      if (!best || r.effective_from > best.effective_from) best = r;
    }
    return best?.rate ?? 0;
  };
  return {
    health: pick("health", insuranceMonth),
    care: pick("care", insuranceMonth),
    child_support: pick("child_support", insuranceMonth),
    pension: pick("pension", insuranceMonth),
    employment_employee: pick("employment_employee", wageMonth),
    employment_employer: pick("employment_employer", wageMonth),
  };
}
