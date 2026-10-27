// 初期セットアップ時に投入するマスタデータ
import { NATIONAL_HOLIDAYS } from "../../shared/holidays";
import { DEFAULT_RATE_ROWS } from "../../shared/calc/insurance";

export const DEFAULT_LEAVE_TYPES = [
  { name: "年次有給休暇", code: "annual", is_paid: 1, uses_annual_leave: 1, allow_half_day: 1 },
  { name: "特別休暇", code: "special", is_paid: 1, uses_annual_leave: 0, allow_half_day: 1 },
  { name: "慶弔休暇", code: "bereavement", is_paid: 1, uses_annual_leave: 0, allow_half_day: 0 },
  { name: "夏季休暇", code: "summer", is_paid: 1, uses_annual_leave: 0, allow_half_day: 0 },
  { name: "子の看護等休暇", code: "child_care_leave", is_paid: 0, uses_annual_leave: 0, allow_half_day: 1 },
  { name: "介護休暇", code: "family_care_leave", is_paid: 0, uses_annual_leave: 0, allow_half_day: 1 },
  { name: "生理休暇", code: "menstrual", is_paid: 0, uses_annual_leave: 0, allow_half_day: 1 },
  { name: "欠勤", code: "absence", is_paid: 0, uses_annual_leave: 0, allow_half_day: 1 },
];

export const DEFAULT_ROUTES = [
  { name: "上長承認", steps: [{ type: "manager", label: "上長" }], is_default: 1 },
  { name: "上長 → 人事労務", steps: [{ type: "manager", label: "上長" }, { type: "role", role: "admin", label: "人事労務" }], is_default: 0 },
  {
    name: "上長 → 部門長 → 経理",
    steps: [
      { type: "manager", label: "上長" },
      { type: "department_head", label: "部門長" },
      { type: "role", role: "admin", label: "経理" },
    ],
    is_default: 0,
  },
];

export const DEFAULT_FORMS = [
  { kind: "leave", name: "休暇申請", description: "有給休暇・特別休暇などの取得を申請します", route: 0, fields: [] },
  { kind: "punch_fix", name: "打刻修正申請", description: "打刻漏れ・打刻誤りの修正を申請します", route: 0, fields: [] },
  { kind: "overtime", name: "残業申請", description: "所定時間を超える勤務を事前に申請します", route: 0, fields: [] },
  { kind: "expense", name: "経費精算", description: "立て替えた経費の精算を申請します", route: 1, fields: [] },
  {
    kind: "general",
    name: "稟議書",
    description: "契約・発注・投資などの決裁を申請します",
    route: 2,
    fields: [
      { key: "purpose", label: "目的・背景", type: "textarea", required: true },
      { key: "amount", label: "金額 (税込)", type: "number", required: false },
      { key: "vendor", label: "取引先", type: "text", required: false },
      { key: "date", label: "実施予定日", type: "date", required: false },
      { key: "detail", label: "詳細", type: "textarea", required: false },
    ],
  },
  {
    kind: "general",
    name: "備品購入申請",
    description: "業務で使う備品の購入を申請します",
    route: 0,
    fields: [
      { key: "item", label: "品名", type: "text", required: true },
      { key: "quantity", label: "数量", type: "number", required: true },
      { key: "amount", label: "金額 (税込)", type: "number", required: true },
      { key: "reason", label: "購入理由", type: "textarea", required: true },
    ],
  },
  {
    kind: "general",
    name: "出張申請",
    description: "出張の事前承認を申請します",
    route: 0,
    fields: [
      { key: "destination", label: "出張先", type: "text", required: true },
      { key: "start", label: "開始日", type: "date", required: true },
      { key: "end", label: "終了日", type: "date", required: true },
      { key: "purpose", label: "目的", type: "textarea", required: true },
      { key: "amount", label: "概算費用", type: "number", required: false },
    ],
  },
  {
    kind: "general",
    name: "住所・氏名変更届",
    description: "住所や氏名の変更を届け出ます",
    route: 1,
    fields: [
      { key: "change_type", label: "変更内容", type: "select", options: ["住所", "氏名", "住所と氏名"], required: true },
      { key: "effective_date", label: "変更日", type: "date", required: true },
      { key: "new_value", label: "変更後の内容", type: "textarea", required: true },
    ],
  },
];

