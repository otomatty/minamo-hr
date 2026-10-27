-- ミナモ HR 初期スキーマ (Cloudflare D1 / SQLite)
-- 日時はすべて会社のローカル時刻 (JST) の ISO 文字列 'YYYY-MM-DDTHH:MM:SS' で保存する

-- ───────────── 会社・マスタ ─────────────
CREATE TABLE IF NOT EXISTS company (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  app_name TEXT NOT NULL DEFAULT 'ミナモ',
  closing_day INTEGER NOT NULL DEFAULT 0,            -- 勤怠の締め日 (0 = 末日, 1〜28)
  pay_day INTEGER NOT NULL DEFAULT 25,               -- 給与支給日 (0 = 末日)
  pay_month_offset INTEGER NOT NULL DEFAULT 1,       -- 勤怠月度から何か月後に支給するか (0 = 当月, 1 = 翌月)
  social_insurance_timing TEXT NOT NULL DEFAULT 'next', -- 社会保険料の徴収: next = 翌月徴収, current = 当月徴収
  legal_holiday_weekday INTEGER NOT NULL DEFAULT 0,  -- 法定休日の曜日 (0 = 日曜)
  week_start INTEGER NOT NULL DEFAULT 0,             -- 週40時間計算の起算曜日
  monthly_avg_hours REAL NOT NULL DEFAULT 160,       -- 月平均所定労働時間 (割増賃金の単価計算に使用)
  employment_insurance_type TEXT NOT NULL DEFAULT 'general', -- general / agriculture / construction
  overtime_alert_hours INTEGER NOT NULL DEFAULT 45,  -- 36協定の月間アラート時間
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT,
  parent_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  head_employee_id INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rank INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS work_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_time TEXT NOT NULL DEFAULT '09:00',
  end_time TEXT NOT NULL DEFAULT '18:00',
  break_minutes INTEGER NOT NULL DEFAULT 60,
  scheduled_minutes INTEGER NOT NULL DEFAULT 480,
  work_days TEXT NOT NULL DEFAULT '1,2,3,4,5',       -- 所定労働日の曜日 (0=日〜6=土)
  late_grace_minutes INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0
);

-- ───────────── 人事・従業員 ─────────────
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  last_name TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name_kana TEXT NOT NULL DEFAULT '',
  first_name_kana TEXT NOT NULL DEFAULT '',
  email TEXT,
  phone TEXT,
  birth_date TEXT,
  gender TEXT NOT NULL DEFAULT '',
  hire_date TEXT NOT NULL,
  leave_date TEXT,
  leave_reason TEXT,
  status TEXT NOT NULL DEFAULT 'active',             -- pre_hire / active / leave_of_absence / retired
  employment_type TEXT NOT NULL DEFAULT 'full_time', -- full_time / contract / part_time / temporary / executive
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  position_id INTEGER REFERENCES positions(id) ON DELETE SET NULL,
  manager_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  work_pattern_id INTEGER REFERENCES work_patterns(id) ON DELETE SET NULL,
  weekly_work_days REAL NOT NULL DEFAULT 5,
  weekly_work_hours REAL NOT NULL DEFAULT 40,
  postal_code TEXT,
  address TEXT,
  emergency_name TEXT,
  emergency_relation TEXT,
  emergency_phone TEXT,
  bank_name TEXT,
  bank_branch TEXT,
  bank_account_type TEXT,
  bank_account_number TEXT,
  bank_account_holder TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_employees_manager ON employees(manager_id);

CREATE TABLE IF NOT EXISTS dependents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_kana TEXT NOT NULL DEFAULT '',
  relationship TEXT NOT NULL,
  birth_date TEXT,
  annual_income INTEGER NOT NULL DEFAULT 0,
  is_spouse INTEGER NOT NULL DEFAULT 0,
  withholding_target INTEGER NOT NULL DEFAULT 1,     -- 源泉控除対象 (配偶者・親族)
  health_dependent INTEGER NOT NULL DEFAULT 1,       -- 健康保険の被扶養者
  disability TEXT NOT NULL DEFAULT 'none',           -- none / general / special / special_cohabiting
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dependents_employee ON dependents(employee_id);

