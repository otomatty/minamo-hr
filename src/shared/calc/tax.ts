// 源泉所得税 (月額表) の電算機計算の特例
// 出典: 国税庁「月額表の甲欄を適用する給与等に対する源泉徴収税額の電算機計算の特例について」
//       令和8年分 (zeigakuhyo2026/data/denshi_01.pdf)、令和9年分 (zeigakuhyo2027/data/denshi_01.pdf)
//       「月額表の乙欄を適用する給与等に対する源泉徴収税額の電算機計算の特例について」令和8年分 (denshi_02.pdf)
// 税額には復興特別所得税 (令和9年分以後は防衛特別所得税も) が含まれる。

interface KouTable {
  salaryDeduction: (a: number) => number; // 給与所得控除 (1円未満切上げ)
  basicDeduction: (a: number) => number;
}

const SPOUSE_OR_DEPENDENT = 31667;

const RATE_TABLE: Array<[number, number, number]> = [
  // [B の上限, 税率(%), 控除額]
  [162500, 5.105, 0],
  [275000, 10.21, 8296],
  [579166, 20.42, 36374],
  [750000, 23.483, 54113],
  [1500000, 33.693, 130688],
  [3333333, 40.84, 237893],
  [Infinity, 45.945, 408061],
];

function salaryDeductionWith(minimum: number, minUpper: number) {
  return (a: number) => {
    if (a <= minUpper) return minimum;
    if (a <= 299999) return Math.ceil(a * 0.3 + 6667);
    if (a <= 549999) return Math.ceil(a * 0.2 + 36667);
    if (a <= 708330) return Math.ceil(a * 0.1 + 91667);
    return 162500;
  };
}

function basicDeductionWith(base: number) {
  return (a: number) => {
    if (a <= 2120833) return base;
    if (a <= 2162499) return 40000;
    if (a <= 2204166) return 26667;
    if (a <= 2245833) return 13334;
    return 0;
  };
}

const KOU_2026: KouTable = {
  salaryDeduction: salaryDeductionWith(54167, 158333),
  basicDeduction: basicDeductionWith(48334),
};
const KOU_2027: KouTable = {
  salaryDeduction: salaryDeductionWith(57500, 169444),
  basicDeduction: basicDeductionWith(51667),
};

export function kouTableYear(payYear: number): 2026 | 2027 {
  return payYear >= 2027 ? 2027 : 2026;
}

/**
 * 甲欄: A = その月の社会保険料等控除後の給与等の金額、dependents = 源泉控除対象配偶者 + 源泉控除対象親族 (+障害者等の加算)
 * 第2表の配偶者控除・扶養控除は 1人につき 31,667円
 */
export function withholdingKou(a: number, dependents: number, payYear: number): number {
  if (a <= 0) return 0;
  const t = kouTableYear(payYear) === 2027 ? KOU_2027 : KOU_2026;
  const b = a - t.salaryDeduction(a) - SPOUSE_OR_DEPENDENT * Math.max(0, dependents) - t.basicDeduction(a);
  if (b <= 0) return 0;
  const row = RATE_TABLE.find((r) => b <= r[0])!;
  const tax = (b * row[1]) / 100 - row[2];
  // 10円未満の端数は四捨五入
  return Math.max(0, Math.round(tax / 10 + 1e-9) * 10);
}

// 乙欄 (令和8年分)
const OTSU_RATE: Array<[number, number, number]> = [
  [162500, 5, 0],
  [275000, 10, 8125],
  [579166, 20, 35625],
  [750000, 23, 53000],
  [1500000, 33, 128000],
  [3333333, 40, 233000],
];

function roundTo100HalfUp(x: number): number {
  return Math.floor((x + 50) / 100) * 100;
}

function otsuIncomeTax(base: number): number {
  const ded = KOU_2026.salaryDeduction(base);
  const b = base - ded - 48334;
  if (b <= 0) return 0;
  const row = OTSU_RATE.find((r) => b <= r[0]) ?? OTSU_RATE[OTSU_RATE.length - 1];
  return Math.floor((b * row[1]) / 100 - row[2] + 1e-7);
}

/** 乙欄 (令和8年分の算式。令和9年分の乙欄の算式は未対応のため同じ算式で近似し、警告を出す) */
export function withholdingOtsu(a: number): number {
  if (a <= 0) return 0;
  if (a < 105000) return Math.floor((a * 3.063) / 100 + 1e-7);
  if (a <= 740000) {
    let base: number;
    if (a === 740000) base = 740000;
    else if (a <= 220999) base = a - ((a - 105000) % 2000);
    else base = a - ((a - 221000) % 3000);
    const c = roundTo100HalfUp(otsuIncomeTax(base * 2.5) - otsuIncomeTax(base * 1.5));
    return roundTo100HalfUp(c * 1.021);
  }
  if (a < 1710000) return Math.floor(259200 + ((a - 740000) * 40.84) / 100 + 1e-7);
  return Math.floor(655400 + ((a - 1710000) * 45.945) / 100 + 1e-7);
}
