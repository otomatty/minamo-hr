import { Hono } from "hono";
import { all, buildUpdate, first, insert, run } from "../lib/db";
import { badRequest, conflict, forbidden, notFound, tzOffset, type AppEnv } from "../lib/context";
import { changeLoginEmail, requireRole } from "../lib/auth";
import { audit, canViewEmployee, subordinateIds } from "../domain/common";
import { autoGrantLeave, leaveBalance } from "../domain/leave";
import { todayLocal } from "../../shared/dates";
import { toCsv } from "../lib/csv";

export const employeeRoutes = new Hono<AppEnv>();

const EMPLOYEE_FIELDS = [
  "code", "last_name", "first_name", "last_name_kana", "first_name_kana", "email", "phone", "birth_date", "gender",
  "hire_date", "status", "employment_type", "department_id", "position_id", "manager_id", "work_pattern_id",
  "weekly_work_days", "weekly_work_hours", "postal_code", "address", "emergency_name", "emergency_relation",
  "emergency_phone", "bank_name", "bank_branch", "bank_account_type", "bank_account_number", "bank_account_holder", "note",
];
// 従業員本人が変更できる項目
const SELF_FIELDS = [
  "last_name_kana", "first_name_kana", "phone", "postal_code", "address", "emergency_name", "emergency_relation",
  "emergency_phone", "bank_name", "bank_branch", "bank_account_type", "bank_account_number", "bank_account_holder",
];

const LIST_SQL = `
  SELECT e.id, e.code, e.last_name, e.first_name, e.last_name_kana, e.first_name_kana, e.email, e.phone, e.hire_date, e.leave_date,
         e.status, e.employment_type, e.department_id, e.position_id, e.manager_id, e.birth_date, e.gender,
         d.name AS department_name, p.name AS position_name, m.last_name || ' ' || m.first_name AS manager_name,
         u.role, u.id AS user_id
    FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN positions p ON p.id = e.position_id
    LEFT JOIN employees m ON m.id = e.manager_id
    LEFT JOIN users u ON u.employee_id = e.id`;

employeeRoutes.get("/employees", async (c) => {
  const user = c.get("user");
  const q = c.req.query("q")?.trim();
  const status = c.req.query("status") ?? "current";
  const dept = c.req.query("department");
  const where: string[] = [];
  const params: unknown[] = [];
  if (status === "current") where.push("e.status != 'retired'");
  else if (status !== "all") {
    where.push("e.status = ?");
    params.push(status);
  }
  if (dept) {
    where.push("e.department_id = ?");
    params.push(Number(dept));
  }
  if (q) {
    where.push("(e.last_name || e.first_name LIKE ? OR e.last_name_kana || e.first_name_kana LIKE ? OR e.code LIKE ? OR e.email LIKE ?)");
    const like = `%${q.replace(/\s/g, "")}%`;
    params.push(like, like, like, `%${q}%`);
  }
  const rows = await all<any>(c.env.DB, `${LIST_SQL} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY e.code`, ...params);
  if (user.role === "admin") return c.json(rows);
  // 一般従業員・マネージャーには社員名簿として公開情報だけ返す
  return c.json(
    rows.map(({ birth_date, gender, role, user_id, ...r }) => ({ ...r, phone: user.role === "manager" ? r.phone : null })),
  );
});

employeeRoutes.get("/employees/export.csv", requireRole("admin"), async (c) => {
  const rows = await all<any>(c.env.DB, `${LIST_SQL} ORDER BY e.code`);
  const csv = toCsv(
    ["社員番号", "氏名", "フリガナ", "メール", "部署", "役職", "雇用形態", "入社日", "退職日", "在籍状況"],
    rows.map((r) => [r.code, `${r.last_name} ${r.first_name}`, `${r.last_name_kana} ${r.first_name_kana}`, r.email, r.department_name, r.position_name, EMPLOYMENT_JA[r.employment_type] ?? r.employment_type, r.hire_date, r.leave_date, STATUS_JA[r.status] ?? r.status]),
  );
  return csvResponse(csv, "employees.csv");
});

