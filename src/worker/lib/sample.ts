// セットアップ時の「サンプルデータを入れる」用のデモデータ (架空の人物・部署)
import { all, first, insert, run } from "./db";
import { hashPassword } from "./auth";
import { addDays, eachDay, weekday } from "../../shared/dates";
import { standardFromRemuneration } from "../../shared/calc/insurance";
import type { SessionUser } from "./context";
import { autoGrantLeave } from "../domain/leave";
import { decide, saveExpenseItems, submitRequest } from "../domain/workflow";

export const SAMPLE_PASSWORD = "demo1234";

function rng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

interface SampleEmp {
  code: string;
  last: string;
  first: string;
  lastKana: string;
  firstKana: string;
  email: string;
  birth: string;
  gender: string;
  hire: string;
  dept: string;
  position: string;
  type: string;
  role: "admin" | "manager" | "employee";
  manager?: string; // code
  head?: string; // 部門長を務める部署
  pay: { type: "monthly" | "hourly"; base: number; allowances?: Array<[string, number]>; commute: number; si: boolean };
  weekly?: [number, number];
  pattern?: "part";
}

const EMPLOYEES: SampleEmp[] = [
  { code: "0002", last: "佐藤", first: "健太", lastKana: "サトウ", firstKana: "ケンタ", email: "sato@example.com", birth: "1980-06-15", gender: "male", hire: "2015-04-01", dept: "開発部", position: "部長", type: "full_time", role: "manager", head: "開発部", pay: { type: "monthly", base: 480000, allowances: [["役職手当", 50000]], commute: 20000, si: true } },
  { code: "0003", last: "鈴木", first: "美咲", lastKana: "スズキ", firstKana: "ミサキ", email: "suzuki@example.com", birth: "1993-11-02", gender: "female", hire: "2019-04-01", dept: "開発部", position: "メンバー", type: "full_time", role: "employee", manager: "0002", pay: { type: "monthly", base: 320000, commute: 12000, si: true } },
  { code: "0004", last: "高橋", first: "翔", lastKana: "タカハシ", firstKana: "ショウ", email: "takahashi@example.com", birth: "1988-03-20", gender: "male", hire: "2017-10-01", dept: "開発部", position: "主任", type: "full_time", role: "employee", manager: "0002", pay: { type: "monthly", base: 380000, allowances: [["主任手当", 20000]], commute: 15000, si: true } },
  { code: "0005", last: "田中", first: "優子", lastKana: "タナカ", firstKana: "ユウコ", email: "tanaka@example.com", birth: "1975-08-08", gender: "female", hire: "2012-04-01", dept: "営業部", position: "部長", type: "full_time", role: "manager", head: "営業部", pay: { type: "monthly", base: 450000, allowances: [["役職手当", 40000]], commute: 18000, si: true } },
  { code: "0006", last: "伊藤", first: "大輔", lastKana: "イトウ", firstKana: "ダイスケ", email: "ito@example.com", birth: "1996-01-25", gender: "male", hire: "2022-04-01", dept: "営業部", position: "メンバー", type: "full_time", role: "employee", manager: "0005", pay: { type: "monthly", base: 260000, allowances: [["営業手当", 20000]], commute: 10000, si: true } },
  { code: "0007", last: "渡辺", first: "さくら", lastKana: "ワタナベ", firstKana: "サクラ", email: "watanabe@example.com", birth: "1999-07-07", gender: "female", hire: "2025-04-01", dept: "人事総務部", position: "メンバー", type: "part_time", role: "employee", manager: "0001", pay: { type: "hourly", base: 1300, commute: 6000, si: false }, weekly: [3, 15], pattern: "part" },
  { code: "0008", last: "山本", first: "拓也", lastKana: "ヤマモト", firstKana: "タクヤ", email: "yamamoto@example.com", birth: "2000-12-12", gender: "male", hire: "2026-04-01", dept: "開発部", position: "メンバー", type: "contract", role: "employee", manager: "0004", pay: { type: "monthly", base: 250000, commute: 8000, si: true } },
];

