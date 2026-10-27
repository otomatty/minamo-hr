// ワークフロー (申請・多段承認・差戻し) の共通エンジン
import { all, first, insert, parseJson, run } from "../lib/db";
import { badRequest, conflict, forbidden, notFound, type SessionUser } from "../lib/context";
import { addDays, WEEKDAY_JA, weekday, nowLocal } from "../../shared/dates";
import { adminEmployeeIds, fullName, loadCompany, notify, type Company } from "./common";
import { applyLeave, revertLeave, validateLeave, type LeavePayload } from "./leave";
import { saveDay } from "./attendance";

export type RequestKind = "leave" | "punch_fix" | "overtime" | "expense" | "general";

export interface RouteStep {
  type: "manager" | "department_head" | "role" | "employee";
  role?: "admin" | "manager";
  employee_id?: number;
  label?: string;
}

export interface FormField {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select";
  required?: boolean;
  options?: string[];
}

export interface ExpenseItemInput {
  used_on: string;
  category_id: number;
  description: string;
  payee?: string;
  amount: number;
  tax_rate?: number;
  invoice_number?: string;
  route_from?: string;
  route_to?: string;
  round_trip?: boolean;
  receipt_key?: string | null;
  receipt_name?: string | null;
}

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}(${WEEKDAY_JA[weekday(d)]})`;
const UNIT_JA: Record<string, string> = { full: "全日", am: "午前休", pm: "午後休" };

/** 申請内容を検証し、件名と金額を返す */
export async function validatePayload(
  db: D1Database,
  form: any,
  applicantId: number,
  payload: any,
  items: ExpenseItemInput[] | undefined,
  today: string,
  company: Company,
  requestId?: number,
): Promise<{ title: string; amount: number }> {
  const kind = form.kind as RequestKind;
  if (kind === "leave") {
    const p = payload as LeavePayload;
    p.leave_type_id = Number(p.leave_type_id);
    const type = await validateLeave(db, applicantId, p, today, company, requestId);
    const sorted = [...p.dates].sort((a, b) => a.date.localeCompare(b.date));
    const range = sorted.length === 1 ? `${md(sorted[0].date)} ${UNIT_JA[sorted[0].unit]}` : `${md(sorted[0].date)}〜${md(sorted[sorted.length - 1].date)} (${sorted.length}日)`;
    return { title: `${type.name} ${range}`, amount: 0 };
  }
  if (kind === "punch_fix") {
    const hhmm = /^\d{2}:\d{2}$/;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date ?? "")) throw badRequest("対象日を入力してください");
    if (payload.date > today) throw badRequest("未来の日付は修正できません");
    if (!hhmm.test(payload.clock_in ?? "")) throw badRequest("出勤時刻を入力してください");
    if (!hhmm.test(payload.clock_out ?? "")) throw badRequest("退勤時刻を入力してください");
    for (const b of payload.breaks ?? []) if (!hhmm.test(b.start) || !hhmm.test(b.end)) throw badRequest("休憩時刻の形式が正しくありません");
    if (!payload.reason?.trim()) throw badRequest("修正理由を入力してください");
    toDayEdit(payload); // 時刻の整合性チェック
    return { title: `打刻修正 ${md(payload.date)} ${payload.clock_in}〜${payload.clock_out}`, amount: 0 };
  }
  if (kind === "overtime") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date ?? "")) throw badRequest("対象日を入力してください");
    if (!/^\d{2}:\d{2}$/.test(payload.end ?? "")) throw badRequest("終了予定時刻を入力してください");
    if (!payload.reason?.trim()) throw badRequest("残業理由を入力してください");
    return { title: `残業申請 ${md(payload.date)} 〜${payload.end}`, amount: 0 };
  }
  if (kind === "expense") {
    if (!items?.length) throw badRequest("明細を1件以上入力してください");
    const cats = new Map((await all<any>(db, "SELECT * FROM expense_categories")).map((c) => [c.id, c]));
    let amount = 0;
    for (const [i, it] of items.entries()) {
      const n = i + 1;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(it.used_on ?? "")) throw badRequest(`明細${n}: 利用日を入力してください`);
      if (!cats.has(Number(it.category_id))) throw badRequest(`明細${n}: 経費科目を選択してください`);
      if (!Number.isInteger(Number(it.amount)) || Number(it.amount) <= 0) throw badRequest(`明細${n}: 金額を正しく入力してください`);
      if (!it.description?.trim()) throw badRequest(`明細${n}: 内容を入力してください`);
      if (it.invoice_number && !/^T\d{13}$/.test(it.invoice_number)) throw badRequest(`明細${n}: 登録番号は T + 13桁の数字で入力してください`);
      const cat = cats.get(Number(it.category_id));
      if (cat.is_transport && (!it.route_from || !it.route_to)) throw badRequest(`明細${n}: 交通費は出発地と到着地を入力してください`);
      amount += Number(it.amount);
    }
    if (!["payroll", "transfer"].includes(payload.settlement)) payload.settlement = "payroll";
    const title = payload.title?.trim() || `経費精算 ${items.length}件`;
    return { title, amount };
  }
  // general
  const fields = parseJson<FormField[]>(form.fields, []);
  for (const f of fields) {
    const v = payload[f.key];
    if (f.required && (v === undefined || v === null || String(v).trim() === "")) throw badRequest(`${f.label}を入力してください`);
    if (f.type === "number" && v !== undefined && v !== "" && Number.isNaN(Number(v))) throw badRequest(`${f.label}は数値で入力してください`);
  }
  const amountField = fields.find((f) => f.key === "amount");
  const amount = amountField ? Number(payload.amount) || 0 : 0;
  const title = (payload.title?.trim() as string) || form.name;
  return { title, amount };
}

function toDayEdit(p: any) {
  const date = p.date as string;
  const nextDay = addDays(date, 1);
  const at = (hhmm: string, next = false) => `${next ? nextDay : date}T${hhmm}:00`;
  const clockIn = at(p.clock_in);
  let clockOut = at(p.clock_out, !!p.clock_out_next_day);
  if (clockOut <= clockIn && !p.clock_out_next_day) clockOut = at(p.clock_out, true);
  const breaks = (p.breaks ?? []).map((b: any) => {
    let s = at(b.start);
    let e = at(b.end);
    if (s < clockIn) s = at(b.start, true);
    if (e <= s) e = at(b.end, true);
    return { start: s, end: e };
  });
  return { clock_in: clockIn, clock_out: clockOut, breaks, note: `打刻修正: ${p.reason ?? ""}` };
}

export async function saveExpenseItems(db: D1Database, requestId: number, items: ExpenseItemInput[]) {
  const cats = new Map((await all<any>(db, "SELECT id, tax_rate FROM expense_categories")).map((c) => [c.id, c]));
  const stmts = [db.prepare("DELETE FROM expense_items WHERE request_id = ?").bind(requestId)];
  items.forEach((it, i) =>
    stmts.push(
      db
        .prepare(
          `INSERT INTO expense_items (request_id, used_on, category_id, description, payee, amount, tax_rate, invoice_number,
             route_from, route_to, round_trip, receipt_key, receipt_name, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          requestId,
          it.used_on,
          Number(it.category_id),
          it.description.trim(),
          it.payee ?? "",
          Number(it.amount),
          Number(it.tax_rate ?? cats.get(Number(it.category_id))?.tax_rate ?? 10),
          it.invoice_number || null,
          it.route_from || null,
          it.route_to || null,
          it.round_trip ? 1 : 0,
          it.receipt_key || null,
          it.receipt_name || null,
          i,
        ),
    ),
  );
  await db.batch(stmts);
}

