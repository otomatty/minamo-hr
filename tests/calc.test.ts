import { describe, expect, it } from "vitest";
import { withholdingKou, withholdingOtsu } from "../src/shared/calc/tax";
import {
  calcSocialInsurance,
  careInsuranceApplies,
  employmentShare,
  halfShare,
  insuredInMonth,
  pickRates,
  DEFAULT_RATE_ROWS,
  standardFromRemuneration,
} from "../src/shared/calc/insurance";
import { calcDay, summarizePeriod, lateNightOverlap, type PatternInfo } from "../src/shared/calc/attendance";
import { grantSchedule } from "../src/shared/calc/leave";
import { calcPayslip, type SalarySetting } from "../src/shared/calc/payroll";
import { attendancePeriod, attendanceMonthOf, toMinutes, addMonthsToDate } from "../src/shared/dates";

const pattern: PatternInfo = {
  startTime: "09:00",
  endTime: "18:00",
  breakMinutes: 60,
  scheduledMinutes: 480,
  workDays: [1, 2, 3, 4, 5],
  lateGraceMinutes: 0,
};

describe("源泉所得税 (電算機計算の特例)", () => {
  it("甲欄 令和8年分: A=300,000 扶養1人", () => {
    // 給与所得控除 96,667 / 扶養 31,667 / 基礎 48,334 → B=123,332 → ×5.105% = 6,296.1 → 6,300
    expect(withholdingKou(300000, 1, 2026)).toBe(6300);
  });
  it("甲欄 令和8年分: A=200,000 扶養0人", () => {
    // 給与所得控除 66,667 / 基礎 48,334 → B=85,000 → 4,339.25 → 4,340
    expect(withholdingKou(200000, 0, 2026)).toBe(4340);
  });
  it("甲欄 令和8年分: 少額は0円", () => {
    expect(withholdingKou(100000, 0, 2026)).toBe(0);
  });
  it("甲欄 令和9年分: 基礎控除 51,667 / 給与所得控除の最低額 57,500 が反映される", () => {
    // 300,000 扶養1人: 96,667 + 31,667 + 51,667 → B=119,999 → 6,125.9 → 6,130
    expect(withholdingKou(300000, 1, 2027)).toBe(6130);
  });
  it("甲欄: 高所得 A=1,000,000 扶養2人 (令和8年分)", () => {
    // 給与所得控除 162,500 / 扶養 63,334 / 基礎 48,334 → B=725,832 → ×23.483% − 54,113 = 116,333.6 → 116,330
    expect(withholdingKou(1000000, 2, 2026)).toBe(116330);
  });
  it("乙欄 令和8年分: A=300,000 は月額表の 53,600円 と一致", () => {
    expect(withholdingOtsu(300000)).toBe(53600);
  });
  it("乙欄: 105,000円未満は 3.063%", () => {
    expect(withholdingOtsu(100000)).toBe(3063);
  });
});

describe("社会保険料 (協会けんぽ東京 令和8年度)", () => {
  const rates = pickRates(DEFAULT_RATE_ROWS, "2026-10", "2026-10");
  it("料率の選択", () => {
    expect(rates).toEqual({
      health: 9.85,
      care: 1.62,
      child_support: 0.23,
      pension: 18.3,
      employment_employee: 0.5,
      employment_employer: 0.85,
    });
    const march = pickRates(DEFAULT_RATE_ROWS, "2026-03", "2026-03");
    expect(march.child_support).toBe(0);
    expect(march.health).toBe(9.85);
    expect(march.employment_employee).toBe(0.55);
  });
  it("標準報酬30万円: 健保 14,775 / 介護込 17,205 / 厚年 27,450", () => {
    expect(halfShare(300000, 9.85)).toBe(14775);
    const si = calcSocialInsurance({ standard: 300000, rates, careApplies: true, health: true, pension: true });
    expect(si.health + si.care).toBe(17205);
    expect(si.care).toBe(2430);
    expect(si.pension).toBe(27450);
    expect(si.childSupport).toBe(345);
  });
  it("端数: 50銭以下切捨て・50銭超切上げ", () => {
    // 98,000 × 9.85% / 2 = 4,826.5 → 4,826
    expect(halfShare(98000, 9.85)).toBe(4826);
    // 58,000 × 0.23% / 2 = 66.7 → 67
    expect(halfShare(58000, 0.23)).toBe(67);
  });
  it("厚生年金は 88,000〜650,000 の範囲", () => {
    const low = calcSocialInsurance({ standard: 58000, rates, careApplies: false, health: true, pension: true });
    expect(low.pension).toBe(halfShare(88000, 18.3));
    const high = calcSocialInsurance({ standard: 1390000, rates, careApplies: false, health: true, pension: true });
    expect(high.pension).toBe(halfShare(650000, 18.3));
  });
  it("標準報酬月額の決定", () => {
    expect(standardFromRemuneration(305000)).toEqual({ healthGrade: 22, healthStandard: 300000, pensionGrade: 19, pensionStandard: 300000 });
    expect(standardFromRemuneration(50000).pensionStandard).toBe(88000);
    expect(standardFromRemuneration(2000000)).toMatchObject({ healthGrade: 50, pensionGrade: 32 });
  });
  it("雇用保険 5/1000", () => {
    expect(employmentShare(300000, 0.5)).toBe(1500);
    // 123,401 × 0.5% = 617.005 → 617
    expect(employmentShare(123401, 0.5)).toBe(617);
    // 123,501 × 0.5% = 617.505 → 618
    expect(employmentShare(123501, 0.5)).toBe(618);
  });
  it("介護保険の対象月 (40歳に達した日 = 誕生日の前日の属する月から)", () => {
    expect(careInsuranceApplies("1986-11-01", "2026-10")).toBe(true);
    expect(careInsuranceApplies("1986-11-01", "2026-09")).toBe(false);
    expect(careInsuranceApplies("1986-11-02", "2026-10")).toBe(false);
    expect(careInsuranceApplies("1986-11-02", "2026-11")).toBe(true);
    expect(careInsuranceApplies("1961-11-02", "2026-10")).toBe(true);
    expect(careInsuranceApplies("1961-11-02", "2026-11")).toBe(false);
  });
  it("資格喪失月 (月末退職はその月まで対象)", () => {
    expect(insuredInMonth("2020-04-01", "2026-10-31", "2026-10")).toBe(true);
    expect(insuredInMonth("2020-04-01", "2026-10-30", "2026-10")).toBe(false);
    expect(insuredInMonth("2026-10-15", null, "2026-10")).toBe(true);
    expect(insuredInMonth("2026-10-15", null, "2026-09")).toBe(false);
  });
});

