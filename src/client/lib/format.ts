import { WEEKDAY_JA, weekday } from "../../shared/dates";

export const yen = (n: number | null | undefined) => (n === null || n === undefined ? "-" : `${Math.round(n).toLocaleString("ja-JP")}`);
export const yenUnit = (n: number | null | undefined) => (n === null || n === undefined ? "-" : `${yen(n)}円`);

export function hm(min: number | null | undefined): string {
  if (!min) return "0:00";
  const a = Math.round(Math.abs(min));
  return `${min < 0 ? "-" : ""}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
}

export const hmOrDash = (min: number | null | undefined) => (min ? hm(min) : "");

export function time(dt: string | null | undefined): string {
  return dt ? dt.slice(11, 16) : "";
}

export function mdW(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))} (${WEEKDAY_JA[weekday(date)]})`;
}

export function ymdJa(date: string | null | undefined): string {
  if (!date) return "";
  return `${date.slice(0, 4)}年${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
}

export function monthJa(month: string): string {
  return `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;
}

export function dateTimeJa(s: string | null | undefined): string {
  if (!s) return "";
  // DB の datetime('now') は UTC。'YYYY-MM-DD HH:MM:SS' 形式は UTC として JST に直す
  if (s.length === 19 && s[10] === " ") {
    const d = new Date(s.replace(" ", "T") + "Z");
    const j = new Date(d.getTime() + 9 * 3600000).toISOString();
    return `${Number(j.slice(5, 7))}/${Number(j.slice(8, 10))} ${j.slice(11, 16)}`;
  }
  return `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))} ${s.slice(11, 16)}`;
}

export const ROLE_JA: Record<string, string> = { admin: "管理者", manager: "マネージャー", employee: "一般" };
export const EMPLOYMENT_JA: Record<string, string> = { full_time: "正社員", contract: "契約社員", part_time: "パート・アルバイト", temporary: "派遣", executive: "役員" };
export const EMP_STATUS_JA: Record<string, string> = { pre_hire: "入社予定", active: "在籍", leave_of_absence: "休職中", retired: "退職" };
export const KIND_JA: Record<string, string> = { leave: "休暇", punch_fix: "打刻修正", overtime: "残業", expense: "経費", general: "汎用" };
export const REQ_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "下書き", cls: "bg-line-2 text-ink-2" },
  pending: { label: "承認待ち", cls: "bg-ai-100 text-ai-800" },
  approved: { label: "承認済み", cls: "bg-ok-bg text-ok" },
  rejected: { label: "却下", cls: "bg-ng-bg text-ng" },
  returned: { label: "差戻し", cls: "bg-warn-bg text-warn" },
  withdrawn: { label: "取下げ", cls: "bg-line-2 text-ink-3" },
  canceled: { label: "取消", cls: "bg-line-2 text-ink-3" },
};
export const RUN_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "計算中", cls: "bg-ai-100 text-ai-800" },
  confirmed: { label: "確定", cls: "bg-warn-bg text-warn" },
  published: { label: "明細公開済み", cls: "bg-ok-bg text-ok" },
};
export const UNIT_JA: Record<string, string> = { full: "全日", am: "午前休", pm: "午後休" };
export const GENDER_JA: Record<string, string> = { male: "男性", female: "女性", other: "その他", "": "未設定" };
export const EVENT_JA: Record<string, string> = { hire: "入社", transfer: "異動", promotion: "昇格・役職変更", leave_of_absence: "休職", return: "復職", retire: "退職", other: "その他" };

export function fullName(e: { last_name?: string; first_name?: string } | null | undefined) {
  return e ? `${e.last_name ?? ""} ${e.first_name ?? ""}`.trim() : "";
}

export function currentMonth(closingDay = 0): string {
  const now = new Date(Date.now() + 9 * 3600000);
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth() + 1;
  if (closingDay && now.getUTCDate() > closingDay) {
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function todayJst(): string {
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
}