interface ResolvedStep {
  label: string;
  approver_id: number | null;
  approver_role: string | null;
}

async function resolveSteps(db: D1Database, routeId: number | null, applicantId: number): Promise<ResolvedStep[]> {
  const route =
    (routeId ? await first<any>(db, "SELECT * FROM approval_routes WHERE id = ?", routeId) : null) ??
    (await first<any>(db, "SELECT * FROM approval_routes WHERE is_default = 1"));
  const steps = parseJson<RouteStep[]>(route?.steps, [{ type: "manager" }]);
  const applicant = await first<any>(db, "SELECT id, manager_id, department_id FROM employees WHERE id = ?", applicantId);
  const out: ResolvedStep[] = [];
  for (const s of steps) {
    if (s.type === "manager") {
      const id = applicant?.manager_id;
      if (id && id !== applicantId) out.push({ label: s.label || "上長", approver_id: id, approver_role: null });
    } else if (s.type === "department_head") {
      // 所属部署 → 親部署の順に、申請者以外の部門長を探す
      let deptId = applicant?.department_id;
      let head: number | null = null;
      for (let guard = 0; deptId && guard < 10; guard++) {
        const d = await first<any>(db, "SELECT parent_id, head_employee_id FROM departments WHERE id = ?", deptId);
        if (!d) break;
        if (d.head_employee_id && d.head_employee_id !== applicantId) {
          head = d.head_employee_id;
          break;
        }
        deptId = d.parent_id;
      }
      if (head && !out.some((o) => o.approver_id === head)) out.push({ label: s.label || "部門長", approver_id: head, approver_role: null });
    } else if (s.type === "employee") {
      if (s.employee_id && s.employee_id !== applicantId) out.push({ label: s.label || "承認者", approver_id: s.employee_id, approver_role: null });
    } else if (s.type === "role") {
      const role = s.role ?? "admin";
      const others = await first<{ n: number }>(
        db,
        "SELECT COUNT(*) AS n FROM users WHERE role = ? AND is_active = 1 AND employee_id != ?",
        role,
        applicantId,
      );
      if (others?.n) out.push({ label: s.label || (role === "admin" ? "管理者" : "マネージャー"), approver_id: null, approver_role: role });
    }
  }
  return out;
}

