// 初期セットアップとログインの可否を、ローカルの D1 (Miniflare) に対して Worker を通して確かめる
import { afterAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { handleOAuthUserInfo } from "better-auth/oauth2";
import worker from "../src/worker/index";
import { createAuth } from "../src/worker/lib/auth";

const ORIGIN = "http://localhost";
const SECRET = "x".repeat(40);
const proxy = await getPlatformProxy<any>({ persist: false });
afterAll(() => proxy.dispose());

const base = { ...proxy.env, BETTER_AUTH_SECRET: SECRET, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", APP_TIMEZONE_OFFSET_MINUTES: "540", GOOGLE_HOSTED_DOMAIN: "" };
const noAdmin = { ...base, SETUP_ADMIN_EMAIL: undefined };
const env = { ...base, SETUP_ADMIN_EMAIL: " Boss@Example.co.jp " };
const ctx = { waitUntil() {}, passThroughOnException() {} } as any;

async function call(e: any, method: string, path: string, cookie?: string, body?: unknown) {
  const headers: Record<string, string> = { Origin: ORIGIN };
  if (cookie) headers.Cookie = cookie;
  if (body) headers["Content-Type"] = "application/json";
  const res = await worker.fetch(new Request(ORIGIN + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), e, ctx);
  return { status: res.status, json: (await res.json()) as any };
}

/** Better Auth のセッション Cookie (トークン + HMAC-SHA256 の署名) */
async function sessionCookie(token: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token)));
  return `better-auth.session_token=${encodeURIComponent(`${token}.${btoa(String.fromCharCode(...sig))}`)}`;
}

/** Google でログインしたときと同じく、Better Auth のフックを通してユーザーを作る */
async function createAuthUser(e: any, email: string) {
  const auth = await createAuth(e, ORIGIN).$context;
  return auth.internalAdapter.createUser({ email, name: email, emailVerified: true }, { method: "oauth", oauth: { providerId: "google" } });
}

const count = async (sql: string) => (await env.DB.prepare(sql).first("n")) as number;