export const EMPLOYMENT_JA: Record<string, string> = { full_time: "正社員", contract: "契約社員", part_time: "パート・アルバイト", temporary: "派遣", executive: "役員" };
export const STATUS_JA: Record<string, string> = { pre_hire: "入社予定", active: "在籍", leave_of_absence: "休職中", retired: "退職" };

export function csvResponse(csv: string, filename: string) {
  return new Response("﻿" + csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` },
  });
}

employeeRoutes.get("/employees/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const full = await canViewEmployee(c.env.DB, user, id);
  const emp = await first<any>(c.env.DB, `${LIST_SQL} WHERE e.id = ?`, id);
  if (!emp) throw notFound();
  const detail = await first<any>(c.env.DB, "SELECT * FROM employees WHERE id = ?", id);
  const base = { ...detail, ...emp };
  if (!full) {
    // 社員名簿として公開する項目だけ返す
    const PUBLIC = ["id", "code", "last_name", "first_name", "last_name_kana", "first_name_kana", "email", "phone", "hire_date", "status",
      "employment_type", "department_id", "position_id", "department_name", "position_name", "manager_name"];
    return c.json({ employee: Object.fromEntries(PUBLIC.map((k) => [k, base[k]])), limited: true });
  }
  if (user.role !== "admin" && user.employeeId !== id) {
    for (const k of ["bank_name", "bank_branch", "bank_account_type", "bank_account_number", "bank_account_holder", "note"]) delete base[k];
  }
  const [dependents, events, files, account] = await Promise.all([
    all(c.env.DB, "SELECT * FROM dependents WHERE employee_id = ? ORDER BY is_spouse DESC, birth_date", id),
    all(c.env.DB, "SELECT * FROM personnel_events WHERE employee_id = ? ORDER BY event_date DESC, id DESC", id),
    all(c.env.DB, "SELECT id, category, name, content_type, size, created_at FROM employee_files WHERE employee_id = ? ORDER BY id DESC", id),
    first<any>(c.env.DB, "SELECT id, email, role, is_active, last_login_at FROM users WHERE employee_id = ?", id),
  ]);
  const leave = await leaveBalance(c.env.DB, id, todayLocal(tzOffset(c.env)));
  return c.json({ employee: base, dependents, events, files, account, leave, limited: false });
});

function cleanEmployee(b: any) {
  for (const k of ["department_id", "position_id", "manager_id", "work_pattern_id"]) {
    if (k in b) b[k] = b[k] === "" || b[k] === null ? null : Number(b[k]);
  }
  for (const k of ["weekly_work_days", "weekly_work_hours"]) if (k in b && b[k] !== "") b[k] = Number(b[k]);
  return b;
}

employeeRoutes.post("/employees", requireRole("admin"), async (c) => {
  const user = c.get("user");
  const b = cleanEmployee(await c.req.json<any>());
  if (!b.code?.trim() || !b.last_name?.trim() || !b.first_name?.trim() || !b.hire_date) throw badRequest("社員番号・氏名・入社日は必須です");
  if (await first(c.env.DB, "SELECT id FROM employees WHERE code = ?", b.code.trim())) throw conflict("この社員番号はすでに使われています");
  const today = todayLocal(tzOffset(c.env));
  if (!b.status) b.status = b.hire_date > today ? "pre_hire" : "active";
  if (!b.work_pattern_id) b.work_pattern_id = (await first<any>(c.env.DB, "SELECT id FROM work_patterns WHERE is_default = 1"))?.id ?? null;
  const keys = EMPLOYEE_FIELDS.filter((k) => b[k] !== undefined && b[k] !== "");
  const id = await insert(
    c.env.DB,
    `INSERT INTO employees (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
    ...keys.map((k) => b[k]),
  );
  await run(c.env.DB, "INSERT INTO personnel_events (employee_id, event_date, event_type, description, created_by) VALUES (?, ?, 'hire', '入社', ?)", id, b.hire_date, user.employeeId);
  await autoGrantLeave(c.env.DB, today, id); // 既に付与日を過ぎている有休をすぐに付与
  await audit(c.env.DB, user, "employee.create", "employee", id, { code: b.code });
  return c.json({ id });
});

