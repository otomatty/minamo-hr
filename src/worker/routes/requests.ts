import { Hono } from "hono";
import { all, first, insert, parseJson, placeholders, run } from "../lib/db";
import { badRequest, conflict, forbidden, notFound, tzOffset, type AppEnv, type Ctx } from "../lib/context";
import { requireRole } from "../lib/auth";
import { audit, canViewEmployee, loadCompany, subordinateIds } from "../domain/common";
import {
  canActOnStep,
  cancelApproved,
  decide,
  requestDetail,
  saveExpenseItems,
  submitRequest,
  validatePayload,
  withdraw,
  type ExpenseItemInput,
} from "../domain/workflow";
import { nowLocal, todayLocal } from "../../shared/dates";
import { toCsv } from "../lib/csv";
import { csvResponse } from "./employees";

export const requestRoutes = new Hono<AppEnv>();

const LIST_SQL = `
  SELECT r.id, r.kind, r.title, r.status, r.amount, r.submitted_at, r.decided_at, r.created_at, r.paid_at, r.paid_via,
         r.applicant_id, r.current_step, f.name AS form_name, e.last_name || ' ' || e.first_name AS applicant_name,
         d.name AS department_name, json_extract(r.payload, '$.settlement') AS settlement
    FROM requests r
    JOIN request_forms f ON f.id = r.form_id
    JOIN employees e ON e.id = r.applicant_id
    LEFT JOIN departments d ON d.id = e.department_id`;

requestRoutes.get("/requests", async (c) => {
  const user = c.get("user");
  const scope = c.req.query("scope") ?? "mine";
  const status = c.req.query("status");
  const kind = c.req.query("kind");
  const where: string[] = [];
  const params: unknown[] = [];
  if (scope === "mine") {
    where.push("r.applicant_id = ?");
    params.push(user.employeeId);
  } else if (scope === "approvals") {
    // 自分が承認できる承認待ちの申請
    where.push(`r.status = 'pending' AND r.applicant_id != ? AND EXISTS (
      SELECT 1 FROM request_steps s WHERE s.request_id = r.id AND s.status = 'pending'
        AND (s.approver_id = ? OR (s.approver_role IS NOT NULL AND s.approver_role = ?)))`);
    params.push(user.employeeId, user.employeeId, user.role);
  } else if (scope === "approved_by_me") {
    where.push("EXISTS (SELECT 1 FROM request_steps s WHERE s.request_id = r.id AND s.acted_by = ?)");
    params.push(user.employeeId);
  } else if (scope === "all") {
    if (user.role === "employee") throw forbidden();
    if (user.role === "manager") {
      const ids = [user.employeeId, ...(await subordinateIds(c.env.DB, user.employeeId))];
      where.push(`r.applicant_id IN (${placeholders(ids.length)})`);
      params.push(...ids);
    }
    where.push("r.status != 'draft'");
  }
  if (status) {
    where.push(`r.status IN (${placeholders(status.split(",").length)})`);
    params.push(...status.split(","));
  }
  if (kind) {
    where.push(`r.kind IN (${placeholders(kind.split(",").length)})`);
    params.push(...kind.split(","));
  }
  const rows = await all<any>(
    c.env.DB,
    `${LIST_SQL} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY COALESCE(r.submitted_at, r.created_at) DESC LIMIT 300`,
    ...params,
  );
  return c.json(rows);
});