describe("初期セットアップ", () => {
  let bossCookie = "";
  let bossUserId = "";

  it("SETUP_ADMIN_EMAIL が未設定なら、だれもログインできない", async () => {
    const st = await call(noAdmin, "GET", "/api/setup/status");
    expect(st.json).toMatchObject({ needsSetup: true, setupAdminConfigured: false, setupEmail: null });
    await expect(createAuthUser(noAdmin, "boss@example.co.jp")).rejects.toMatchObject({ body: { code: "setup_admin_not_configured" } });
  });

  it("セットアップ前は、SETUP_ADMIN_EMAIL の Google アカウントだけがログインできる", async () => {
    await expect(createAuthUser(env, "someone@gmail.com")).rejects.toMatchObject({ body: { code: "not_setup_admin" } });
    // 大文字小文字と前後の空白は区別しない
    const boss = await createAuthUser(env, "boss@example.co.jp");
    bossUserId = boss.id;
    const session = await (await createAuth(env, ORIGIN).$context).internalAdapter.createSession(boss.id);
    bossCookie = await sessionCookie(session.token);
  });

  it("指定より前に作られたほかの人のセッションでは、セットアップできない", async () => {
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 86400e3).toISOString();
    await env.DB.prepare("INSERT INTO auth_user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('other', 'other', 'someone@gmail.com', 1, ?, ?)").bind(now, now).run();
    await env.DB.prepare("INSERT INTO auth_session (id, expiresAt, token, createdAt, updatedAt, userId) VALUES ('s-other', ?, 'tok-other', ?, ?, 'other')")
      .bind(expires, now, now)
      .run();
    const cookie = await sessionCookie("tok-other");
    const st = await call(env, "GET", "/api/setup/status", cookie);
    expect(st.json).toMatchObject({ needsSetup: true, setupAdminConfigured: true, setupEmail: null });
    const r = await call(env, "POST", "/api/setup", cookie, { companyName: "別の会社", lastName: "別", firstName: "人" });
    expect(r.status).toBe(403);
    expect(await count("SELECT COUNT(*) AS n FROM company")).toBe(0);
  });

  it("指定された管理者はセットアップできる。同時に2回送っても会社と管理者は1つだけ", async () => {
    const st = await call(env, "GET", "/api/setup/status", bossCookie);
    expect(st.json.setupEmail).toBe("boss@example.co.jp");
    const body = { companyName: "株式会社テスト", lastName: "山田", firstName: "太郎", withSampleData: false };
    const results = await Promise.all([call(env, "POST", "/api/setup", bossCookie, body), call(env, "POST", "/api/setup", bossCookie, body)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await call(env, "POST", "/api/setup", bossCookie, body)).status).toBe(409);

    const { results: emps } = await env.DB.prepare(
      `SELECT e.id, e.email, d.code AS dept, d.head_employee_id, p.name AS position, w.is_default, u.role
         FROM employees e
         JOIN departments d ON d.id = e.department_id
         JOIN positions p ON p.id = e.position_id
         JOIN work_patterns w ON w.id = e.work_pattern_id
         JOIN users u ON u.employee_id = e.id`,
    ).all();
    expect(emps).toHaveLength(1);
    expect(emps[0]).toMatchObject({ email: "boss@example.co.jp", dept: "HR", position: "部長", is_default: 1, role: "admin" });
    expect(emps[0].head_employee_id).toBe(emps[0].id);
    expect(await count("SELECT COUNT(*) AS n FROM company")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM personnel_events WHERE event_type = 'hire'")).toBe(1);

    const me = await call(env, "GET", "/api/session", bossCookie);
    expect(me.json.user).toMatchObject({ role: "admin", email: "boss@example.co.jp", name: "山田 太郎" });
  });

  it("セットアップ後は、登録されていない Google アカウントを断る", async () => {
    await expect(createAuthUser(env, "newcomer@gmail.com")).rejects.toMatchObject({ body: { code: "account_not_registered" } });
  });

  it("ログインに使うメールアドレスを変えると、古いアドレスのセッションは別の従業員に引き継がれない", async () => {
    const hire = { hire_date: "2026-04-01" };
    const a = (await call(env, "POST", "/api/employees", bossCookie, { code: "0101", last_name: "佐藤", first_name: "花子", ...hire })).json.id;
    expect((await call(env, "POST", `/api/employees/${a}/account`, bossCookie, { email: "shared@example.co.jp", role: "employee" })).status).toBe(200);
    const auth = await createAuth(env, ORIGIN).$context;
    const aCookie = await sessionCookie((await auth.internalAdapter.createSession((await createAuthUser(env, "shared@example.co.jp")).id)).token);
    expect((await call(env, "GET", "/api/session", aCookie)).json.user).toMatchObject({ name: "佐藤 花子" });

    // 佐藤さんのアドレスを変えてから、同じアドレスを鈴木さんに割り当てる
    expect((await call(env, "POST", `/api/employees/${a}/account`, bossCookie, { email: "sato@example.co.jp", role: "employee" })).status).toBe(200);
    const b = (await call(env, "POST", "/api/employees", bossCookie, { code: "0102", last_name: "鈴木", first_name: "一郎", ...hire })).json.id;
    expect((await call(env, "POST", `/api/employees/${b}/account`, bossCookie, { email: "shared@example.co.jp", role: "employee" })).status).toBe(200);
    expect((await call(env, "GET", "/api/session", aCookie)).json.user).toBeNull();
    expect(await count("SELECT COUNT(*) AS n FROM auth_session WHERE token NOT IN ('tok-other')")).toBe(1); // 残っているのは管理者のセッションだけ

    // 鈴木さんは、そのアドレスの Google アカウントでログインできる
    const bCookie = await sessionCookie((await auth.internalAdapter.createSession((await createAuthUser(env, "shared@example.co.jp")).id)).token);
    expect((await call(env, "GET", "/api/session", bCookie)).json.user).toMatchObject({ name: "鈴木 一郎" });

    // 従業員情報のメールアドレスを変えたときも同じ
    expect((await call(env, "PUT", `/api/employees/${b}`, bossCookie, { email: "suzuki@example.co.jp" })).status).toBe(200);
    expect(await env.DB.prepare("SELECT email FROM users WHERE employee_id = ?").bind(b).first("email")).toBe("suzuki@example.co.jp");
    expect((await call(env, "GET", "/api/session", bCookie)).json.user).toBeNull();
    expect(await count("SELECT COUNT(*) AS n FROM auth_user WHERE email = 'shared@example.co.jp'")).toBe(0);
  });

  it("同じメールアドレスでも、最初にログインしたのと別の Google アカウントは紐付けない", async () => {
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO auth_account (id, accountId, providerId, userId, createdAt, updatedAt) VALUES ('acc-boss', 'sub-boss', 'google', ?, ?, ?)")
      .bind(bossUserId, now, now)
      .run();
    const c = { context: await createAuth(env, ORIGIN).$context } as any;
    const r = await handleOAuthUserInfo(c, {
      userInfo: { id: "sub-other", email: "boss@example.co.jp", emailVerified: true, name: "別人" },
      account: { providerId: "google", accountId: "sub-other" },
      callbackURL: "/",
    } as any);
    expect(r.error).toBe("account not linked");
    expect(await count("SELECT COUNT(*) AS n FROM auth_account WHERE accountId = 'sub-other'")).toBe(0);
  });
});