employeeRoutes.put("/employees/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const b = cleanEmployee(await c.req.json<any>());
  const allowed = user.role === "admin" ? EMPLOYEE_FIELDS : user.employeeId === id ? SELF_FIELDS : null;
  if (!allowed) throw forbidden();
  const before = await first<any>(c.env.DB, "SELECT * FROM employees WHERE id = ?", id);
  if (!before) throw notFound();
  if (b.code && b.code !== before.code && (await first(c.env.DB, "SELECT id FROM employees WHERE code = ? AND id != ?", b.code, id))) {
    throw conflict("この社員番号はすでに使われています");
  }
  if (b.manager_id === id) throw badRequest("自分自身を上長に設定することはできません");
  const upd = buildUpdate("employees", allowed, b, "id = ?");
  if (upd) await run(c.env.DB, upd.sql + "", ...upd.values, id);
  await run(c.env.DB, "UPDATE employees SET updated_at = datetime('now') WHERE id = ?", id);
  // 部署・役職の変更は人事履歴に残す
  if (user.role === "admin") {
    const after = await first<any>(c.env.DB, "SELECT e.*, d.name AS dn, p.name AS pn FROM employees e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN positions p ON p.id = e.position_id WHERE e.id = ?", id);
    const today = todayLocal(tzOffset(c.env));
    if (before.department_id !== after.department_id) {
      await run(c.env.DB, "INSERT INTO personnel_events (employee_id, event_date, event_type, description, created_by) VALUES (?, ?, 'transfer', ?, ?)", id, b.event_date || today, `${after.dn ?? "未所属"} へ異動`, user.employeeId);
    }
    if (before.position_id !== after.position_id) {
      await run(c.env.DB, "INSERT INTO personnel_events (employee_id, event_date, event_type, description, created_by) VALUES (?, ?, 'promotion', ?, ?)", id, b.event_date || today, `役職変更: ${after.pn ?? "なし"}`, user.employeeId);
    }
    if (before.email !== after.email && after.email) {
      await changeLoginEmail(c.env.DB, id, after.email.toLowerCase()).catch(() => undefined);
    }
  }
  if (user.role === "admin" && ["hire_date", "weekly_work_days", "weekly_work_hours", "status"].some((k) => k in b)) {
    await autoGrantLeave(c.env.DB, todayLocal(tzOffset(c.env)), id);
  }
  await audit(c.env.DB, user, "employee.update", "employee", id, Object.keys(b));
  return c.json({ ok: true });
});

employeeRoutes.post("/employees/:id/retire", requireRole("admin"), async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const b = await c.req.json<any>();
  if (!b.leave_date) throw badRequest("退職日を入力してください");
  const today = todayLocal(tzOffset(c.env));
  const status = b.leave_date < today ? "retired" : undefined;
  await run(c.env.DB, "UPDATE employees SET leave_date = ?, leave_reason = ?, status = COALESCE(?, status), updated_at = datetime('now') WHERE id = ?", b.leave_date, b.reason ?? null, status ?? null, id);
  await run(c.env.DB, "DELETE FROM personnel_events WHERE employee_id = ? AND event_type = 'retire'", id);
  await run(c.env.DB, "INSERT INTO personnel_events (employee_id, event_date, event_type, description, created_by) VALUES (?, ?, 'retire', ?, ?)", id, b.leave_date, `退職${b.reason ? ` (${b.reason})` : ""}`, user.employeeId);
  await audit(c.env.DB, user, "employee.retire", "employee", id, b);
  return c.json({ ok: true });
});