async function approversOf(db: D1Database, step: { approver_id: number | null; approver_role: string | null }): Promise<number[]> {
  if (step.approver_id) return [step.approver_id];
  if (step.approver_role) {
    return (await all<{ employee_id: number }>(db, "SELECT employee_id FROM users WHERE role = ? AND is_active = 1", step.approver_role)).map(
      (r) => r.employee_id,
    );
  }
  return [];
}

export async function submitRequest(db: D1Database, requestId: number, user: SessionUser, now: string): Promise<void> {
  const req = await first<any>(db, "SELECT r.*, f.route_id FROM requests r JOIN request_forms f ON f.id = r.form_id WHERE r.id = ?", requestId);
  if (!req) throw notFound();
  if (req.applicant_id !== user.employeeId) throw forbidden();
  if (!["draft", "returned"].includes(req.status)) throw conflict("この申請は提出できません");
  const steps = await resolveSteps(db, req.route_id, req.applicant_id);
  // 承認者が自分自身になるロール承認は自己承認を避けるため残す (他の管理者が承認)
  const stmts = [db.prepare("DELETE FROM request_steps WHERE request_id = ?").bind(requestId)];
  steps.forEach((s, i) =>
    stmts.push(
      db
        .prepare("INSERT INTO request_steps (request_id, step_no, label, approver_id, approver_role, status) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(requestId, i + 1, s.label, s.approver_id, s.approver_role, i === 0 ? "pending" : "waiting"),
    ),
  );
  stmts.push(
    db
      .prepare("UPDATE requests SET status = 'pending', current_step = ?, submitted_at = ?, decided_at = NULL, updated_at = datetime('now') WHERE id = ?")
      .bind(steps.length ? 1 : 0, now, requestId),
  );
  await db.batch(stmts);
  if (!steps.length) {
    await finalize(db, requestId, now);
    return;
  }
  const applicant = await first<any>(db, "SELECT last_name, first_name FROM employees WHERE id = ?", req.applicant_id);
  await notify(db, await approversOf(db, steps[0]), `承認依頼: ${req.title}`, `${fullName(applicant)} さんから申請が届きました`, `/requests/${requestId}`);
}

export function canActOnStep(user: SessionUser, step: any, applicantId: number): boolean {
  if (step.approver_id === user.employeeId) return true;
  if (step.approver_role && step.approver_role === user.role && applicantId !== user.employeeId) return true;
  return user.role === "admin" && applicantId !== user.employeeId; // 管理者による代理承認
}

async function currentStep(db: D1Database, requestId: number) {
  return first<any>(db, "SELECT * FROM request_steps WHERE request_id = ? AND status = 'pending' ORDER BY step_no LIMIT 1", requestId);
}

export async function decide(
  db: D1Database,
  requestId: number,
  user: SessionUser,
  action: "approve" | "reject" | "return",
  comment: string,
  now: string,
): Promise<void> {
  const req = await first<any>(db, "SELECT * FROM requests WHERE id = ?", requestId);
  if (!req) throw notFound();
  if (req.status !== "pending") throw conflict("この申請は承認待ちではありません");
  const step = await currentStep(db, requestId);
  if (!step) throw conflict("承認ステップが見つかりません");
  if (!canActOnStep(user, step, req.applicant_id)) throw forbidden("この申請を承認する権限がありません");
  if ((action === "reject" || action === "return") && !comment.trim()) throw badRequest("却下・差戻しの理由を入力してください");

  const proxy = step.approver_id && step.approver_id !== user.employeeId ? "(代理承認)" : "";
  const status = action === "approve" ? "approved" : action === "reject" ? "rejected" : "returned";
  const markStep = () =>
    run(
      db,
      "UPDATE request_steps SET status = ?, acted_by = ?, acted_at = ?, comment = ? WHERE id = ?",
      status,
      user.employeeId,
      now,
      [comment.trim(), proxy].filter(Boolean).join(" ") || null,
      step.id,
    );
  const ACTION_JA = { approve: "承認", reject: "却下", return: "差戻し" } as const;
  const addComment = async () => {
    if (comment.trim()) {
      await insert(db, "INSERT INTO request_comments (request_id, employee_id, body) VALUES (?, ?, ?)", requestId, user.employeeId, `【${ACTION_JA[action]}】${comment}`);
    }
  };

  if (action === "approve") {
    const next = await first<any>(db, "SELECT * FROM request_steps WHERE request_id = ? AND status = 'waiting' ORDER BY step_no LIMIT 1", requestId);
    if (next) {
      await markStep();
      await addComment();
      await run(db, "UPDATE request_steps SET status = 'pending' WHERE id = ?", next.id);
      await run(db, "UPDATE requests SET current_step = ?, updated_at = datetime('now') WHERE id = ?", next.step_no, requestId);
      await notify(db, await approversOf(db, next), `承認依頼: ${req.title}`, "前の承認者が承認しました", `/requests/${requestId}`);
      return;
    }
    // 最終承認: 反映処理が失敗した場合はステップを更新しない
    await finalize(db, requestId, now);
    await markStep();
    await addComment();
    return;
  }
  await markStep();
  await addComment();
  await run(db, "UPDATE requests SET status = ?, decided_at = ?, updated_at = datetime('now') WHERE id = ?", status, now, requestId);
  await notify(db, [req.applicant_id], `${ACTION_JA[action]}されました: ${req.title}`, comment, `/requests/${requestId}`);
}

/** 最終承認: 申請種別ごとの反映処理 */
async function finalize(db: D1Database, requestId: number, now: string) {
  const req = await first<any>(db, "SELECT * FROM requests WHERE id = ?", requestId);
  const payload = parseJson<any>(req.payload, {});
  const company = (await loadCompany(db))!;
  if (req.kind === "leave") {
    const today = now.slice(0, 10);
    await validateLeave(db, req.applicant_id, payload, today, company, requestId);
    await applyLeave(db, requestId, req.applicant_id, payload);
  } else if (req.kind === "punch_fix") {
    await saveDay(db, req.applicant_id, payload.date, toDayEdit(payload), company);
  }
  await run(db, "UPDATE requests SET status = 'approved', decided_at = ?, updated_at = datetime('now') WHERE id = ?", now, requestId);
  await notify(db, [req.applicant_id], `承認されました: ${req.title}`, "", `/requests/${requestId}`);
  if (req.kind === "expense" && payload.settlement === "transfer") {
    await notify(db, await adminEmployeeIds(db), `経費の振込待ち: ${req.title}`, `${req.amount.toLocaleString()}円`, `/expenses/payables`);
  }
}

export async function withdraw(db: D1Database, requestId: number, user: SessionUser): Promise<void> {
  const req = await first<any>(db, "SELECT * FROM requests WHERE id = ?", requestId);
  if (!req) throw notFound();
  if (req.applicant_id !== user.employeeId) throw forbidden();
  if (!["pending", "returned", "draft"].includes(req.status)) throw conflict("この申請は取り下げできません");
  await run(db, "UPDATE requests SET status = 'withdrawn', updated_at = datetime('now') WHERE id = ?", requestId);
  await run(db, "UPDATE request_steps SET status = 'skipped' WHERE request_id = ? AND status IN ('pending', 'waiting')", requestId);
}

/** 承認済み申請の取消 (管理者)。休暇は残日数を戻す。打刻修正は勤怠を手動で直す必要がある */
export async function cancelApproved(db: D1Database, requestId: number, user: SessionUser, reason: string): Promise<void> {
  if (user.role !== "admin") throw forbidden();
  const req = await first<any>(db, "SELECT * FROM requests WHERE id = ?", requestId);
  if (!req) throw notFound();
  if (req.status !== "approved") throw conflict("承認済みの申請だけ取り消せます");
  if (req.kind === "expense" && req.paid_at) throw conflict("支払済みの経費は取り消せません");
  if (req.kind === "leave") await revertLeave(db, requestId);
  await run(db, "UPDATE requests SET status = 'canceled', updated_at = datetime('now') WHERE id = ?", requestId);
  await insert(db, "INSERT INTO request_comments (request_id, employee_id, body) VALUES (?, ?, ?)", requestId, user.employeeId, `【取消】${reason}`);
  await notify(db, [req.applicant_id], `取り消されました: ${req.title}`, reason, `/requests/${requestId}`);
}

export async function requestDetail(db: D1Database, requestId: number) {
  const req = await first<any>(
    db,
    `SELECT r.*, f.name AS form_name, f.fields AS form_fields, e.last_name, e.first_name, e.code AS employee_code, d.name AS department_name
       FROM requests r JOIN request_forms f ON f.id = r.form_id JOIN employees e ON e.id = r.applicant_id
       LEFT JOIN departments d ON d.id = e.department_id WHERE r.id = ?`,
    requestId,
  );
  if (!req) return null;
  const [steps, comments, items] = await Promise.all([
    all<any>(
      db,
      `SELECT s.*, a.last_name AS approver_last, a.first_name AS approver_first, b.last_name AS actor_last, b.first_name AS actor_first
         FROM request_steps s LEFT JOIN employees a ON a.id = s.approver_id LEFT JOIN employees b ON b.id = s.acted_by
        WHERE s.request_id = ? ORDER BY s.step_no`,
      requestId,
    ),
    all<any>(
      db,
      `SELECT c.*, e.last_name, e.first_name FROM request_comments c LEFT JOIN employees e ON e.id = c.employee_id
        WHERE c.request_id = ? ORDER BY c.id`,
      requestId,
    ),
    req.kind === "expense"
      ? all<any>(
          db,
          `SELECT i.*, c.name AS category_name, c.account_code FROM expense_items i LEFT JOIN expense_categories c ON c.id = i.category_id
            WHERE i.request_id = ? ORDER BY i.sort_order`,
          requestId,
        )
      : Promise.resolve([]),
  ]);
  let leaveType: any = null;
  const payload = parseJson<any>(req.payload, {});
  if (req.kind === "leave") leaveType = await first(db, "SELECT id, name FROM leave_types WHERE id = ?", payload.leave_type_id);
  return {
    ...req,
    payload,
    form_fields: parseJson(req.form_fields, []),
    applicant_name: `${req.last_name} ${req.first_name}`,
    steps: steps.map((s) => ({
      ...s,
      approver_name: s.approver_id ? `${s.approver_last} ${s.approver_first}` : null,
      actor_name: s.acted_by ? `${s.actor_last} ${s.actor_first}` : null,
    })),
    comments: comments.map((c) => ({ ...c, author: c.employee_id ? `${c.last_name} ${c.first_name}` : "システム" })),
    items,
    leave_type: leaveType,
  };
}

export { nowLocal };