export const DEFAULT_EXPENSE_CATEGORIES = [
  { name: "旅費交通費", account_code: "6110", tax_rate: 10, requires_receipt: 0, is_transport: 1 },
  { name: "会議費", account_code: "6120", tax_rate: 10, requires_receipt: 1, is_transport: 0 },
  { name: "交際費", account_code: "6130", tax_rate: 10, requires_receipt: 1, is_transport: 0 },
  { name: "消耗品費", account_code: "6140", tax_rate: 10, requires_receipt: 1, is_transport: 0 },
  { name: "通信費", account_code: "6150", tax_rate: 10, requires_receipt: 1, is_transport: 0 },
  { name: "新聞図書費", account_code: "6160", tax_rate: 10, requires_receipt: 1, is_transport: 0 },
  { name: "福利厚生費", account_code: "6170", tax_rate: 10, requires_receipt: 1, is_transport: 0 },
  { name: "雑費", account_code: "6190", tax_rate: 10, requires_receipt: 1, is_transport: 0 },
];

export function holidayStatements(db: D1Database, years: number[]): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = [];
  for (const y of years) {
    for (const [date, name] of NATIONAL_HOLIDAYS[y] ?? []) {
      stmts.push(db.prepare("INSERT OR IGNORE INTO holidays (date, name, kind) VALUES (?, ?, 'national')").bind(date, name));
    }
  }
  return stmts;
}

export function masterDataStatements(db: D1Database): D1PreparedStatement[] {
  const s: D1PreparedStatement[] = [];
  s.push(
    db.prepare(
      "INSERT INTO work_patterns (name, start_time, end_time, break_minutes, scheduled_minutes, work_days, is_default) VALUES ('通常勤務 (9:00-18:00)', '09:00', '18:00', 60, 480, '1,2,3,4,5', 1)",
    ),
    db.prepare(
      "INSERT INTO work_patterns (name, start_time, end_time, break_minutes, scheduled_minutes, work_days, is_default) VALUES ('時短勤務 (9:30-16:30)', '09:30', '16:30', 60, 360, '1,2,3,4,5', 0)",
    ),
  );
  DEFAULT_LEAVE_TYPES.forEach((t, i) =>
    s.push(
      db
        .prepare("INSERT INTO leave_types (name, code, is_paid, uses_annual_leave, allow_half_day, sort_order) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(t.name, t.code, t.is_paid, t.uses_annual_leave, t.allow_half_day, i),
    ),
  );
  DEFAULT_ROUTES.forEach((r, i) =>
    s.push(db.prepare("INSERT INTO approval_routes (id, name, steps, is_default) VALUES (?, ?, ?, ?)").bind(i + 1, r.name, JSON.stringify(r.steps), r.is_default)),
  );
  DEFAULT_FORMS.forEach((f, i) =>
    s.push(
      db
        .prepare("INSERT INTO request_forms (kind, name, description, fields, route_id, is_system, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(f.kind, f.name, f.description, JSON.stringify(f.fields), f.route + 1, f.kind === "general" ? 0 : 1, i),
    ),
  );
  DEFAULT_EXPENSE_CATEGORIES.forEach((c, i) =>
    s.push(
      db
        .prepare("INSERT INTO expense_categories (name, account_code, tax_rate, requires_receipt, is_transport, sort_order) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(c.name, c.account_code, c.tax_rate, c.requires_receipt, c.is_transport, i),
    ),
  );
  for (const r of DEFAULT_RATE_ROWS) {
    s.push(db.prepare("INSERT OR IGNORE INTO insurance_rates (kind, effective_from, rate, note) VALUES (?, ?, ?, ?)").bind(r.kind, r.effective_from, r.rate, r.note));
  }
  for (const [name, rank] of [["代表取締役", 100], ["部長", 50], ["課長", 40], ["主任", 20], ["メンバー", 0]] as const) {
    s.push(db.prepare("INSERT INTO positions (name, rank) VALUES (?, ?)").bind(name, rank));
  }
  s.push(...holidayStatements(db, [2025, 2026, 2027]));
  return s;
}