employeeRoutes.post("/employees/:id/cancel-retire", requireRole("admin"), async (c) => {
  const id = Number(c.req.param("id"));
  await run(c.env.DB, "UPDATE employees SET leave_date = NULL, leave_reason = NULL, status = 'active' WHERE id = ?", id);
  await run(c.env.DB, "DELETE FROM personnel_events WHERE employee_id = ? AND event_type = 'retire'", id);
  return c.json({ ok: true });
});

employeeRoutes.post("/employees/:id/events", requireRole("admin"), async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json<any>();
  if (!b.event_date || !b.event_type) throw badRequest("日付と種類を入力してください");
  await insert(c.env.DB, "INSERT INTO personnel_events (employee_id, event_date, event_type, description, created_by) VALUES (?, ?, ?, ?, ?)", id, b.event_date, b.event_type, b.description ?? "", c.get("user").employeeId);
  if (b.event_type === "leave_of_absence") await run(c.env.DB, "UPDATE employees SET status = 'leave_of_absence' WHERE id = ?", id);
  if (b.event_type === "return") await run(c.env.DB, "UPDATE employees SET status = 'active' WHERE id = ?", id);
  return c.json({ ok: true });
});

employeeRoutes.delete("/events/:id", requireRole("admin"), async (c) => {
  await run(c.env.DB, "DELETE FROM personnel_events WHERE id = ?", Number(c.req.param("id")));
  return c.json({ ok: true });
});

// ── 扶養家族
async function assertDependentAccess(c: any, employeeId: number) {
  const user = c.get("user");
  if (user.role !== "admin" && user.employeeId !== employeeId) throw forbidden();
}

const DEP_FIELDS = ["name", "name_kana", "relationship", "birth_date", "annual_income", "is_spouse", "withholding_target", "health_dependent", "disability"];

employeeRoutes.post("/employees/:id/dependents", async (c) => {
  const id = Number(c.req.param("id"));
  await assertDependentAccess(c, id);
  const b = await c.req.json<any>();
  if (!b.name?.trim() || !b.relationship?.trim()) throw badRequest("氏名と続柄を入力してください");
  const keys = DEP_FIELDS.filter((k) => k in b);
  await insert(
    c.env.DB,
    `INSERT INTO dependents (employee_id, ${keys.join(", ")}) VALUES (?, ${keys.map(() => "?").join(", ")})`,
    id,
    ...keys.map((k) => (typeof b[k] === "boolean" ? (b[k] ? 1 : 0) : b[k] === "" ? null : b[k])),
  );
  return c.json({ ok: true });
});

employeeRoutes.put("/dependents/:id", async (c) => {
  const dep = await first<any>(c.env.DB, "SELECT * FROM dependents WHERE id = ?", Number(c.req.param("id")));
  if (!dep) throw notFound();
  await assertDependentAccess(c, dep.employee_id);
  const upd = buildUpdate("dependents", DEP_FIELDS, await c.req.json<any>(), "id = ?");
  if (upd) await run(c.env.DB, upd.sql, ...upd.values, dep.id);
  return c.json({ ok: true });
});

employeeRoutes.delete("/dependents/:id", async (c) => {
  const dep = await first<any>(c.env.DB, "SELECT * FROM dependents WHERE id = ?", Number(c.req.param("id")));
  if (!dep) throw notFound();
  await assertDependentAccess(c, dep.employee_id);
  await run(c.env.DB, "DELETE FROM dependents WHERE id = ?", dep.id);
  return c.json({ ok: true });
});

