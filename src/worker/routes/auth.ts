import { Hono } from "hono";
import { all, first, insert, run } from "../lib/db";
import { badRequest, conflict, HttpError, tzOffset, type AppEnv } from "../lib/context";
import {
  checkLoginRate,
  clearLoginRate,
  createSession,
  destroySession,
  hashPassword,
  optionalUser,
  requireAuth,
  validatePassword,
  verifyPassword,
} from "../lib/auth";
import { masterDataStatements } from "../lib/defaults";
import { loadCompany } from "../domain/common";
import { todayLocal } from "../../shared/dates";
import { autoGrantLeave } from "../domain/leave";
import { seedSampleData } from "../lib/sample";

export const authRoutes = new Hono<AppEnv>();

authRoutes.get("/setup/status", async (c) => {
  const company = await loadCompany(c.env.DB);
  return c.json({ needsSetup: !company, appName: company?.app_name ?? "ミナモ", companyName: company?.name ?? null });
});

/** 初期セットアップ: 会社と最初の管理者を作成 */
authRoutes.post("/setup", async (c) => {
  if (await loadCompany(c.env.DB)) throw conflict("セットアップは完了しています");
  const b = await c.req.json<any>();
  const companyName = String(b.companyName ?? "").trim();
  const lastName = String(b.lastName ?? "").trim();
  const firstName = String(b.firstName ?? "").trim();
  const email = String(b.email ?? "").trim().toLowerCase();
  const password = String(b.password ?? "");
  if (!companyName || !lastName || !firstName) throw badRequest("会社名と氏名を入力してください");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest("メールアドレスの形式が正しくありません");
  const pwErr = validatePassword(password);
  if (pwErr) throw badRequest(pwErr);

  const db = c.env.DB;
  const today = todayLocal(tzOffset(c.env));
  await db.batch([
    db.prepare("INSERT INTO company (id, name) VALUES (1, ?)").bind(companyName),
    ...masterDataStatements(db),
    db.prepare("INSERT INTO departments (name, code, sort_order) VALUES ('人事総務部', 'HR', 0)"),
  ]);
  const dept = await first<{ id: number }>(db, "SELECT id FROM departments ORDER BY id LIMIT 1");
  const pattern = await first<{ id: number }>(db, "SELECT id FROM work_patterns WHERE is_default = 1");
  const position = await first<{ id: number }>(db, "SELECT id FROM positions WHERE name = '部長'");
  const empId = await insert(
    db,
    `INSERT INTO employees (code, last_name, first_name, email, hire_date, department_id, position_id, work_pattern_id)
     VALUES ('0001', ?, ?, ?, ?, ?, ?, ?)`,
    lastName,
    firstName,
    email,
    b.hireDate || today,
    dept?.id ?? null,
    position?.id ?? null,
    pattern?.id ?? null,
  );
  await run(db, "UPDATE departments SET head_employee_id = ? WHERE id = ?", empId, dept?.id ?? 0);
  await run(db, "INSERT INTO personnel_events (employee_id, event_date, event_type, description) VALUES (?, ?, 'hire', '入社')", empId, b.hireDate || today);
  const userId = await insert(
    db,
    "INSERT INTO users (employee_id, email, password_hash, role) VALUES (?, ?, ?, 'admin')",
    empId,
    email,
    await hashPassword(password),
  );
  if (b.withSampleData) await seedSampleData(db, empId, today);
  await autoGrantLeave(db, today);
  await createSession(c, userId);
  return c.json({ ok: true });
});

authRoutes.post("/auth/login", async (c) => {
  const b = await c.req.json<any>();
  const email = String(b.email ?? "").trim().toLowerCase();
  const password = String(b.password ?? "");
  if (!email || !password) throw badRequest("メールアドレスとパスワードを入力してください");
  await checkLoginRate(c.env.SESSIONS, email);
  const user = await first<any>(
    c.env.DB,
    "SELECT u.*, e.status FROM users u JOIN employees e ON e.id = u.employee_id WHERE u.email = ?",
    email,
  );
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw new HttpError(401, "メールアドレスまたはパスワードが正しくありません");
  }
  if (!user.is_active || user.status === "retired") throw new HttpError(403, "このアカウントは利用できません");
  await clearLoginRate(c.env.SESSIONS, email);
  await run(c.env.DB, "UPDATE users SET last_login_at = datetime('now') WHERE id = ?", user.id);
  await createSession(c, user.id);
  return c.json({ ok: true });
});

authRoutes.post("/auth/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

authRoutes.get("/auth/me", async (c) => {
  const user = await optionalUser(c);
  if (!user) return c.json({ user: null });
  const company = await loadCompany(c.env.DB);
  const unread = await first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM notifications WHERE employee_id = ? AND read_at IS NULL", user.employeeId);
  return c.json({
    user,
    company: company && { name: company.name, appName: company.app_name, closingDay: company.closing_day },
    unreadNotifications: unread?.n ?? 0,
  });
});

authRoutes.post("/auth/password", requireAuth, async (c) => {
  const user = c.get("user");
  const b = await c.req.json<any>();
  const row = await first<any>(c.env.DB, "SELECT password_hash FROM users WHERE id = ?", user.userId);
  if (!row || !(await verifyPassword(String(b.current ?? ""), row.password_hash))) throw badRequest("現在のパスワードが正しくありません");
  const err = validatePassword(String(b.next ?? ""));
  if (err) throw badRequest(err);
  await run(c.env.DB, "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?", await hashPassword(String(b.next)), user.userId);
  return c.json({ ok: true });
});

authRoutes.get("/notifications", requireAuth, async (c) => {
  const user = c.get("user");
  return c.json(await all(c.env.DB, "SELECT * FROM notifications WHERE employee_id = ? ORDER BY id DESC LIMIT 50", user.employeeId));
});

authRoutes.post("/notifications/read", requireAuth, async (c) => {
  const user = c.get("user");
  const b = await c.req.json<any>().catch(() => ({}));
  if (b.id) await run(c.env.DB, "UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND employee_id = ?", b.id, user.employeeId);
  else await run(c.env.DB, "UPDATE notifications SET read_at = datetime('now') WHERE employee_id = ? AND read_at IS NULL", user.employeeId);
  return c.json({ ok: true });
});
