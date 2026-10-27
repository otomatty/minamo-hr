// 認証: PBKDF2 によるパスワードハッシュ、KV に保存するセッション
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";
import { first } from "./db";
import { forbidden, HttpError, type AppEnv, type Role, type SessionUser } from "./context";

const ITERATIONS = 100000; // Workers の PBKDF2 の上限
const SESSION_TTL = 60 * 60 * 24 * 7;
const COOKIE = "minamo_sid";

const enc = new TextEncoder();

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, saltB64, hashB64] = stored.split("$");
  if (scheme !== "pbkdf2") return false;
  const hash = new Uint8Array(await derive(password, unb64(saltB64), Number(iter)));
  const expected = unb64(hashB64);
  if (hash.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash[i] ^ expected[i];
  return diff === 0;
}

export function validatePassword(pw: string): string | null {
  if (pw.length < 8) return "パスワードは8文字以上にしてください";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "パスワードには英字と数字を含めてください";
  return null;
}

export function randomPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let s = "";
  for (const b of bytes) s += chars[b % chars.length];
  return s.slice(0, 10) + "a1";
}

function randomToken(): string {
  return b64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createSession(c: Parameters<MiddlewareHandler<AppEnv>>[0], userId: number): Promise<void> {
  const token = randomToken();
  await c.env.SESSIONS.put(`s:${token}`, JSON.stringify({ userId, createdAt: Date.now() }), { expirationTtl: SESSION_TTL });
  const secure = new URL(c.req.url).protocol === "https:";
  setCookie(c, COOKIE, token, { httpOnly: true, secure, sameSite: "Lax", path: "/", maxAge: SESSION_TTL });
}

export async function destroySession(c: Parameters<MiddlewareHandler<AppEnv>>[0]): Promise<void> {
  const token = getCookie(c, COOKIE);
  if (token) await c.env.SESSIONS.delete(`s:${token}`);
  deleteCookie(c, COOKIE, { path: "/" });
}

export async function loadSessionUser(db: D1Database, userId: number): Promise<SessionUser | null> {
  const row = await first<any>(
    db,
    `SELECT u.id AS user_id, u.employee_id, u.role, u.email, u.is_active, u.must_change_password,
            e.last_name, e.first_name, e.status
       FROM users u JOIN employees e ON e.id = u.employee_id WHERE u.id = ?`,
    userId,
  );
  if (!row || !row.is_active || row.status === "retired") return null;
  return {
    userId: row.user_id,
    employeeId: row.employee_id,
    role: row.role as Role,
    email: row.email,
    name: `${row.last_name} ${row.first_name}`,
    mustChangePassword: !!row.must_change_password,
  };
}

/** ログインしていればユーザーを返す (未ログインでもエラーにしない) */
export async function optionalUser(c: Parameters<MiddlewareHandler<AppEnv>>[0]): Promise<SessionUser | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const raw = await c.env.SESSIONS.get(`s:${token}`);
  if (!raw) return null;
  return loadSessionUser(c.env.DB, (JSON.parse(raw) as { userId: number }).userId);
}

/** ログイン必須 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, COOKIE);
  if (!token) throw new HttpError(401, "ログインしてください");
  const raw = await c.env.SESSIONS.get(`s:${token}`);
  if (!raw) throw new HttpError(401, "セッションの有効期限が切れました。再度ログインしてください");
  const { userId } = JSON.parse(raw) as { userId: number };
  const user = await loadSessionUser(c.env.DB, userId);
  if (!user) {
    await c.env.SESSIONS.delete(`s:${token}`);
    throw new HttpError(401, "アカウントが無効です");
  }
  c.set("user", user);
  c.set("sessionId", token);
  await next();
};

export function requireRole(...roles: Role[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!roles.includes(c.get("user").role)) throw forbidden();
    await next();
  };
}

/** ログイン試行回数の制限 (メールアドレスごとに15分で10回まで) */
export async function checkLoginRate(kv: KVNamespace, email: string): Promise<void> {
  const key = `login:${email.toLowerCase()}`;
  const n = Number((await kv.get(key)) ?? 0);
  if (n >= 10) throw new HttpError(429, "ログイン試行回数が上限に達しました。15分後に再度お試しください");
  await kv.put(key, String(n + 1), { expirationTtl: 900 });
}

export async function clearLoginRate(kv: KVNamespace, email: string): Promise<void> {
  await kv.delete(`login:${email.toLowerCase()}`);
}
