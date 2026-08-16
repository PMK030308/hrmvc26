// ============================================================================
// Kết nối SQLite + định nghĩa schema (CREATE TABLE).
// Dùng better-sqlite3 (đồng bộ, đơn giản, nhanh — phù hợp demo/đồ án).
// Múi giờ VN (UTC+7): punched_at lưu TEXT naive 'YYYY-MM-DDTHH:mm:ss' (giờ VN).
// ============================================================================
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const DB_PATH = resolve(process.cwd(), 'server/data/hrm.db')
// Cho phép chạy từ trong thư mục server hoặc từ project root
const finalPath = process.cwd().endsWith('server') ? resolve('data/hrm.db') : DB_PATH
mkdirSync(dirname(finalPath), { recursive: true })

export const db = new Database(finalPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

/** Hằng số dùng chung */
export const JSON_COLS = new Set<string>([])

/** Tạo toàn bộ bảng (idempotent). */
export function initSchema(): void {
  db.exec(`
  CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    parent_id TEXT,
    manager_employee_id TEXT
  );

  CREATE TABLE IF NOT EXISTS positions (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    employee_code TEXT NOT NULL UNIQUE,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    full_name TEXT NOT NULL DEFAULT '',
    gender INTEGER NOT NULL DEFAULT 1,
    date_of_birth TEXT,
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    marital_status TEXT NOT NULL DEFAULT 'Single',
    status INTEGER NOT NULL DEFAULT 1,
    avatar_data TEXT,
    manager_id TEXT,
    department_id TEXT NOT NULL,
    position_id TEXT NOT NULL,
    branch_id TEXT,
    hire_date TEXT NOT NULL,
    work_nature INTEGER NOT NULL DEFAULT 1,
    contract_type INTEGER NOT NULL DEFAULT 1,
    wage REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (department_id) REFERENCES departments(id),
    FOREIGN KEY (position_id) REFERENCES positions(id),
    FOREIGN KEY (branch_id) REFERENCES branches(id)
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    employee_id TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    roles TEXT NOT NULL DEFAULT '[]',          -- JSON array
    permissions TEXT NOT NULL DEFAULT '[]',    -- JSON array
    department_scopes TEXT NOT NULL DEFAULT '[]', -- JSON array
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  );

  CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    break_start_time TEXT,
    break_end_time TEXT,
    check_in_window_from TEXT,
    check_in_window_to TEXT,
    check_out_window_from TEXT,
    check_out_window_to TEXT,
    late_punishment_enabled INTEGER NOT NULL DEFAULT 0,
    late_punishment_times INTEGER NOT NULL DEFAULT 0,
    late_punishment_minutes_each INTEGER NOT NULL DEFAULT 0,
    work_days REAL NOT NULL DEFAULT 1,
    is_overnight INTEGER NOT NULL DEFAULT 0,
    status INTEGER NOT NULL DEFAULT 1,
    holiday_coefficient REAL NOT NULL DEFAULT 1,
    color TEXT NOT NULL DEFAULT '#3366ff'
  );

  CREATE TABLE IF NOT EXISTS shift_schedules (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL,
    shift_id TEXT NOT NULL,
    date TEXT NOT NULL,
    rule_id TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(employee_id, date),
    FOREIGN KEY (employee_id) REFERENCES employees(id),
    FOREIGN KEY (shift_id) REFERENCES shifts(id)
  );

  CREATE TABLE IF NOT EXISTS punches (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL,
    date TEXT NOT NULL,
    punched_at TEXT NOT NULL,
    source INTEGER NOT NULL,
    device_info TEXT,
    latitude REAL,
    longitude REAL,
    accuracy REAL,
    wifi_ssid TEXT,
    notes TEXT,
    snapshot_base64 TEXT,
    attendance_record_id TEXT,
    is_check_in INTEGER NOT NULL DEFAULT 1,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  );

  CREATE TABLE IF NOT EXISTS attendance_records (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL,
    date TEXT NOT NULL,
    shift_id TEXT,
    shift_name TEXT,
    check_in_time TEXT,
    check_out_time TEXT,
    actual_work_hours REAL NOT NULL DEFAULT 0,
    work_hours REAL NOT NULL DEFAULT 0,
    late_minutes INTEGER NOT NULL DEFAULT 0,
    early_leave_minutes INTEGER NOT NULL DEFAULT 0,
    overtime_hours REAL NOT NULL DEFAULT 0,
    status INTEGER NOT NULL DEFAULT 4,
    main_status INTEGER NOT NULL DEFAULT 3,
    approval_status INTEGER NOT NULL DEFAULT 0,
    issues INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(employee_id, date),
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  );

  CREATE TABLE IF NOT EXISTS leave_types (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category INTEGER NOT NULL,
    fund_type INTEGER NOT NULL,
    max_days INTEGER,
    require_attachment INTEGER NOT NULL DEFAULT 0,
    require_reason INTEGER NOT NULL DEFAULT 1,
    day_calculation_type INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS leave_balances (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL,
    year INTEGER NOT NULL,
    leave_type_category INTEGER NOT NULL,
    leave_type_name TEXT NOT NULL,
    allocated_days REAL NOT NULL DEFAULT 0,
    used_days REAL NOT NULL DEFAULT 0,
    pending_days REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  );

  CREATE TABLE IF NOT EXISTS regulation (
    id TEXT PRIMARY KEY,
    enable_punch_face INTEGER NOT NULL DEFAULT 1,
    enable_punch_gps INTEGER NOT NULL DEFAULT 1,
    enable_punch_wifi INTEGER NOT NULL DEFAULT 1,
    enable_punch_ip INTEGER NOT NULL DEFAULT 1,
    enable_punch_qr INTEGER NOT NULL DEFAULT 1,
    require_liveness_check INTEGER NOT NULL DEFAULT 1,
    liveness_strictness INTEGER NOT NULL DEFAULT 1,
    alternative_punch_method INTEGER,
    can_employee_track_work_hours INTEGER NOT NULL DEFAULT 1,
    allow_employee_shift_registration INTEGER NOT NULL DEFAULT 1,
    allow_employee_view_detail_timesheet_daily INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS gps_catalog (
    id TEXT PRIMARY KEY, regulation_id TEXT NOT NULL, name TEXT NOT NULL,
    lat REAL NOT NULL, lng REAL NOT NULL, radius_meters INTEGER NOT NULL,
    FOREIGN KEY (regulation_id) REFERENCES regulation(id)
  );
  CREATE TABLE IF NOT EXISTS wifi_catalog (
    id TEXT PRIMARY KEY, regulation_id TEXT NOT NULL, ssid TEXT NOT NULL, bssid TEXT
  );
  CREATE TABLE IF NOT EXISTS ip_catalog (
    id TEXT PRIMARY KEY, regulation_id TEXT NOT NULL, ip_address TEXT NOT NULL, subnet_bits INTEGER NOT NULL
  );

  -- Đơn từ: bảng polymorphic (cột theo loại nullable)
  CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    employee_name TEXT NOT NULL,
    employee_code TEXT NOT NULL,
    status INTEGER NOT NULL DEFAULT 2,
    request_version INTEGER NOT NULL DEFAULT 1,
    current_level INTEGER NOT NULL DEFAULT 1,
    capabilities TEXT NOT NULL DEFAULT '{}',  -- JSON
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    -- leaves
    leave_type_id TEXT, leave_type_name TEXT,
    start_date TEXT, end_date TEXT, total_days REAL,
    -- late-earlies
    request_date TEXT, late_early_type INTEGER, requested_time TEXT, minutes INTEGER,
    -- overtimes
    ot_date TEXT, start_time TEXT, end_time TEXT, total_hours REAL, compensation_type INTEGER,
    -- business-trips
    location TEXT, purpose TEXT,
    -- shift-swaps
    shift_swap_mode INTEGER, suggested_swap_partner_id TEXT, suggested_swap_partner_name TEXT, swap_partner_status INTEGER,
    -- attendance-updates
    update_type INTEGER, new_check_in_time TEXT, new_check_out_time TEXT, new_work_hours REAL,
    -- reason (chung cho nhiều loại)
    reason TEXT,
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  );

  CREATE TABLE IF NOT EXISTS request_approvals (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    request_type TEXT NOT NULL,
    level INTEGER NOT NULL,
    approver_user_id TEXT,
    approver_name TEXT NOT NULL,
    status INTEGER NOT NULL DEFAULT 2,
    comment TEXT,
    approved_at TEXT,
    FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS request_attachments (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    data_url TEXT NOT NULL,
    uploaded_at TEXT NOT NULL,
    FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    recipient_user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type INTEGER NOT NULL DEFAULT 1,
    related_entity_type TEXT,
    related_entity_id TEXT,
    is_read INTEGER NOT NULL DEFAULT 0,
    read_at TEXT,
    link_url TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS summary_timesheets (
    id TEXT PRIMARY KEY,
    period TEXT NOT NULL UNIQUE,
    status INTEGER NOT NULL DEFAULT 2,
    from_date TEXT NOT NULL,
    to_date TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS summary_timesheet_details (
    id TEXT PRIMARY KEY,
    summary_timesheet_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    employee_name TEXT NOT NULL,
    employee_code TEXT NOT NULL,
    paid_units REAL NOT NULL DEFAULT 0,
    ot_hours REAL NOT NULL DEFAULT 0,
    late_early_count INTEGER NOT NULL DEFAULT 0,
    work_hours REAL NOT NULL DEFAULT 0,
    confirmation_status INTEGER NOT NULL DEFAULT 1,
    confirmation_comment TEXT,
    FOREIGN KEY (summary_timesheet_id) REFERENCES summary_timesheets(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS payslips (
    id TEXT PRIMARY KEY,
    period TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    employee_name TEXT NOT NULL,
    base_salary REAL NOT NULL DEFAULT 0,
    paid_work REAL NOT NULL DEFAULT 0,
    overtime REAL NOT NULL DEFAULT 0,
    allowance REAL NOT NULL DEFAULT 0,
    gross REAL NOT NULL DEFAULT 0,
    deductions REAL NOT NULL DEFAULT 0,
    net REAL NOT NULL DEFAULT 0,
    components TEXT NOT NULL DEFAULT '[]',  -- JSON array
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    action INTEGER NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT,
    detail TEXT NOT NULL,
    ip_address TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_punches_emp_date ON punches(employee_id, date);
  CREATE INDEX IF NOT EXISTS idx_records_emp_date ON attendance_records(employee_id, date);
  CREATE INDEX IF NOT EXISTS idx_schedules_emp_date ON shift_schedules(employee_id, date);
  CREATE INDEX IF NOT EXISTS idx_requests_emp ON requests(employee_id);
  CREATE INDEX IF NOT EXISTS idx_approvals_req ON request_approvals(request_id);
  CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(recipient_user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

  -- Lịch ngày lễ/tết (Điều 112 BLD 2019) — để tính hệ số OT 3x và bỏ qua làm việc
  CREATE TABLE IF NOT EXISTS holidays (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    type INTEGER NOT NULL DEFAULT 1,        -- 1 = lễ tết nhà nước, 2 = nghỉ công ty
    coefficient REAL NOT NULL DEFAULT 3.0   -- hệ số OT ngày lễ
  );
  CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);

  -- Ủy quyền duyệt: quản lý cài người ủy quyền + khoảng vắng mặt
  CREATE TABLE IF NOT EXISTS delegations (
    id TEXT PRIMARY KEY,
    delegator_user_id TEXT NOT NULL,
    delegate_user_id TEXT NOT NULL,
    from_date TEXT NOT NULL,
    to_date TEXT NOT NULL,
    reason TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (delegator_user_id) REFERENCES users(id),
    FOREIGN KEY (delegate_user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_delegations_delegator ON delegations(delegator_user_id);
  CREATE INDEX IF NOT EXISTS idx_delegations_delegate ON delegations(delegate_user_id);
  `)

  // Cột thêm vào bảng đã có (idempotent — bỏ qua nếu cột đã tồn tại).
  addColumns()
}

/** ALTER TABLE ADD COLUMN an toàn (bỏ qua lỗi "duplicate column"). */
function addColumns(): void {
  const alters: string[] = [
    `ALTER TABLE regulation ADD COLUMN duplicate_window_seconds INTEGER NOT NULL DEFAULT 60`,
    `ALTER TABLE regulation ADD COLUMN ot_monthly_cap_hours INTEGER NOT NULL DEFAULT 40`,
    `ALTER TABLE regulation ADD COLUMN ot_yearly_cap_hours INTEGER NOT NULL DEFAULT 200`,
    `ALTER TABLE regulation ADD COLUMN weekday_ot_coeff REAL NOT NULL DEFAULT 1.5`,
    `ALTER TABLE regulation ADD COLUMN weekend_ot_coeff REAL NOT NULL DEFAULT 2.0`,
    `ALTER TABLE regulation ADD COLUMN holiday_ot_coeff REAL NOT NULL DEFAULT 3.0`,
    `ALTER TABLE regulation ADD COLUMN night_coeff REAL NOT NULL DEFAULT 1.3`,
    `ALTER TABLE regulation ADD COLUMN night_ot_extra REAL NOT NULL DEFAULT 0.2`,
    `ALTER TABLE regulation ADD COLUMN standard_monthly_hours REAL NOT NULL DEFAULT 160`,
    `ALTER TABLE attendance_records ADD COLUMN ot_weekday_hours REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE attendance_records ADD COLUMN ot_weekend_hours REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE attendance_records ADD COLUMN ot_holiday_hours REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE attendance_records ADD COLUMN night_hours REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE attendance_records ADD COLUMN night_ot_hours REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE summary_timesheet_details ADD COLUMN ot_weekday_hours REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE summary_timesheet_details ADD COLUMN ot_weekend_hours REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE summary_timesheet_details ADD COLUMN ot_holiday_hours REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE summary_timesheet_details ADD COLUMN night_hours REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE summary_timesheet_details ADD COLUMN night_ot_hours REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE request_approvals ADD COLUMN on_behalf_of_user_id TEXT`,
    `ALTER TABLE request_approvals ADD COLUMN on_behalf_of_name TEXT`,
  ]
  for (const sql of alters) {
    try { db.exec(sql) } catch { /* cột đã tồn tại */ }
  }
}

/** Xoá toàn bộ dữ liệu (dùng cho reset-demo + reseed). Giữ schema. */
export function truncateAll(): void {
  db.exec(`
    DELETE FROM audit_logs; DELETE FROM payslips; DELETE FROM summary_timesheet_details;
    DELETE FROM summary_timesheets; DELETE FROM notifications; DELETE FROM request_attachments;
    DELETE FROM request_approvals; DELETE FROM requests; DELETE FROM leave_balances;
    DELETE FROM punches; DELETE FROM attendance_records; DELETE FROM shift_schedules;
    DELETE FROM ip_catalog; DELETE FROM wifi_catalog; DELETE FROM gps_catalog; DELETE FROM regulation;
    DELETE FROM leave_types; DELETE FROM shifts; DELETE FROM delegations; DELETE FROM users; DELETE FROM employees;
    DELETE FROM positions; DELETE FROM departments; DELETE FROM branches;
    DELETE FROM holidays;
  `)
}