CREATE TABLE IF NOT EXISTS personnel_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  event_date TEXT NOT NULL,
  event_type TEXT NOT NULL,                          -- hire / transfer / promotion / leave_of_absence / return / retire / other
  description TEXT NOT NULL DEFAULT '',
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_personnel_events_employee ON personnel_events(employee_id, event_date);

CREATE TABLE IF NOT EXISTS employee_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'other',
  name TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  content_type TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  uploaded_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee',             -- admin / manager / employee
  is_active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_employee ON notifications(employee_id, read_at);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  published_on TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ───────────── 勤怠 ─────────────
CREATE TABLE IF NOT EXISTS holidays (
  date TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'national'              -- national / company
);

CREATE TABLE IF NOT EXISTS punches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  punched_at TEXT NOT NULL,
  kind TEXT NOT NULL,                                -- clock_in / clock_out / break_start / break_end
  source TEXT NOT NULL DEFAULT 'web',
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_punches_employee ON punches(employee_id, punched_at);

CREATE TABLE IF NOT EXISTS attendance_days (
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  clock_in TEXT,
  clock_out TEXT,
  breaks TEXT NOT NULL DEFAULT '[]',                 -- [{"start":"...","end":"..."}]
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (employee_id, work_date)
);

CREATE TABLE IF NOT EXISTS attendance_locks (
  period TEXT PRIMARY KEY,                           -- 勤怠月度 'YYYY-MM'
  locked_at TEXT NOT NULL DEFAULT (datetime('now')),
  locked_by INTEGER
);

CREATE TABLE IF NOT EXISTS leave_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  is_paid INTEGER NOT NULL DEFAULT 1,                -- 有給 (給与控除なし) か
  uses_annual_leave INTEGER NOT NULL DEFAULT 0,      -- 年次有給休暇の残日数を消化するか
  allow_half_day INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS leave_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  granted_on TEXT NOT NULL,
  expires_on TEXT NOT NULL,                          -- この日以降は失効
  days REAL NOT NULL,
  remaining REAL NOT NULL,
  reason TEXT NOT NULL DEFAULT 'manual',             -- auto / manual / carryover
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leave_grants_employee ON leave_grants(employee_id, granted_on);

CREATE TABLE IF NOT EXISTS leave_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id INTEGER NOT NULL REFERENCES leave_types(id),
  leave_date TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'full',                 -- full / am / pm
  days REAL NOT NULL DEFAULT 1,
  request_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leave_records_employee ON leave_records(employee_id, leave_date);

CREATE TABLE IF NOT EXISTS leave_grant_usages (
  leave_record_id INTEGER NOT NULL REFERENCES leave_records(id) ON DELETE CASCADE,
  grant_id INTEGER NOT NULL REFERENCES leave_grants(id) ON DELETE CASCADE,
  days REAL NOT NULL
);

-- ───────────── ワークフロー ─────────────
CREATE TABLE IF NOT EXISTS approval_routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  steps TEXT NOT NULL DEFAULT '[]',                  -- [{"type":"manager"},{"type":"role","role":"admin"}, ...]
  is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS request_forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                                -- leave / punch_fix / overtime / expense / general
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  fields TEXT NOT NULL DEFAULT '[]',                 -- 汎用申請の入力項目定義
  route_id INTEGER REFERENCES approval_routes(id) ON DELETE SET NULL,
  is_system INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id INTEGER NOT NULL REFERENCES request_forms(id),
  kind TEXT NOT NULL,
  applicant_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',              -- draft / pending / approved / rejected / returned / withdrawn / canceled
  payload TEXT NOT NULL DEFAULT '{}',
  amount INTEGER NOT NULL DEFAULT 0,
  current_step INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT,
  decided_at TEXT,
  paid_at TEXT,                                      -- 経費: 支払済み日時
  paid_via TEXT,                                     -- 経費: payroll / transfer
  payroll_run_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_requests_applicant ON requests(applicant_id, status);
CREATE INDEX IF NOT EXISTS idx_requests_kind ON requests(kind, status);