describe("勤怠計算", () => {
  it("残業 2時間 (9:00-20:00, 自動休憩60分)", () => {
    const r = calcDay(
      { date: "2026-10-26", clockIn: "2026-10-26T09:00:00", clockOut: "2026-10-26T20:00:00", breaks: [], dayType: "workday", leaves: [] },
      pattern,
      "2026-10-27",
    );
    expect(r.workMinutes).toBe(600);
    expect(r.regularMinutes).toBe(480);
    expect(r.legalOvertime).toBe(120);
    expect(r.autoBreak).toBe(true);
  });
  it("遅刻・早退", () => {
    const r = calcDay(
      { date: "2026-10-26", clockIn: "2026-10-26T09:15:00", clockOut: "2026-10-26T17:30:00", breaks: [{ start: "2026-10-26T12:00:00", end: "2026-10-26T13:00:00" }], dayType: "workday", leaves: [] },
      pattern,
      "2026-10-27",
    );
    expect(r.lateMinutes).toBe(15);
    expect(r.earlyLeaveMinutes).toBe(30);
    expect(r.workMinutes).toBe(435);
  });
  it("深夜帯 (22:00-5:00)", () => {
    expect(lateNightOverlap(toMinutes("2026-10-26T21:00"), toMinutes("2026-10-26T23:30"))).toBe(90);
    expect(lateNightOverlap(toMinutes("2026-10-26T20:00"), toMinutes("2026-10-27T06:00"))).toBe(420);
    expect(lateNightOverlap(toMinutes("2026-10-27T03:00"), toMinutes("2026-10-27T09:00"))).toBe(120);
  });
  it("法定休日労働", () => {
    const r = calcDay(
      { date: "2026-10-25", clockIn: "2026-10-25T10:00:00", clockOut: "2026-10-25T15:00:00", breaks: [], dayType: "legal_holiday", leaves: [] },
      pattern,
      "2026-10-27",
    );
    expect(r.legalHolidayMinutes).toBe(300);
    expect(r.legalOvertime).toBe(0);
  });
  it("欠勤の判定 (過去の所定労働日で打刻なし)", () => {
    const r = calcDay({ date: "2026-10-26", clockIn: null, clockOut: null, breaks: [], dayType: "workday", leaves: [] }, pattern, "2026-10-27");
    expect(r.absent).toBe(true);
    const leave = calcDay({ date: "2026-10-26", clockIn: null, clockOut: null, breaks: [], dayType: "workday", leaves: [{ unit: "full", paid: true, name: "年休" }] }, pattern, "2026-10-27");
    expect(leave.absent).toBe(false);
    expect(leave.paidLeaveDays).toBe(1);
  });
  it("週40時間超: 土曜 (所定休日) の8時間は法定外残業に振り替わる", () => {
    const dates = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"];
    const days = dates.map((d, i) =>
      calcDay(
        { date: d, clockIn: `${d}T09:00:00`, clockOut: `${d}T18:00:00`, breaks: [], dayType: i === 5 ? "scheduled_off" : "workday", leaves: [] },
        pattern,
        "2026-10-27",
      ),
    );
    expect(days[5].nonScheduledMinutes).toBe(480);
    const { summary } = summarizePeriod(days, "2026-10-01", "2026-10-31", 0);
    expect(summary.legalOvertime).toBe(480);
    expect(summary.nonScheduledMinutes).toBe(0);
    expect(summary.scheduledDays).toBe(5);
  });
});

