import { Hono } from "hono";
import { all, first, run } from "../lib/db";
import { badRequest, conflict, forbidden, HttpError, tzOffset, type AppEnv } from "../lib/context";
import { authConfigured, googleSession, optionalUser, requireAuth, setupAdminEmail, signInDenial } from "../lib/auth";
import { masterDataStatements } from "../lib/defaults";
import { loadCompany } from "../domain/common";
import { todayLocal } from "../../shared/dates";
import { autoGrantLeave } from "../domain/leave";
import { seedSampleData } from "../lib/sample";

export const authRoutes = new Hono<AppEnv>();

authRoutes.get("/setup/status", async (c) => {
  const company = await loadCompany(c.env.DB);
  // セットアップ前は、指定された管理者の Google アカウントでログイン済みならそのメールアドレスを返す
  const session = company ? null : await googleSession(c);
  const admin = setupAdminEmail(c.env);
  return c.json({
    needsSetup: !company,
    appName: company?.app_name ?? "ミナモ",
    companyName: company?.name ?? null,
    authConfigured: authConfigured(c.env),
    setupAdminConfigured: !!admin,
    setupEmail: session && session.user.email.toLowerCase() === admin ? session.user.email : null,
  });
});

/** 初期セットアップ: 会社と最初の管理者を作成。管理者は SETUP_ADMIN_EMAIL の Google アカウントでログインしている本人 */
authRoutes.post("/setup", async (c) => {
  if (await loadCompany(c.env.DB)) throw conflict("セットアップは完了しています");
  const session = await googleSession(c);
  if (!session) throw new HttpError(401, "Google アカウントでログインしてください");
  const email = session.user.email.toLowerCase();
  // ログインのときにも確かめているが、SETUP_ADMIN_EMAIL を後から変えた場合に古いセッションで登録できないよう、ここでも確かめる
  const denial = await signInDenial(c.env, email, !!session.user.emailVerified);
  if (denial) throw forbidden(denial.message);
  const b = await c.req.json<any>();
  const companyName = String(b.companyName ?? "").trim();
  const lastName = String(b.lastName ?? "").trim();
  const firstName = String(b.firstName ?? "").trim();
  if (!companyName || !lastName || !firstName) throw badRequest("会社名と氏名を入力してください");

  const db = c.env.DB;
  const today = todayLocal(tzOffset(c.env));
  const hireDate = b.hireDate || today;
  // 会社から最初の管理者までを1つのトランザクションで作る。途中で失敗して「会社はあるが管理者がいない」状態にしない。
  // 同時に2回送られても、company の id = 1 が重なるので後のほうは丸ごと失敗する
  const adminEmployee = "(SELECT id FROM employees WHERE code = '0001')";
  try {
    await db.batch([
      db.prepare("INSERT INTO company (id, name) VALUES (1, ?)").bind(companyName),
      ...masterDataStatements(db),
      db.prepare("INSERT INTO departments (name, code, sort_order) VALUES ('人事総務部', 'HR', 0)"),
      db
        .prepare(
          `INSERT INTO employees (code, last_name, first_name, email, hire_date, department_id, position_id, work_pattern_id)
           VALUES ('0001', ?, ?, ?, ?,
                   (SELECT id FROM departments WHERE code = 'HR'),
                   (SELECT id FROM positions WHERE name = '部長'),
                   (SELECT id FROM work_patterns WHERE is_default = 1))`,
        )
        .bind(lastName, firstName, email, hireDate),
      db.prepare(`UPDATE departments SET head_employee_id = ${adminEmployee} WHERE code = 'HR'`),
      db
        .prepare(`INSERT INTO personnel_events (employee_id, event_date, event_type, description) VALUES (${adminEmployee}, ?, 'hire', '入社')`)
        .bind(hireDate),
      db.prepare(`INSERT INTO users (employee_id, email, role, last_login_at) VALUES (${adminEmployee}, ?, 'admin', datetime('now'))`).bind(email),
    ]);
  } catch (err) {
    if (await loadCompany(db)) throw conflict("セットアップは完了しています");
    throw err;
  }
  const empId = (await first<{ id: number }>(db, "SELECT id FROM employees WHERE code = '0001'"))!.id;
  if (b.withSampleData) await seedSampleData(db, empId, today);
  await autoGrantLeave(db, today);
  return c.json({ ok: true });
});

/** ログイン中の従業員と会社の情報 (ログイン・ログアウトは Better Auth の /api/auth/* が扱う) */
authRoutes.get("/session", async (c) => {
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
