// 年次有給休暇の付与日数 (労働基準法第39条)
import { addMonthsToDate } from "../dates";

// 継続勤務 0.5年, 1.5年, 2.5年, 3.5年, 4.5年, 5.5年, 6.5年以上
const FULL_TIME = [10, 11, 12, 14, 16, 18, 20];
// 週所定労働時間 30時間未満 かつ 週所定労働日数 4日以下 の比例付与
const PROPORTIONAL: Record<number, number[]> = {
  4: [7, 8, 9, 10, 12, 13, 15],
  3: [5, 6, 6, 8, 9, 10, 11],
  2: [3, 4, 4, 5, 6, 6, 7],
  1: [1, 2, 2, 2, 3, 3, 3],
};

export function grantDaysFor(index: number, weeklyDays: number, weeklyHours: number): number {
  const i = Math.min(index, 6);
  if (weeklyHours >= 30 || weeklyDays >= 5) return FULL_TIME[i];
  const d = Math.floor(weeklyDays);
  if (d < 1) return 0;
  return PROPORTIONAL[Math.min(4, d)][i];
}

export interface GrantPlan {
  index: number;
  grantedOn: string;
  expiresOn: string;
  days: number;
}

/** 入社日から asOf までに発生する付与予定 (時効2年) */
export function grantSchedule(
  hireDate: string,
  asOf: string,
  weeklyDays: number,
  weeklyHours: number,
): GrantPlan[] {
  const plans: GrantPlan[] = [];
  for (let i = 0; i < 60; i++) {
    const grantedOn = addMonthsToDate(hireDate, 6 + i * 12);
    if (grantedOn > asOf) break;
    const days = grantDaysFor(i, weeklyDays, weeklyHours);
    if (days > 0) plans.push({ index: i, grantedOn, expiresOn: addMonthsToDate(grantedOn, 24), days });
  }
  return plans;
}

export function nextGrant(hireDate: string, after: string, weeklyDays: number, weeklyHours: number): GrantPlan | null {
  for (let i = 0; i < 60; i++) {
    const grantedOn = addMonthsToDate(hireDate, 6 + i * 12);
    if (grantedOn > after) {
      return {
        index: i,
        grantedOn,
        expiresOn: addMonthsToDate(grantedOn, 24),
        days: grantDaysFor(i, weeklyDays, weeklyHours),
      };
    }
  }
  return null;
}