// ── 書類 (R2)
employeeRoutes.post("/employees/:id/files", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  if (user.role !== "admin" && user.employeeId !== id) throw forbidden();
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("ファイルを選択してください");
  if (file.size > 10 * 1024 * 1024) throw badRequest("ファイルサイズは10MBまでです");
  const key = `employees/${id}/${crypto.randomUUID()}`;
  await c.env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" } });
  await insert(
    c.env.DB,
    "INSERT INTO employee_files (employee_id, category, name, r2_key, content_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id,
    String(form.get("category") ?? "other"),
    file.name,
    key,
    file.type,
    file.size,
    user.employeeId,
  );
  return c.json({ ok: true });
});

employeeRoutes.get("/employee-files/:id", async (c) => {
  const user = c.get("user");
  const f = await first<any>(c.env.DB, "SELECT * FROM employee_files WHERE id = ?", Number(c.req.param("id")));
  if (!f) throw notFound();
  if (user.role !== "admin" && user.employeeId !== f.employee_id) throw forbidden();
  const obj = await c.env.FILES.get(f.r2_key);
  if (!obj) throw notFound("ファイルが見つかりません");
  // 画像と PDF だけブラウザで表示し、それ以外 (HTML・SVG など) はダウンロードさせる
  const inline = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(f.content_type ?? "");
  return new Response(obj.body, {
    headers: {
      "Content-Type": inline ? f.content_type : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "X-Content-Type-Options": "nosniff",
      ...(inline ? {} : { "Content-Security-Policy": "sandbox; default-src 'none'" }),
      "Cache-Control": "private, no-store",
    },
  });
});

employeeRoutes.delete("/employee-files/:id", requireRole("admin"), async (c) => {
  const f = await first<any>(c.env.DB, "SELECT * FROM employee_files WHERE id = ?", Number(c.req.param("id")));
  if (!f) throw notFound();
  await c.env.FILES.delete(f.r2_key);
  await run(c.env.DB, "DELETE FROM employee_files WHERE id = ?", f.id);
  return c.json({ ok: true });
});

// ── ログインアカウント
employeeRoutes.post("/employees/:id/account", requireRole("admin"), async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json<any>();
  const emp = await first<any>(c.env.DB, "SELECT * FROM employees WHERE id = ?", id);
  if (!emp) throw notFound();
  const email = String(b.email ?? emp.email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest("メールアドレスを正しく入力してください");
  const role = ["admin", "manager", "employee"].includes(b.role) ? b.role : "employee";
  const existing = await first<any>(c.env.DB, "SELECT * FROM users WHERE employee_id = ?", id);
  const dup = await first<any>(c.env.DB, "SELECT id FROM users WHERE email = ? AND employee_id != ?", email, id);
  if (dup) throw conflict("このメールアドレスは別のアカウントで使われています");
  if (existing) {
    if (existing.role === "admin" && role !== "admin") {
      const admins = await first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1");
      if ((admins?.n ?? 0) <= 1) throw conflict("管理者が1人もいなくなるため変更できません");
    }
    await changeLoginEmail(c.env.DB, id, email);
    await run(c.env.DB, "UPDATE users SET role = ?, is_active = ? WHERE id = ?", role, b.is_active === false ? 0 : 1, existing.id);
    await audit(c.env.DB, c.get("user"), "account.update", "employee", id, { role });
    return c.json({ ok: true });
  }
  await insert(c.env.DB, "INSERT INTO users (employee_id, email, role) VALUES (?, ?, ?)", id, email, role);
  if (!emp.email) await run(c.env.DB, "UPDATE employees SET email = ? WHERE id = ?", email, id);
  await audit(c.env.DB, c.get("user"), "account.create", "employee", id, { role });
  return c.json({ ok: true });
});

