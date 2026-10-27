import { all, first, insert, run } from "../lib/db";
import type { SessionUser } from "../lib/context";

export interface Company {
  id: number;
  name: string;
  app_name: string;
  closing_day: number;
  pay_day: number;
  pay_month_offset: number;
  social_insurance_timing: "next" | "current";
  legal_holiday_weekday: number;
  week_start: number;
  monthly_avg_hours: number;
  employment_insurance_type: string;
  overtime_alert_hours: number;
}

export async function loadCompany(db: D1Database): Promise<Company | null> {
  return first<Company>(db, "SELECT * FROM company WHERE id = 1");
}

export async function notify(db: D1Database, employeeIds: number[], title: string, body = "", link: string | null = null) {
  const ids = [...new Set(employeeIds.filter(Boolean))];
  if (!ids.length) return;
  await db.batch(
    ids.map((id) => db.prepare("INSERT INTO notifications (employee_id, title, body, link) VALUES (?, ?, ?, ?)").bind(id, title, body, link)),
  );
}

export async function adminEmployeeIds(db: D1Database): Promise<number[]> {
  return (await all<{ employee_id: number }>(db, "SELECT employee_id FROM users WHERE role = 'admin' AND is_active = 1")).map((r) => r.employee_id);
}

export async function audit(db: D1Database, user: SessionUser | null, action: string, targetType: string, targetId: string | number, detail?: unknown) {
  await insert(
    db,
    "INSERT INTO audit_logs (user_id, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?)",
    user?.userId ?? null,
    action,
    targetType,
    String(targetId),
    detail === undefined ? null : JSON.stringify(detail),
  );
}

export function fullName(e: { last_name: string; first_name: string } | null | undefined): string {
  return e ? `${e.last_name} ${e.first_name}` : "";
}

/** マネージャーが閲覧できる部下 (直属 + 自分が部門長の部署 (配下含む) の所属者) */
export async function subordinateIds(db: D1Database, managerEmployeeId: number): Promise<number[]> {
  const depts = await all<{ id: number; parent_id: number | null; head_employee_id: number | null }>(
    db,
    "SELECT id, parent_id, head_employee_id FROM departments",
  );
  const headed = new Set(depts.filter((d) => d.head_employee_id === managerEmployeeId).map((d) => d.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of depts) {
      if (d.parent_id && headed.has(d.parent_id) && !headed.has(d.id)) {
        headed.add(d.id);
        changed = true;
      }
    }
  }
  const rows = await all<{ id: number; manager_id: number | null; department_id: number | null }>(
    db,
    "SELECT id, manager_id, department_id FROM employees WHERE status != 'retired'",
  );
  return rows
    .filter((r) => r.id !== managerEmployeeId && (r.manager_id === managerEmployeeId || (r.department_id && headed.has(r.department_id))))
    .map((r) => r.id);
}

export async function canViewEmployee(db: D1Database, user: SessionUser, employeeId: number): Promise<boolean> {
  if (user.role === "admin" || user.employeeId === employeeId) return true;
  if (user.role === "manager") return (await subordinateIds(db, user.employeeId)).includes(employeeId);
  return false;
}

export async function isLocked(db: D1Database, attendanceMonth: string): Promise<boolean> {
  return !!(await first(db, "SELECT period FROM attendance_locks WHERE period = ?", attendanceMonth));
}

export { run };
