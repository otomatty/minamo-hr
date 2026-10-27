import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { secureHeaders } from "hono/secure-headers";
import { HTTPException } from "hono/http-exception";
import { HttpError, tzOffset, type AppEnv } from "./lib/context";
import { ensureMigrated } from "./lib/migrate";
import { authFor, requireAuth } from "./lib/auth";
import { authRoutes } from "./routes/auth";
import { employeeRoutes } from "./routes/employees";
import { attendanceRoutes } from "./routes/attendance";
import { requestRoutes } from "./routes/requests";
import { payrollRoutes } from "./routes/payroll";
import { settingsRoutes } from "./routes/settings";
import { autoGrantLeave } from "./domain/leave";
import { run } from "./lib/db";
import { todayLocal } from "../shared/dates";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", secureHeaders());
app.use("*", csrf());
app.use("*", async (c, next) => {
  await ensureMigrated(c.env.DB);
  await next();
});

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  if (err instanceof HTTPException) {
    return c.json({ error: err.status === 403 ? "不正なリクエストです (別のサイトからの送信は受け付けません)" : err.message }, err.status);
  }
  console.error(err);
  return c.json({ error: "サーバーでエラーが発生しました" }, 500);
});

app.get("/health", (c) => c.json({ ok: true }));

// Better Auth: Google ログイン (/api/auth/sign-in/social, /api/auth/callback/google)、ログアウトなど
app.on(["GET", "POST"], "/auth/*", (c) => authFor(c).handler(c.req.raw));

// 認証不要: セットアップ・ログイン中のユーザー
app.route("/", authRoutes);

// 以降はログイン必須
const secured = new Hono<AppEnv>();
secured.use("*", requireAuth);
secured.route("/", employeeRoutes);
secured.route("/", attendanceRoutes);
secured.route("/", requestRoutes);
secured.route("/", payrollRoutes);
secured.route("/", settingsRoutes);
app.route("/", secured);

app.notFound((c) => c.json({ error: "見つかりません" }, 404));

/** 日次バッチ: 有休の自動付与、入社予定・退職予定の在籍状況の更新 */
async function daily(env: Env) {
  await ensureMigrated(env.DB);
  const today = todayLocal(tzOffset(env));
  await run(env.DB, "UPDATE employees SET status = 'active' WHERE status = 'pre_hire' AND hire_date <= ?", today);
  await run(env.DB, "UPDATE employees SET status = 'retired' WHERE status != 'retired' AND leave_date IS NOT NULL AND leave_date < ?", today);
  const granted = await autoGrantLeave(env.DB, today);
  console.log(`daily batch ${today}: granted ${granted} leave grants`);
}

export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(daily(env));
  },
} satisfies ExportedHandler<Env>;