describe("有給休暇の付与", () => {
  it("フルタイム: 6か月後に10日、1年6か月後に11日", () => {
    const s = grantSchedule("2025-04-01", "2026-10-27", 5, 40);
    expect(s.map((x) => [x.grantedOn, x.days])).toEqual([["2025-10-01", 10], ["2026-10-01", 11]]);
    expect(s[0].expiresOn).toBe("2027-10-01");
  });
  it("比例付与: 週3日・20時間は5日", () => {
    expect(grantSchedule("2026-04-01", "2026-10-01", 3, 20)[0].days).toBe(5);
  });
  it("月末日の入社", () => {
    expect(addMonthsToDate("2026-08-31", 6)).toBe("2027-02-28");
  });
});

describe("勤怠月度", () => {
  it("末日締め", () => {
    expect(attendancePeriod("2026-02", 0)).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });
  it("20日締め", () => {
    expect(attendancePeriod("2026-11", 20)).toEqual({ start: "2026-10-21", end: "2026-11-20" });
    expect(attendanceMonthOf("2026-10-21", 20)).toBe("2026-11");
    expect(attendanceMonthOf("2026-10-20", 20)).toBe("2026-10");
  });
});

describe("給与計算 (結合)", () => {
  const setting: SalarySetting = {
    pay_type: "monthly",
    base_salary: 280000,
    hourly_wage: 0,
    daily_wage: 0,
    allowances: [{ name: "役職手当", amount: 20000, taxable: true, overtime_base: true }],
    commute_allowance: 15000,
    other_deductions: [],
    standard_monthly_remuneration: 320000,
    health_insurance: true,
    pension_insurance: true,
    employment_insurance: true,
    care_insurance: "auto",
    tax_column: "kou",
    tax_dependents_adjust: 0,
    resident_tax_june: 18000,
    resident_tax_monthly: 15000,
    absence_deduction: true,
  };
  const attendance = {
    scheduledDays: 21, workDays: 21, absenceDays: 0, paidLeaveDays: 0, unpaidLeaveDays: 0, holidayWorkDays: 0,
    totalWorkMinutes: 21 * 480 + 600, regularMinutes: 21 * 480, withinLegalOvertime: 0, legalOvertime: 600,
    legalOvertimeFromRegular: 0, over60Minutes: 0, nonScheduledMinutes: 0, legalHolidayMinutes: 0, lateNightMinutes: 0,
    lateCount: 0, lateMinutes: 0, earlyLeaveCount: 0, earlyLeaveMinutes: 0, incompleteDays: 0,
  };
  it("月給30万円・残業10時間・扶養1人・35歳", () => {
    const r = calcPayslip({
      employee: { birth_date: "1991-05-10", hire_date: "2020-04-01", leave_date: null, employment_type: "full_time" },
      setting,
      attendance,
      workdayWorkDays: 21,
      scheduledMinutesPerDay: 480,
      monthlyAvgHours: 160,
      payMonth: "2026-11",
      payDate: "2026-11-25",
      insuranceMonth: "2026-10",
      rates: pickRates(DEFAULT_RATE_ROWS, "2026-10", "2026-10"),
      dependentsCount: 1,
      prorate: null,
      adjustments: [],
      expenseReimbursement: 5000,
    });
    // 単価 = 300,000 / 160 = 1,875円 → 時間外 1,875 × 1.25 × 10h = 23,437.5 → 23,438
    expect(r.payments.find((p) => p.code === "overtime")?.amount).toBe(23438);
    // 総支給 = 280,000 + 20,000 + 23,438 + 15,000 + 5,000
    expect(r.totals.gross).toBe(343438);
    // 健保 320,000 × 9.85% / 2 = 15,760 / 子育て支援金 368 / 厚年 29,280
    expect(r.deductions.find((d) => d.code === "health")?.amount).toBe(15760);
    expect(r.deductions.find((d) => d.code === "child_support")?.amount).toBe(368);
    expect(r.deductions.find((d) => d.code === "pension")?.amount).toBe(29280);
    // 雇用保険: (343,438 − 5,000 経費) × 0.5% = 1,692.19 → 1,692
    expect(r.deductions.find((d) => d.code === "employment")?.amount).toBe(1692);
    // 課税対象 323,438 − 社保 47,100 = 276,338 → 甲欄 扶養1人
    expect(r.totals.taxBase).toBe(276338);
    expect(r.deductions.find((d) => d.code === "income_tax")?.amount).toBe(withholdingKou(276338, 1, 2026));
    expect(r.deductions.find((d) => d.code === "resident_tax")?.amount).toBe(15000);
    expect(r.totals.net).toBe(r.totals.gross - r.totals.deductions);
  });
});