export async function seedSampleData(db: D1Database, adminEmployeeId: number, today: string): Promise<void> {
  const pw = await hashPassword(SAMPLE_PASSWORD);
  // 部署
  const hr = await first<{ id: number }>(db, "SELECT id FROM departments WHERE name = '人事総務部'");
  const devId = await insert(db, "INSERT INTO departments (name, code, sort_order) VALUES ('開発部', 'DEV', 1)");
  const salesId = await insert(db, "INSERT INTO departments (name, code, sort_order) VALUES ('営業部', 'SALES', 2)");
  await insert(db, "INSERT INTO departments (name, code, parent_id, sort_order) VALUES ('プロダクト開発課', 'DEV1', ?, 0)", devId);
  const deptIds: Record<string, number> = { 人事総務部: hr!.id, 開発部: devId, 営業部: salesId };
  const positions = new Map((await all<any>(db, "SELECT id, name FROM positions")).map((p) => [p.name, p.id]));
  const normal = await first<{ id: number }>(db, "SELECT id FROM work_patterns WHERE is_default = 1");
  const partPattern = await insert(
    db,
    "INSERT INTO work_patterns (name, start_time, end_time, break_minutes, scheduled_minutes, work_days) VALUES ('パート (月水金 10:00-15:00)', '10:00', '15:00', 0, 300, '1,3,5')",
  );

  const codeToId: Record<string, number> = { "0001": adminEmployeeId };
  // 管理者の給与設定
  await insertSalary(db, adminEmployeeId, { type: "monthly", base: 400000, commute: 10000, si: true });
  await run(db, "UPDATE employees SET birth_date = '1985-04-10', gender = 'male', hire_date = '2014-04-01', last_name_kana = 'カンリ', first_name_kana = 'タロウ' WHERE id = ?", adminEmployeeId);

  for (const e of EMPLOYEES) {
    const id = await insert(
      db,
      `INSERT INTO employees (code, last_name, first_name, last_name_kana, first_name_kana, email, birth_date, gender, hire_date,
         employment_type, department_id, position_id, manager_id, work_pattern_id, weekly_work_days, weekly_work_hours,
         phone, postal_code, address, bank_name, bank_branch, bank_account_type, bank_account_number, bank_account_holder)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '090-0000-0000', '100-0001', '東京都千代田区サンプル1-2-3', 'サンプル銀行', '本店', '普通', '1234567', ?)`,
      e.code,
      e.last,
      e.first,
      e.lastKana,
      e.firstKana,
      e.email,
      e.birth,
      e.gender,
      e.hire,
      e.type,
      deptIds[e.dept],
      positions.get(e.position) ?? null,
      e.manager ? codeToId[e.manager] : null,
      e.pattern === "part" ? partPattern : normal!.id,
      e.weekly?.[0] ?? 5,
      e.weekly?.[1] ?? 40,
      `${e.lastKana} ${e.firstKana}`,
    );
    codeToId[e.code] = id;
    if (e.head) await run(db, "UPDATE departments SET head_employee_id = ? WHERE id = ?", id, deptIds[e.head]);
    await run(db, "INSERT INTO personnel_events (employee_id, event_date, event_type, description) VALUES (?, ?, 'hire', '入社')", id, e.hire);
    await run(db, "INSERT INTO users (employee_id, email, password_hash, role) VALUES (?, ?, ?, ?)", id, e.email, pw, e.role);
    await insertSalary(db, id, e.pay);
  }
  await run(db, "UPDATE employees SET manager_id = NULL WHERE id = ?", adminEmployeeId);
  await run(
    db,
    "INSERT INTO personnel_events (employee_id, event_date, event_type, description) VALUES (?, '2024-04-01', 'promotion', '主任に昇格')",
    codeToId["0004"],
  );

  // 扶養家族
  await run(db, "INSERT INTO dependents (employee_id, name, relationship, birth_date, is_spouse, withholding_target) VALUES (?, '佐藤 恵', '配偶者', '1982-02-14', 1, 1)", codeToId["0002"]);
  await run(db, "INSERT INTO dependents (employee_id, name, relationship, birth_date, is_spouse, withholding_target) VALUES (?, '佐藤 陽太', '長男', '2008-09-01', 0, 1)", codeToId["0002"]);
  await run(db, "INSERT INTO dependents (employee_id, name, relationship, birth_date, is_spouse, withholding_target) VALUES (?, '田中 蓮', '長男', '2010-05-20', 0, 1)", codeToId["0005"]);
  await run(db, "INSERT INTO dependents (employee_id, name, relationship, birth_date, is_spouse, withholding_target) VALUES (?, '高橋 彩', '配偶者', '1990-12-01', 1, 1)", codeToId["0004"]);

  // 勤怠 (先月1日〜昨日、今日は午前の出勤まで)
  const [ty, tm] = today.split("-").map(Number);
  const start = `${tm === 1 ? ty - 1 : ty}-${String(tm === 1 ? 12 : tm - 1).padStart(2, "0")}-01`;
  const holidays = new Set((await all<{ date: string }>(db, "SELECT date FROM holidays")).map((h) => h.date));
  const stmts: D1PreparedStatement[] = [];
  const all_ = [{ code: "0001", pattern: undefined as string | undefined, hire: "2014-04-01" }, ...EMPLOYEES.map((e) => ({ code: e.code, pattern: e.pattern, hire: e.hire }))];
  for (const e of all_) {
    const id = codeToId[e.code];
    const rand = rng(id * 7919 + 17);
    for (const date of eachDay(start, today)) {
      if (date < e.hire) continue;
      const wd = weekday(date);
      const part = e.pattern === "part";
      const workday = part ? [1, 3, 5].includes(wd) && !holidays.has(date) : wd >= 1 && wd <= 5 && !holidays.has(date);
      if (!workday) continue;
      if (e.code === "0003" && date === "2026-10-16") continue; // 有休取得日
      if (e.code === "0004" && date === addDays(today, -6)) {
        // 退勤打刻漏れ
        stmts.push(db.prepare("INSERT INTO attendance_days (employee_id, work_date, clock_in, breaks) VALUES (?, ?, ?, '[]')").bind(id, date, `${date}T08:55:00`));
        continue;
      }
      const r = rand();
      const inMin = part ? 9 * 60 + 50 + Math.floor(r * 8) : r < 0.06 ? 9 * 60 + 5 + Math.floor(rand() * 20) : 8 * 60 + 40 + Math.floor(rand() * 18);
      const overtime = part ? 0 : rand() < 0.4 ? Math.floor(rand() * 150) : 0;
      const outMin = part ? 15 * 60 + Math.floor(rand() * 6) : 18 * 60 + overtime + Math.floor(rand() * 10);
      const clockIn = `${date}T${hhmm(inMin)}:00`;
      if (date === today) {
        if (rand() < 0.85) stmts.push(db.prepare("INSERT INTO attendance_days (employee_id, work_date, clock_in, breaks) VALUES (?, ?, ?, '[]')").bind(id, date, clockIn));
        continue;
      }
      const breaks = part ? [] : [{ start: `${date}T12:00:00`, end: `${date}T13:00:00` }];
      stmts.push(
        db
          .prepare("INSERT INTO attendance_days (employee_id, work_date, clock_in, clock_out, breaks) VALUES (?, ?, ?, ?, ?)")
          .bind(id, date, clockIn, `${date}T${hhmm(outMin)}:00`, JSON.stringify(breaks)),
      );
    }
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));

  await autoGrantLeave(db, today);

  // 申請データ
  const users = new Map(
    (await all<any>(db, "SELECT u.id, u.employee_id, u.role, u.email, e.last_name, e.first_name FROM users u JOIN employees e ON e.id = u.employee_id")).map(
      (u) => [u.employee_id, { userId: u.id, employeeId: u.employee_id, role: u.role, email: u.email, name: `${u.last_name} ${u.first_name}`, mustChangePassword: false } as SessionUser],
    ),
  );
  const forms = new Map((await all<any>(db, "SELECT id, kind, name FROM request_forms")).map((f) => [f.kind === "general" ? f.name : f.kind, f.id]));
  const annual = await first<{ id: number }>(db, "SELECT id FROM leave_types WHERE code = 'annual'");
  const now = `${today}T09:30:00`;
  const make = async (code: string, formKey: string, kind: string, title: string, payload: any, amount = 0) => {
    const id = await insert(
      db,
      "INSERT INTO requests (form_id, kind, applicant_id, title, payload, amount) VALUES (?, ?, ?, ?, ?, ?)",
      forms.get(formKey),
      kind,
      codeToId[code],
      title,
      JSON.stringify(payload),
      amount,
    );
    await submitRequest(db, id, users.get(codeToId[code])!, now);
    return id;
  };

  // 承認済みの有休 (鈴木)
  const leaveId = await make("0003", "leave", "leave", "年次有給休暇 10/16(金) 全日", { leave_type_id: annual!.id, dates: [{ date: "2026-10-16", unit: "full" }], reason: "私用のため" });
  await decide(db, leaveId, users.get(codeToId["0002"])!, "approve", "", now);
  // 承認待ちの有休 (伊藤 → 田中)
  await make("0006", "leave", "leave", "年次有給休暇 11/6(金) 全日", { leave_type_id: annual!.id, dates: [{ date: "2026-11-06", unit: "full" }], reason: "通院のため" });
  // 打刻修正 (高橋 → 佐藤)
  const missDate = addDays(today, -6);
  await make("0004", "punch_fix", "punch_fix", `打刻修正 ${missDate} 08:55〜19:10`, { date: missDate, clock_in: "08:55", clock_out: "19:10", breaks: [{ start: "12:00", end: "13:00" }], reason: "退勤打刻を忘れたため" });
  // 経費 (鈴木: 上長承認待ち)
  const cats = new Map((await all<any>(db, "SELECT id, name FROM expense_categories")).map((c) => [c.name, c.id]));
  const expId = await insert(
    db,
    "INSERT INTO requests (form_id, kind, applicant_id, title, payload, amount) VALUES (?, 'expense', ?, ?, ?, ?)",
    forms.get("expense"),
    codeToId["0003"],
    "10月 顧客訪問・書籍購入",
    JSON.stringify({ settlement: "payroll", title: "10月 顧客訪問・書籍購入" }),
    4280,
  );
  await saveExpenseItems(db, expId, [
    { used_on: "2026-10-08", category_id: cats.get("旅費交通費")!, description: "顧客訪問 (株式会社サンプル)", amount: 680, route_from: "渋谷", route_to: "大手町", round_trip: true },
    { used_on: "2026-10-14", category_id: cats.get("新聞図書費")!, description: "技術書籍", payee: "サンプル書店", amount: 3600, invoice_number: "T1234567890123" },
  ]);
  await submitRequest(db, expId, users.get(codeToId["0003"])!, now);
  // 稟議 (田中: 承認済み)
  const ringi = await make("0005", "稟議書", "general", "展示会出展費用", { title: "展示会出展費用", purpose: "来春の業界展示会に出展し、新規リード獲得を図る", amount: 880000, vendor: "サンプルイベント株式会社", date: "2027-03-10" }, 880000);
  for (const approver of ["0001"]) {
    const u = users.get(codeToId[approver])!;
    const step = await first<any>(db, "SELECT * FROM request_steps WHERE request_id = ? AND status = 'pending'", ringi);
    if (step) await decide(db, ringi, u, "approve", "承認します", now);
  }

  await run(
    db,
    "INSERT INTO announcements (title, body, published_on, created_by) VALUES (?, ?, ?, ?)",
    "年末調整の書類提出について",
    "11月20日までに扶養控除等申告書・保険料控除申告書の提出をお願いします。",
    today,
    adminEmployeeId,
  );
  await run(
    db,
    "INSERT INTO announcements (title, body, published_on, created_by) VALUES (?, ?, ?, ?)",
    "健康診断の日程",
    "11月中旬に定期健康診断を実施します。日程は追ってお知らせします。",
    addDays(today, -5),
    adminEmployeeId,
  );
}

async function insertSalary(db: D1Database, employeeId: number, pay: SampleEmp["pay"]) {
  const allowances = (pay.allowances ?? []).map(([name, amount]) => ({ name, amount, taxable: true, overtime_base: true }));
  const monthly = pay.type === "monthly" ? pay.base + allowances.reduce((t, a) => t + a.amount, 0) + pay.commute : 0;
  const std = pay.si ? standardFromRemuneration(monthly).healthStandard : 0;
  await run(
    db,
    `INSERT INTO salary_settings (employee_id, pay_type, base_salary, hourly_wage, allowances, commute_allowance, standard_monthly_remuneration,
       health_insurance, pension_insurance, employment_insurance, resident_tax_june, resident_tax_monthly)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    employeeId,
    pay.type,
    pay.type === "monthly" ? pay.base : 0,
    pay.type === "hourly" ? pay.base : 0,
    JSON.stringify(allowances),
    pay.commute,
    std,
    pay.si ? 1 : 0,
    pay.si ? 1 : 0,
    pay.si ? 1 : 0, // 週20時間未満のパートは雇用保険の対象外
    pay.si ? Math.round(monthly * 0.006) * 10 + 300 : 0,
    pay.si ? Math.round(monthly * 0.006) * 10 : 0,
  );
}