requestRoutes.get("/requests/counts", async (c) => {
  const user = c.get("user");
  const approvals = await first<{ n: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS n FROM requests r WHERE r.status = 'pending' AND r.applicant_id != ? AND EXISTS (
       SELECT 1 FROM request_steps s WHERE s.request_id = r.id AND s.status = 'pending'
         AND (s.approver_id = ? OR (s.approver_role IS NOT NULL AND s.approver_role = ?)))`,
    user.employeeId,
    user.employeeId,
    user.role,
  );
  const mine = await all<{ status: string; n: number }>(
    c.env.DB,
    "SELECT status, COUNT(*) AS n FROM requests WHERE applicant_id = ? GROUP BY status",
    user.employeeId,
  );
  return c.json({ approvals: approvals?.n ?? 0, mine: Object.fromEntries(mine.map((m) => [m.status, m.n])) });
});

requestRoutes.get("/requests/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const req = await requestDetail(c.env.DB, id);
  if (!req) throw notFound();
  const isApprover = req.steps.some((s: any) => s.approver_id === user.employeeId || (s.approver_role && s.approver_role === user.role));
  if (!isApprover && !(await canViewEmployee(c.env.DB, user, req.applicant_id))) throw forbidden();
  const pendingStep = req.steps.find((s: any) => s.status === "pending");
  return c.json({
    ...req,
    canAct: req.status === "pending" && !!pendingStep && canActOnStep(user, pendingStep, req.applicant_id),
    canEdit: req.applicant_id === user.employeeId && ["draft", "returned"].includes(req.status),
    canWithdraw: req.applicant_id === user.employeeId && ["draft", "pending", "returned"].includes(req.status),
    canCancel: user.role === "admin" && req.status === "approved" && !req.paid_at,
  });
});

async function upsertRequest(c: Ctx, existingId: number | null) {
  const user = c.get("user");
  const b = await c.req.json<any>();
  const company = (await loadCompany(c.env.DB))!;
  const today = todayLocal(tzOffset(c.env));
  let formId = Number(b.formId);
  if (existingId) {
    const cur = await first<any>(c.env.DB, "SELECT * FROM requests WHERE id = ?", existingId);
    if (!cur) throw notFound();
    if (cur.applicant_id !== user.employeeId) throw forbidden();
    if (!["draft", "returned"].includes(cur.status)) throw conflict("この申請は編集できません");
    formId = cur.form_id;
  }
  const form = await first<any>(c.env.DB, "SELECT * FROM request_forms WHERE id = ? AND active = 1", formId);
  if (!form) throw badRequest("申請フォームが見つかりません");
  const payload = b.payload ?? {};
  const items = b.items as ExpenseItemInput[] | undefined;
  for (const it of items ?? []) {
    // 他人がアップロードした領収書を参照させない
    if (it.receipt_key && !it.receipt_key.startsWith(`receipts/${user.employeeId}/`)) throw badRequest("領収書ファイルが正しくありません");
  }
  const { title, amount } = await validatePayload(c.env.DB, form, user.employeeId, payload, items, today, company, existingId ?? undefined);
  let id = existingId;
  if (id) {
    await run(c.env.DB, "UPDATE requests SET title = ?, payload = ?, amount = ?, updated_at = datetime('now') WHERE id = ?", title, JSON.stringify(payload), amount, id);
  } else {
    id = await insert(
      c.env.DB,
      "INSERT INTO requests (form_id, kind, applicant_id, title, payload, amount) VALUES (?, ?, ?, ?, ?, ?)",
      form.id,
      form.kind,
      user.employeeId,
      title,
      JSON.stringify(payload),
      amount,
    );
  }
  if (form.kind === "expense") {
    // 領収書必須の科目チェック (提出時)
    if (b.submit) {
      const cats = new Map((await all<any>(c.env.DB, "SELECT id, name, requires_receipt FROM expense_categories")).map((x) => [x.id, x]));
      for (const [i, it] of (items ?? []).entries()) {
        const cat = cats.get(Number(it.category_id));
        if (cat?.requires_receipt && !it.receipt_key) throw badRequest(`明細${i + 1}: ${cat.name}は領収書の添付が必要です`);
      }
    }
    await saveExpenseItems(c.env.DB, id!, items ?? []);
  }
  if (b.submit) await submitRequest(c.env.DB, id!, user, nowLocal(tzOffset(c.env)));
  return c.json({ id });
}

requestRoutes.post("/requests", (c) => upsertRequest(c, null));
requestRoutes.put("/requests/:id", (c) => upsertRequest(c, Number(c.req.param("id"))));

requestRoutes.post("/requests/:id/submit", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const req = await first<any>(c.env.DB, "SELECT * FROM requests WHERE id = ?", id);
  if (!req) throw notFound();
  if (req.kind === "expense") {
    const missing = await first<any>(
      c.env.DB,
      `SELECT c.name FROM expense_items i JOIN expense_categories c ON c.id = i.category_id
        WHERE i.request_id = ? AND c.requires_receipt = 1 AND i.receipt_key IS NULL LIMIT 1`,
      id,
    );
    if (missing) throw badRequest(`${missing.name}は領収書の添付が必要です`);
  }
  await submitRequest(c.env.DB, id, user, nowLocal(tzOffset(c.env)));
  return c.json({ ok: true });
});

for (const action of ["approve", "reject", "return"] as const) {
  requestRoutes.post(`/requests/:id/${action}`, async (c) => {
    const b = await c.req.json<any>().catch(() => ({}));
    await decide(c.env.DB, Number(c.req.param("id")), c.get("user"), action, String(b.comment ?? ""), nowLocal(tzOffset(c.env)));
    return c.json({ ok: true });
  });
}

requestRoutes.post("/requests/bulk-approve", async (c) => {
  const { ids } = await c.req.json<{ ids: number[] }>();
  const errors: Array<{ id: number; message: string }> = [];
  for (const id of ids ?? []) {
    try {
      await decide(c.env.DB, Number(id), c.get("user"), "approve", "", nowLocal(tzOffset(c.env)));
    } catch (e: any) {
      errors.push({ id, message: e.message });
    }
  }
  return c.json({ ok: errors.length === 0, errors });
});

requestRoutes.post("/requests/:id/withdraw", async (c) => {
  await withdraw(c.env.DB, Number(c.req.param("id")), c.get("user"));
  return c.json({ ok: true });
});

requestRoutes.post("/requests/:id/cancel", requireRole("admin"), async (c) => {
  const b = await c.req.json<any>();
  if (!b.reason?.trim()) throw badRequest("取消理由を入力してください");
  await cancelApproved(c.env.DB, Number(c.req.param("id")), c.get("user"), b.reason);
  await audit(c.env.DB, c.get("user"), "request.cancel", "request", c.req.param("id"), { reason: b.reason });
  return c.json({ ok: true });
});

requestRoutes.delete("/requests/:id", async (c) => {
  const user = c.get("user");
  const req = await first<any>(c.env.DB, "SELECT * FROM requests WHERE id = ?", Number(c.req.param("id")));
  if (!req) throw notFound();
  if (req.applicant_id !== user.employeeId || req.status !== "draft") throw conflict("下書きだけ削除できます");
  const items = await all<any>(c.env.DB, "SELECT receipt_key FROM expense_items WHERE request_id = ? AND receipt_key IS NOT NULL", req.id);
  for (const it of items) await c.env.FILES.delete(it.receipt_key);
  await run(c.env.DB, "DELETE FROM requests WHERE id = ?", req.id);
  return c.json({ ok: true });
});

requestRoutes.post("/requests/:id/comments", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const req = await requestDetail(c.env.DB, id);
  if (!req) throw notFound();
  const isApprover = req.steps.some((s: any) => s.approver_id === user.employeeId || (s.approver_role && s.approver_role === user.role));
  if (!isApprover && !(await canViewEmployee(c.env.DB, user, req.applicant_id))) throw forbidden();
  const { body } = await c.req.json<{ body: string }>();
  if (!body?.trim()) throw badRequest("コメントを入力してください");
  await insert(c.env.DB, "INSERT INTO request_comments (request_id, employee_id, body) VALUES (?, ?, ?)", id, user.employeeId, body.trim());
  return c.json({ ok: true });
});

// ── 領収書アップロード (R2)
requestRoutes.post("/receipts", async (c) => {
  const user = c.get("user");
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("ファイルを選択してください");
  if (file.size > 10 * 1024 * 1024) throw badRequest("ファイルサイズは10MBまでです");
  if (!/^(image\/(png|jpeg|gif|webp|heic)|application\/pdf)$/.test(file.type)) throw badRequest("画像またはPDFを選択してください");
  const key = `receipts/${user.employeeId}/${crypto.randomUUID()}`;
  await c.env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { owner: String(user.employeeId) } });
  return c.json({ key, name: file.name });
});

requestRoutes.get("/receipts/*", async (c) => {
  const user = c.get("user");
  const key = c.req.path.replace(/^\/api\/receipts\//, "");
  if (!key.startsWith("receipts/")) throw notFound();
  const ownerId = Number(key.split("/")[1]);
  let allowed = ownerId === user.employeeId || user.role === "admin";
  if (!allowed) {
    // 承認者はその申請の領収書を閲覧できる
    const row = await first<any>(
      c.env.DB,
      `SELECT 1 AS ok FROM expense_items i JOIN request_steps s ON s.request_id = i.request_id
        WHERE i.receipt_key = ? AND (s.approver_id = ? OR s.approver_role = ?) LIMIT 1`,
      key,
      user.employeeId,
      user.role,
    );
    allowed = !!row || (await canViewEmployee(c.env.DB, user, ownerId));
  }
  if (!allowed) throw forbidden();
  const obj = await c.env.FILES.get(key);
  if (!obj) throw notFound();
  const type = obj.httpMetadata?.contentType ?? "";
  const inline = /^(image\/(png|jpeg|gif|webp|heic)|application\/pdf)$/.test(type);
  return new Response(obj.body, {
    headers: {
      "Content-Type": inline ? type : "application/octet-stream",
      "Content-Disposition": inline ? "inline" : "attachment",
      "X-Content-Type-Options": "nosniff",
      ...(inline ? {} : { "Content-Security-Policy": "sandbox; default-src 'none'" }),
      "Cache-Control": "private, max-age=3600",
    },
  });
});

// ── 経費 (経理)
requestRoutes.get("/expenses/payables", requireRole("admin"), async (c) => {
  const rows = await all<any>(
    c.env.DB,
    `${LIST_SQL} WHERE r.kind = 'expense' AND r.status = 'approved' ORDER BY r.paid_at IS NOT NULL, r.decided_at DESC LIMIT 300`,
  );
  return c.json(rows);
});

requestRoutes.post("/expenses/mark-paid", requireRole("admin"), async (c) => {
  const { ids, paid_on } = await c.req.json<{ ids: number[]; paid_on?: string }>();
  const date = paid_on || todayLocal(tzOffset(c.env));
  for (const id of ids ?? []) {
    await run(
      c.env.DB,
      "UPDATE requests SET paid_at = ?, paid_via = 'transfer' WHERE id = ? AND kind = 'expense' AND status = 'approved' AND paid_at IS NULL",
      date,
      Number(id),
    );
  }
  await audit(c.env.DB, c.get("user"), "expense.mark_paid", "request", (ids ?? []).join(","));
  return c.json({ ok: true });
});

/** 仕訳用 CSV (承認済みの経費明細) */
requestRoutes.get("/expenses/journal.csv", requireRole("admin"), async (c) => {
  const from = c.req.query("from") ?? "0000-01-01";
  const to = c.req.query("to") ?? "9999-12-31";
  const rows = await all<any>(
    c.env.DB,
    `SELECT i.*, c.name AS category_name, c.account_code, r.id AS request_id, r.decided_at, r.paid_at,
            e.code, e.last_name || ' ' || e.first_name AS name, d.name AS department_name
       FROM expense_items i JOIN requests r ON r.id = i.request_id JOIN employees e ON e.id = r.applicant_id
       LEFT JOIN expense_categories c ON c.id = i.category_id LEFT JOIN departments d ON d.id = e.department_id
      WHERE r.kind = 'expense' AND r.status = 'approved' AND i.used_on BETWEEN ? AND ? ORDER BY i.used_on, r.id`,
    from,
    to,
  );
  const tax = (amount: number, rate: number) => (rate ? Math.floor((amount * rate) / (100 + rate)) : 0);
  return csvResponse(
    toCsv(
      ["申請番号", "利用日", "社員番号", "氏名", "部署", "勘定科目コード", "勘定科目", "内容", "支払先", "金額(税込)", "税率", "消費税額", "登録番号", "区間", "承認日", "支払日"],
      rows.map((r) => [
        r.request_id, r.used_on, r.code, r.name, r.department_name, r.account_code, r.category_name, r.description, r.payee, r.amount,
        `${r.tax_rate}%`, tax(r.amount, r.tax_rate), r.invoice_number ?? "", r.route_from ? `${r.route_from}→${r.route_to}${r.round_trip ? " (往復)" : ""}` : "",
        r.decided_at?.slice(0, 10) ?? "", r.paid_at ?? "",
      ]),
    ),
    `expense-journal-${from}-${to}.csv`,
  );
});

// ── フォーム・承認ルート (設定)
requestRoutes.get("/forms", async (c) => {
  const user = c.get("user");
  const rows = await all<any>(
    c.env.DB,
    `SELECT f.*, r.name AS route_name FROM request_forms f LEFT JOIN approval_routes r ON r.id = f.route_id
      ${user.role === "admin" ? "" : "WHERE f.active = 1"} ORDER BY f.sort_order, f.id`,
  );
  return c.json(rows.map((r) => ({ ...r, fields: parseJson(r.fields, []) })));
});

requestRoutes.post("/forms", requireRole("admin"), async (c) => {
  const b = await c.req.json<any>();
  if (!b.name?.trim()) throw badRequest("フォーム名を入力してください");
  const id = await insert(
    c.env.DB,
    "INSERT INTO request_forms (kind, name, description, fields, route_id, active, sort_order) VALUES ('general', ?, ?, ?, ?, 1, 100)",
    b.name.trim(),
    b.description ?? "",
    JSON.stringify(validateFields(b.fields)),
    b.route_id || null,
  );
  return c.json({ id });
});

function validateFields(fields: any): any[] {
  if (!Array.isArray(fields)) return [];
  const keys = new Set<string>();
  return fields.map((f: any, i: number) => {
    const key = String(f.key || `field_${i + 1}`).replace(/[^a-zA-Z0-9_]/g, "_");
    if (keys.has(key)) throw badRequest(`項目キー ${key} が重複しています`);
    keys.add(key);
    if (!f.label?.trim()) throw badRequest("項目名を入力してください");
    const type = ["text", "textarea", "number", "date", "select"].includes(f.type) ? f.type : "text";
    return { key, label: f.label.trim(), type, required: !!f.required, options: type === "select" ? (f.options ?? []).filter(Boolean) : undefined };
  });
}

requestRoutes.put("/forms/:id", requireRole("admin"), async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json<any>();
  const form = await first<any>(c.env.DB, "SELECT * FROM request_forms WHERE id = ?", id);
  if (!form) throw notFound();
  await run(
    c.env.DB,
    "UPDATE request_forms SET name = ?, description = ?, fields = ?, route_id = ?, active = ? WHERE id = ?",
    b.name ?? form.name,
    b.description ?? form.description,
    form.kind === "general" ? JSON.stringify(validateFields(b.fields ?? parseJson(form.fields, []))) : form.fields,
    b.route_id === undefined ? form.route_id : b.route_id || null,
    b.active === undefined ? form.active : b.active ? 1 : 0,
    id,
  );
  return c.json({ ok: true });
});

requestRoutes.get("/routes", async (c) => {
  const rows = await all<any>(c.env.DB, "SELECT * FROM approval_routes ORDER BY id");
  return c.json(rows.map((r) => ({ ...r, steps: parseJson(r.steps, []) })));
});

function validateSteps(steps: any): any[] {
  if (!Array.isArray(steps) || steps.length === 0) throw badRequest("承認ステップを1つ以上設定してください");
  return steps.map((s: any) => {
    const type = ["manager", "department_head", "role", "employee"].includes(s.type) ? s.type : "manager";
    if (type === "employee" && !s.employee_id) throw badRequest("承認者を選択してください");
    return { type, role: type === "role" ? (s.role === "manager" ? "manager" : "admin") : undefined, employee_id: type === "employee" ? Number(s.employee_id) : undefined, label: s.label || undefined };
  });
}

requestRoutes.post("/routes", requireRole("admin"), async (c) => {
  const b = await c.req.json<any>();
  if (!b.name?.trim()) throw badRequest("ルート名を入力してください");
  return c.json({ id: await insert(c.env.DB, "INSERT INTO approval_routes (name, steps) VALUES (?, ?)", b.name.trim(), JSON.stringify(validateSteps(b.steps))) });
});

requestRoutes.put("/routes/:id", requireRole("admin"), async (c) => {
  const b = await c.req.json<any>();
  const id = Number(c.req.param("id"));
  await run(c.env.DB, "UPDATE approval_routes SET name = ?, steps = ? WHERE id = ?", b.name, JSON.stringify(validateSteps(b.steps)), id);
  if (b.is_default) {
    await run(c.env.DB, "UPDATE approval_routes SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END", id);
  }
  return c.json({ ok: true });
});

requestRoutes.delete("/routes/:id", requireRole("admin"), async (c) => {
  const id = Number(c.req.param("id"));
  const used = await first<any>(c.env.DB, "SELECT name FROM request_forms WHERE route_id = ? LIMIT 1", id);
  if (used) throw conflict(`「${used.name}」で使われているため削除できません`);
  await run(c.env.DB, "DELETE FROM approval_routes WHERE id = ? AND is_default = 0", id);
  return c.json({ ok: true });
});

requestRoutes.get("/expense-categories", async (c) => c.json(await all(c.env.DB, "SELECT * FROM expense_categories ORDER BY sort_order, id")));
requestRoutes.post("/expense-categories", requireRole("admin"), async (c) => {
  const b = await c.req.json<any>();
  if (!b.name?.trim()) throw badRequest("科目名を入力してください");
  return c.json({
    id: await insert(
      c.env.DB,
      "INSERT INTO expense_categories (name, account_code, tax_rate, requires_receipt, is_transport, sort_order) VALUES (?, ?, ?, ?, ?, 100)",
      b.name.trim(),
      b.account_code ?? "",
      Number(b.tax_rate ?? 10),
      b.requires_receipt ? 1 : 0,
      b.is_transport ? 1 : 0,
    ),
  });
});
requestRoutes.put("/expense-categories/:id", requireRole("admin"), async (c) => {
  const b = await c.req.json<any>();
  await run(
    c.env.DB,
    "UPDATE expense_categories SET name = ?, account_code = ?, tax_rate = ?, requires_receipt = ?, is_transport = ?, active = ? WHERE id = ?",
    b.name,
    b.account_code ?? "",
    Number(b.tax_rate ?? 10),
    b.requires_receipt ? 1 : 0,
    b.is_transport ? 1 : 0,
    b.active === false ? 0 : 1,
    Number(c.req.param("id")),
  );
  return c.json({ ok: true });
});
