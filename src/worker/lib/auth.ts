// 認証: Google アカウントでのログイン (Better Auth)。セッションは D1 に保存する
// ログインできるのは、users.email と同じメールアドレスの Google アカウントだけ
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import type { MiddlewareHandler } from "hono";
import { first, run } from "./db";
import { forbidden, HttpError, type AppEnv, type Ctx, type Role, type SessionUser } from "./context";
import { loadCompany } from "../domain/common";

/** Google ログインに必要なシークレットがそろっているか */
export function authConfigured(env: Env): boolean {
  return !!(env.BETTER_AUTH_SECRET && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/** ログインを断る理由 (ログインできるなら null)。code は画面に戻すときの ?error= の値 */
export async function signInDenial(
  db: D1Database,
  email: string,
  emailVerified: boolean,
): Promise<{ code: string; message: string } | null> {
  if (!emailVerified) return { code: "email_not_verified", message: "Google アカウントのメールアドレスが確認されていません" };
  // 初期セットアップ前は、最初の管理者になる人がログインできるようにする
  if (!(await loadCompany(db))) return null;
  const row = await first<{ is_active: number; status: string }>(
    db,
    "SELECT u.is_active, e.status FROM users u JOIN employees e ON e.id = u.employee_id WHERE u.email = ?",
    email.toLowerCase(),
  );
  if (!row) return { code: "account_not_registered", message: "この Google アカウントは登録されていません" };
  if (!row.is_active || row.status === "retired") return { code: "account_disabled", message: "このアカウントは利用できません" };
  return null;
}

async function assertCanSignIn(db: D1Database, email: string, emailVerified: boolean): Promise<void> {
  const denial = await signInDenial(db, email, emailVerified);
  if (denial) throw new APIError("FORBIDDEN", denial);
}

export function createAuth(env: Env, origin: string) {
  return betterAuth({
    appName: "ミナモ HR",
    baseURL: origin,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    user: { modelName: "auth_user" },
    session: { modelName: "auth_session" },
    account: { modelName: "auth_account" },
    verification: { modelName: "auth_verification" },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        // Google Workspace のドメインを指定すると、そのドメインのアカウントだけに限る
        hd: env.GOOGLE_HOSTED_DOMAIN || undefined,
        prompt: "select_account",
      },
    },
    // ログインできなかったときはトップに戻し、画面で ?error= の内容を表示する
    onAPIError: { errorURL: `${origin}/` },
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    databaseHooks: {
      user: {
        create: {
          // 登録されていない Google アカウントは Better Auth のユーザーも作らない
          before: async (user) => {
            await assertCanSignIn(env.DB, user.email, user.emailVerified);
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const u = await first<{ email: string; emailVerified: number }>(
              env.DB,
              "SELECT email, emailVerified FROM auth_user WHERE id = ?",
              session.userId,
            );
            await assertCanSignIn(env.DB, u?.email ?? "", !!u?.emailVerified);
          },
          after: async (session) => {
            await run(
              env.DB,
              "UPDATE users SET last_login_at = datetime('now') WHERE email = (SELECT email FROM auth_user WHERE id = ?)",
              session.userId,
            );
          },
        },
      },
    },
  });
}

// 初期化はリクエストごとだと重いので、同じ isolate の中では使い回す
let cached: { env: Env; origin: string; auth: ReturnType<typeof createAuth> } | undefined;

export function authFor(c: Ctx) {
  const origin = new URL(c.req.url).origin;
  if (cached?.env !== c.env || cached.origin !== origin) cached = { env: c.env, origin, auth: createAuth(c.env, origin) };
  return cached.auth;
}

/** Better Auth のセッション (Google アカウント) を返す。延長されたセッションの Cookie はレスポンスに引き継ぐ */
export async function googleSession(c: Ctx) {
  if (!authConfigured(c.env)) return null;
  const { headers, response } = await authFor(c).api.getSession({ headers: c.req.raw.headers, returnHeaders: true });
  for (const cookie of headers.getSetCookie()) c.header("Set-Cookie", cookie, { append: true });
  return response;
}

export async function loadSessionUser(db: D1Database, email: string): Promise<SessionUser | null> {
  const row = await first<any>(
    db,
    `SELECT u.id AS user_id, u.employee_id, u.role, u.email, u.is_active,
            e.last_name, e.first_name, e.status
       FROM users u JOIN employees e ON e.id = u.employee_id WHERE u.email = ?`,
    email.toLowerCase(),
  );
  if (!row || !row.is_active || row.status === "retired") return null;
  return {
    userId: row.user_id,
    employeeId: row.employee_id,
    role: row.role as Role,
    email: row.email,
    name: `${row.last_name} ${row.first_name}`,
  };
}

/** ログインしていればユーザーを返す (未ログインでもエラーにしない) */
export async function optionalUser(c: Ctx): Promise<SessionUser | null> {
  const session = await googleSession(c);
  return session ? loadSessionUser(c.env.DB, session.user.email) : null;
}

/** ログイン必須 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await optionalUser(c);
  if (!user) throw new HttpError(401, "ログインしてください");
  c.set("user", user);
  await next();
};

export function requireRole(...roles: Role[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!roles.includes(c.get("user").role)) throw forbidden();
    await next();
  };
}
