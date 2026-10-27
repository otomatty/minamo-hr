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

/** 最初の管理者として指定された Google アカウントのメールアドレス (未設定なら null) */
export function setupAdminEmail(env: Env): string | null {
  return env.SETUP_ADMIN_EMAIL?.trim().toLowerCase() || null;
}

/** ログインを断る理由 (ログインできるなら null)。code は画面に戻すときの ?error= の値 */
export async function signInDenial(
  env: Env,
  email: string,
  emailVerified: boolean,
): Promise<{ code: string; message: string } | null> {
  const db = env.DB;
  if (!emailVerified) return { code: "email_not_verified", message: "Google アカウントのメールアドレスが確認されていません" };
  // 初期セットアップ前は、SETUP_ADMIN_EMAIL で指定された人だけがログインできる。
  // 指定がないと、先に URL にたどり着いた人がだれでも管理者になれてしまう
  if (!(await loadCompany(db))) {
    const admin = setupAdminEmail(env);
    if (!admin) return { code: "setup_admin_not_configured", message: "最初の管理者のメールアドレス (SETUP_ADMIN_EMAIL) が設定されていません" };
    if (email.toLowerCase() !== admin) return { code: "not_setup_admin", message: "この Google アカウントは最初の管理者として指定されていません" };
    return null;
  }
  const row = await first<{ is_active: number; status: string }>(
    db,
    "SELECT u.is_active, e.status FROM users u JOIN employees e ON e.id = u.employee_id WHERE u.email = ?",
    email.toLowerCase(),
  );
  if (!row) return { code: "account_not_registered", message: "この Google アカウントは登録されていません" };
  if (!row.is_active || row.status === "retired") return { code: "account_disabled", message: "このアカウントは利用できません" };
  return null;
}

async function assertCanSignIn(env: Env, email: string, emailVerified: boolean): Promise<void> {
  const denial = await signInDenial(env, email, emailVerified);
  if (denial) throw new APIError("FORBIDDEN", denial);
}

const NO_TOKENS = { accessToken: null, refreshToken: null, idToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null };

export function createAuth(env: Env, origin: string) {
  return betterAuth({
    appName: "ミナモ HR",
    baseURL: origin,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    user: { modelName: "auth_user" },
    session: { modelName: "auth_session" },
    account: {
      modelName: "auth_account",
      // 同じメールアドレスでも、最初にログインした Google アカウント (sub) と別のアカウントは紐付けない。
      // メールアドレスが別の人に割り当て直されたときに、その人が元の従業員としてログインできないようにする
      accountLinking: { disableImplicitLinking: true },
    },
    verification: { modelName: "auth_verification" },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        // Google Workspace のドメインを指定すると、そのドメインのアカウントだけに限る
        hd: env.GOOGLE_HOSTED_DOMAIN || undefined,
        prompt: "select_account",
        // ログインはリダイレクトだけで行う。クライアントから送られた ID トークンでのログインは受け付けない
        disableIdTokenSignIn: true,
        // Google 側でメールアドレスが変わったら auth_user も合わせる (ログインの可否は最新のメールアドレスで判定する)
        overrideUserInfoOnSignIn: true,
        // メールアドレスの確認は、ログインのたびに今回の Google の回答で判定する。
        // 既存ユーザーの emailVerified は「保存済み || 今回」で更新されるため、DB のフックでは見分けられない
        mapProfileToUser: (profile) => {
          if (!profile.email_verified) {
            throw new APIError("FOUND", undefined, new Headers({ location: `${origin}/?error=email_not_verified` }));
          }
          return {};
        },
      },
    },
    // ログインできなかったときはトップに戻し、画面で ?error= の内容を表示する
    onAPIError: { errorURL: `${origin}/` },
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    databaseHooks: {
      // Google のトークンはログインの確認にしか使わないので保存しない
      account: {
        create: { before: async (account) => ({ data: { ...account, ...NO_TOKENS } }) },
        update: { before: async (account) => ({ data: { ...account, ...NO_TOKENS } }) },
      },
      user: {
        create: {
          // 登録されていない Google アカウントは Better Auth のユーザーも作らない
          before: async (user) => {
            await assertCanSignIn(env, user.email, user.emailVerified);
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
            await assertCanSignIn(env, u?.email ?? "", !!u?.emailVerified);
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

/**
 * ログインに使うメールアドレスを変える。古いアドレスの Better Auth のユーザーも消し、セッションと Google アカウントとの紐付けを外す。
 * セッションはメールアドレスで従業員に結びつくため、残すと古いアドレスでログインしていた人が、
 * そのアドレスを後から登録された別の従業員として操作できてしまう。
 * 新しいアドレスが別のアカウントで使われているときは何も変えずに失敗する
 */
export async function changeLoginEmail(db: D1Database, employeeId: number, email: string): Promise<void> {
  const current = await first<{ email: string }>(db, "SELECT email FROM users WHERE employee_id = ?", employeeId);
  if (!current || current.email === email) return;
  await db.batch([
    db.prepare("UPDATE users SET email = ? WHERE employee_id = ?").bind(email, employeeId),
    db.prepare("DELETE FROM auth_user WHERE email = ?").bind(current.email),
  ]);
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