// ── 組織
employeeRoutes.get("/org/chart", async (c) => {
  const [departments, employees] = await Promise.all([
    all<any>(c.env.DB, "SELECT d.*, e.last_name || ' ' || e.first_name AS head_name FROM departments d LEFT JOIN employees e ON e.id = d.head_employee_id ORDER BY d.sort_order, d.id"),
    all<any>(
      c.env.DB,
      `SELECT e.id, e.code, e.last_name, e.first_name, e.department_id, e.employment_type, p.name AS position_name, p.rank
         FROM employees e LEFT JOIN positions p ON p.id = e.position_id WHERE e.status != 'retired' ORDER BY p.rank DESC, e.code`,
    ),
  ]);
  return c.json({ departments, employees });
});

employeeRoutes.get("/departments", async (c) => c.json(await all(c.env.DB, "SELECT d.*, (SELECT COUNT(*) FROM employees e WHERE e.department_id = d.id AND e.status != 'retired') AS member_count FROM departments d ORDER BY sort_order, id")));

employeeRoutes.post("/departments", requireRole("admin"), async (c) => {
  const b = await c.req.json<any>();
  if (!b.name?.trim()) throw badRequest("部署名を入力してください");
  const id = await insert(c.env.DB, "INSERT INTO departments (name, code, parent_id, head_employee_id, sort_order) VALUES (?, ?, ?, ?, ?)", b.name.trim(), b.code || null, b.parent_id || null, b.head_employee_id || null, Number(b.sort_order ?? 0));
  return c.json({ id });
});

employeeRoutes.put("/departments/:id", requireRole("admin"), async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json<any>();
  if (b.parent_id && Number(b.parent_id) === id) throw badRequest("自分自身を親部署にはできません");
  // 循環チェック
  if (b.parent_id) {
    const depts = await all<any>(c.env.DB, "SELECT id, parent_id FROM departments");
    let p = Number(b.parent_id);
    for (let i = 0; p && i < 50; i++) {
      if (p === id) throw badRequest("親部署の設定が循環しています");
      p = depts.find((d) => d.id === p)?.parent_id;
    }
  }
  const upd = buildUpdate("departments", ["name", "code", "parent_id", "head_employee_id", "sort_order"], b, "id = ?");
  if (upd) await run(c.env.DB, upd.sql, ...upd.values, id);
  return c.json({ ok: true });
});

employeeRoutes.delete("/departments/:id", requireRole("admin"), async (c) => {
  const id = Number(c.req.param("id"));
  const n = await first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM employees WHERE department_id = ? AND status != 'retired'", id);
  if (n?.n) throw conflict("所属している従業員がいるため削除できません");
  await run(c.env.DB, "DELETE FROM departments WHERE id = ?", id);
  return c.json({ ok: true });
});

employeeRoutes.get("/positions", async (c) => c.json(await all(c.env.DB, "SELECT * FROM positions ORDER BY rank DESC, id")));
employeeRoutes.post("/positions", requireRole("admin"), async (c) => {
  const b = await c.req.json<any>();
  if (!b.name?.trim()) throw badRequest("役職名を入力してください");
  return c.json({ id: await insert(c.env.DB, "INSERT INTO positions (name, rank) VALUES (?, ?)", b.name.trim(), Number(b.rank ?? 0)) });
});
employeeRoutes.put("/positions/:id", requireRole("admin"), async (c) => {
  const upd = buildUpdate("positions", ["name", "rank"], await c.req.json<any>(), "id = ?");
  if (upd) await run(c.env.DB, upd.sql, ...upd.values, Number(c.req.param("id")));
  return c.json({ ok: true });
});
employeeRoutes.delete("/positions/:id", requireRole("admin"), async (c) => {
  await run(c.env.DB, "DELETE FROM positions WHERE id = ?", Number(c.req.param("id")));
  return c.json({ ok: true });
});

// マネージャー向け: 自分の部下一覧
employeeRoutes.get("/team", async (c) => {
  const user = c.get("user");
  const ids = user.role === "admin"
    ? (await all<{ id: number }>(c.env.DB, "SELECT id FROM employees WHERE status != 'retired'")).map((r) => r.id)
    : await subordinateIds(c.env.DB, user.employeeId);
  return c.json(ids);
});