CREATE TABLE IF NOT EXISTS request_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  step_no INTEGER NOT NULL,
  label TEXT NOT NULL,
  approver_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  approver_role TEXT,
  status TEXT NOT NULL DEFAULT 'waiting',            -- waiting / pending / approved / rejected / returned / skipped
  acted_by INTEGER,
  acted_at TEXT,
  comment TEXT
);
CREATE INDEX IF NOT EXISTS idx_request_steps_request ON request_steps(request_id, step_no);
CREATE INDEX IF NOT EXISTS idx_request_steps_approver ON request_steps(approver_id, status);

CREATE TABLE IF NOT EXISTS request_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ───────────── 経費 ─────────────
CREATE TABLE IF NOT EXISTS expense_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  account_code TEXT NOT NULL DEFAULT '',
  tax_rate INTEGER NOT NULL DEFAULT 10,
  requires_receipt INTEGER NOT NULL DEFAULT 1,
  is_transport INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS expense_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  used_on TEXT NOT NULL,
  category_id INTEGER REFERENCES expense_categories(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '',
  payee TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL,
  tax_rate INTEGER NOT NULL DEFAULT 10,
  invoice_number TEXT,
  route_from TEXT,
  route_to TEXT,
  round_trip INTEGER NOT NULL DEFAULT 0,
  receipt_key TEXT,
  receipt_name TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_expense_items_request ON expense_items(request_id);

-- ───────────── 給与 ─────────────
CREATE TABLE IF NOT EXISTS salary_settings (
  employee_id INTEGER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  pay_type TEXT NOT NULL DEFAULT 'monthly',          -- monthly / hourly / daily
  base_salary INTEGER NOT NULL DEFAULT 0,
  hourly_wage INTEGER NOT NULL DEFAULT 0,
  daily_wage INTEGER NOT NULL DEFAULT 0,
  allowances TEXT NOT NULL DEFAULT '[]',             -- [{"name":"役職手当","amount":20000,"taxable":true,"overtime_base":true}]
  commute_allowance INTEGER NOT NULL DEFAULT 0,      -- 通勤手当 (月額)
  other_deductions TEXT NOT NULL DEFAULT '[]',       -- [{"name":"社宅費","amount":10000}]
  standard_monthly_remuneration INTEGER NOT NULL DEFAULT 0, -- 標準報酬月額
  health_insurance INTEGER NOT NULL DEFAULT 1,
  pension_insurance INTEGER NOT NULL DEFAULT 1,
  employment_insurance INTEGER NOT NULL DEFAULT 1,
  care_insurance TEXT NOT NULL DEFAULT 'auto',       -- auto / yes / no
  tax_column TEXT NOT NULL DEFAULT 'kou',            -- kou (甲欄) / otsu (乙欄) / none
  tax_dependents_adjust INTEGER NOT NULL DEFAULT 0,  -- 障害者・ひとり親等の加算人数
  resident_tax_june INTEGER NOT NULL DEFAULT 0,
  resident_tax_monthly INTEGER NOT NULL DEFAULT 0,
  absence_deduction INTEGER NOT NULL DEFAULT 1,      -- 欠勤・遅刻早退控除を行うか
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS insurance_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                                -- health / care / child_support / pension / employment_employee / employment_employer
  effective_from TEXT NOT NULL,                      -- 'YYYY-MM' (社会保険は保険料の対象月、雇用保険は賃金締日の月)
  rate REAL NOT NULL,                                -- % (例: 9.85)
  note TEXT NOT NULL DEFAULT '',
  UNIQUE (kind, effective_from)
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pay_month TEXT NOT NULL UNIQUE,                    -- 支給年月 'YYYY-MM'
  pay_date TEXT NOT NULL,
  attendance_month TEXT NOT NULL,                    -- 対象の勤怠月度
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  insurance_month TEXT NOT NULL,                     -- 社会保険料の対象月
  status TEXT NOT NULL DEFAULT 'draft',              -- draft / confirmed / published
  calculated_at TEXT,
  confirmed_at TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payslips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  gross_pay INTEGER NOT NULL,
  total_deductions INTEGER NOT NULL,
  net_pay INTEGER NOT NULL,
  UNIQUE (run_id, employee_id)
);

CREATE TABLE IF NOT EXISTS payslip_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                                -- payment / deduction
  name TEXT NOT NULL,
  amount INTEGER NOT NULL,
  taxable INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
