// ============================================================================
// SEED — dữ liệu thật cho HRM Chấm công (công ty TechNova JSC, ~500 nhân sự).
// Sinh programmatic: 7 phòng ban, ca hành chính + ca sáng/chiều/đêm, 60 ngày chấm công,
// lịch lễ tết VN, OT theo luật (1.5/2/3x + đêm), đơn từ mẫu (có ủy quyền + chờ Kế toán),
// bảng công + payslip nhiều kỳ (kỳ Tết OT cao → quỹ lương tháng biến động).
// Mật khẩu demo: 123456 (bcrypt). Chạy: npm run seed.
// ============================================================================
import bcrypt from 'bcryptjs'
import { db, initSchema, truncateAll } from './db.js'
import { recomputeRecord } from './engines/attendance.js'
import { uid } from './repo.js'
import { buildPayslip } from './lib/payroll.js'
import { ymd, nowVn, addDays, timeStrToMinutes, vnIso, eachDayOfInterval, endOfMonth, halfMonthRange, isoNow, parseISO } from './lib/date.js'

const PASSWORD_HASH = bcrypt.hashSync('123456', 10)

/* ------------------------------- Tổ chức ---------------------------------- */
const branches = [
  { id: 'br-hn', name: 'Trụ sở Hà Nội', address: '123 Trần Duy Hưng, Cầu Giấy, Hà Nội' },
  { id: 'br-hcm', name: 'Chi nhánh HCM', address: '45 Nguyễn Huệ, Q.1, TP. HCM' },
]
const departments = [
  { id: 'dep-it', code: 'IT', name: 'Phòng Công nghệ', managerEmployeeId: 'emp-mgr-it' },
  { id: 'dep-sales', code: 'SALE', name: 'Phòng Kinh doanh', managerEmployeeId: 'emp-mgr-sales' },
  { id: 'dep-ops', code: 'OPS', name: 'Phòng Vận hành', managerEmployeeId: 'emp-mgr-ops' },
  { id: 'dep-cs', code: 'CS', name: 'Phòng CSKH', managerEmployeeId: 'emp-mgr-cs' },
  { id: 'dep-mkt', code: 'MKT', name: 'Phòng Marketing', managerEmployeeId: 'emp-mgr-mkt' },
  { id: 'dep-acct', code: 'ACCT', name: 'Phòng Kế toán', managerEmployeeId: 'emp-acct' },
  { id: 'dep-hr', code: 'HR', name: 'Phòng Nhân sự', managerEmployeeId: 'emp-hr' },
]
const positions = [
  { id: 'pos-dir', code: 'DIR', name: 'Giám đốc' },
  { id: 'pos-mgr', code: 'MGR', name: 'Trưởng phòng' },
  { id: 'pos-lead', code: 'LEAD', name: 'Trưởng nhóm' },
  { id: 'pos-dev', code: 'DEV', name: 'Lập trình viên' },
  { id: 'pos-sale', code: 'SALE', name: 'Nhân viên kinh doanh' },
  { id: 'pos-ops', code: 'OPS', name: 'Nhân viên vận hành' },
  { id: 'pos-cs', code: 'CS', name: 'Nhân viên CSKH' },
  { id: 'pos-mkt', code: 'MKT', name: 'Nhân viên Marketing' },
  { id: 'pos-acct', code: 'ACCT', name: 'Kế toán' },
  { id: 'pos-hr', code: 'HR', name: 'Chuyên viên Nhân sự' },
]

/* --------------------------------- Ca ------------------------------------- */
const shifts = [
  { id: 'shift-office', code: 'OFFICE', name: 'Ca hành chính', startTime: '08:00:00', endTime: '17:00:00',
    breakStartTime: '12:00:00', breakEndTime: '13:00:00', checkInWindowFrom: '07:30:00', checkInWindowTo: '08:15:00',
    checkOutWindowFrom: '16:45:00', checkOutWindowTo: '18:00:00', latePunishmentEnabled: true, latePunishmentTimes: 3,
    latePunishmentMinutesEach: 30, workDays: 1, isOvernight: false, status: 1, holidayCoefficient: 1.5, color: '#3366ff' },
  { id: 'shift-morning', code: 'MORNING', name: 'Ca sáng', startTime: '06:00:00', endTime: '14:00:00',
    breakStartTime: '10:00:00', breakEndTime: '10:30:00', checkInWindowFrom: '05:30:00', checkInWindowTo: '06:15:00',
    checkOutWindowFrom: '13:45:00', checkOutWindowTo: '14:30:00', latePunishmentEnabled: false, latePunishmentTimes: 0,
    latePunishmentMinutesEach: 0, workDays: 1, isOvernight: false, status: 1, holidayCoefficient: 1.3, color: '#10b981' },
  { id: 'shift-afternoon', code: 'AFTERNOON', name: 'Ca chiều', startTime: '14:00:00', endTime: '22:00:00',
    breakStartTime: '17:30:00', breakEndTime: '18:00:00', checkInWindowFrom: '13:30:00', checkInWindowTo: '14:15:00',
    checkOutWindowFrom: '21:45:00', checkOutWindowTo: '22:30:00', latePunishmentEnabled: false, latePunishmentTimes: 0,
    latePunishmentMinutesEach: 0, workDays: 1, isOvernight: false, status: 1, holidayCoefficient: 1.3, color: '#f59e0b' },
  { id: 'shift-night', code: 'NIGHT', name: 'Ca đêm', startTime: '22:00:00', endTime: '06:00:00',
    breakStartTime: '02:00:00', breakEndTime: '02:30:00', checkInWindowFrom: '21:30:00', checkInWindowTo: '22:15:00',
    checkOutWindowFrom: '05:45:00', checkOutWindowTo: '09:00:00', latePunishmentEnabled: false, latePunishmentTimes: 0,
    latePunishmentMinutesEach: 0, workDays: 1, isOvernight: true, status: 1, holidayCoefficient: 2.0, color: '#8b5cf6' },
]
const SHIFT_BY_KEY: Record<string, string> = { office: 'shift-office', morning: 'shift-morning', afternoon: 'shift-afternoon', night: 'shift-night' }

/* ------------------------------- Lịch lễ tết ------------------------------ */
// 11 ngày lễ tết có lương / năm (Điều 112 BLD 2019) — 2025 & 2026.
const HOLIDAYS: { date: string; name: string }[] = [
  { date: '2025-01-01', name: 'Tết Dương lịch' },
  { date: '2025-01-29', name: 'Tết Nguyên Đán' }, { date: '2025-01-30', name: 'Tết Nguyên Đán' },
  { date: '2025-01-31', name: 'Tết Nguyên Đán' }, { date: '2025-02-01', name: 'Tết Nguyên Đán' }, { date: '2025-02-02', name: 'Tết Nguyên Đán' },
  { date: '2025-04-05', name: 'Giỗ tổ Hùng Vương' },
  { date: '2025-04-30', name: 'Giải phóng miền Nam' }, { date: '2025-05-01', name: 'Quốc tế Lao động' },
  { date: '2025-09-02', name: 'Quốc khánh' },
  { date: '2026-01-01', name: 'Tết Dương lịch' },
  { date: '2026-02-17', name: 'Tết Nguyên Đán' }, { date: '2026-02-18', name: 'Tết Nguyên Đán' },
  { date: '2026-02-19', name: 'Tết Nguyên Đán' }, { date: '2026-02-20', name: 'Tết Nguyên Đán' }, { date: '2026-02-21', name: 'Tết Nguyên Đán' },
  { date: '2026-04-26', name: 'Giỗ tổ Hùng Vương' },
  { date: '2026-04-30', name: 'Giải phóng miền Nam' }, { date: '2026-05-01', name: 'Quốc tế Lao động' },
  { date: '2026-09-02', name: 'Quốc khánh' },
]

/* ------------------------------- Loại nghỉ -------------------------------- */
const leaveTypes = [
  { id: 'lt-annual', name: 'Nghỉ phép năm', category: 1, fundType: 1, maxDays: 12, requireAttachment: false, requireReason: true, dayCalculationType: 1 },
  { id: 'lt-sick', name: 'Nghỉ ốm đau', category: 4, fundType: 0, maxDays: 30, requireAttachment: true, requireReason: true, dayCalculationType: 1 },
  { id: 'lt-unpaid', name: 'Nghỉ không lương', category: 2, fundType: 0, maxDays: null, requireAttachment: false, requireReason: true, dayCalculationType: 2 },
  { id: 'lt-maternity', name: 'Nghỉ thai sản', category: 3, fundType: 0, maxDays: 180, requireAttachment: true, requireReason: false, dayCalculationType: 2 },
  { id: 'lt-comp', name: 'Nghỉ bù (OT bù)', category: 5, fundType: 2, maxDays: 10, requireAttachment: false, requireReason: true, dayCalculationType: 1 },
]

const regulation = {
  id: 'reg-1', enablePunchFace: 1, enablePunchGps: 1, enablePunchWifi: 1, enablePunchIp: 1, enablePunchQr: 1,
  requireLivenessCheck: 1, livenessStrictness: 1, alternativePunchMethod: 99, canEmployeeTrackWorkHours: 1,
  allowEmployeeShiftRegistration: 1, allowEmployeeViewDetailTimesheetDaily: 1,
  duplicateWindowSeconds: 60, otMonthlyCapHours: 40, otYearlyCapHours: 200,
  weekdayOtCoeff: 1.5, weekendOtCoeff: 2.0, holidayOtCoeff: 3.0, nightCoeff: 1.3, nightOtExtra: 0.2, standardMonthlyHours: 160,
}
const gpsCatalog = [
  { id: 'gps-1', name: 'Trụ sở HN', lat: 21.0137, lng: 105.7982, radiusMeters: 200 },
  { id: 'gps-2', name: 'Chi nhánh HCM', lat: 10.7726, lng: 106.7034, radiusMeters: 200 },
]
const wifiCatalog = [
  { id: 'wifi-1', ssid: 'TechNova-Office', bssid: 'AA:BB:CC:DD:EE:01' },
  { id: 'wifi-2', ssid: 'TechNova-Guest', bssid: null },
]
const ipCatalog = [{ id: 'ip-1', ipAddress: '203.0.113.0', subnetBits: 24 }]

/* --------------------------- Pseudo-random -------------------------------- */
function makeRand(seed: number) {
  let x = seed % 2147483647
  if (x <= 0) x += 2147483646
  return () => { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646 }
}
const pickSource = (r: () => number) => [1, 2, 3, 4, 5][Math.floor(r() * 5)]!

/* ------------------------------- Tên NV ----------------------------------- */
const FIRST_M = ['Minh', 'Nam', 'Hùng', 'Dũng', 'Long', 'Thành', 'Đạt', 'Bảo', 'Quân', 'Phong', 'Hoàng', 'Đức', 'Anh', 'Khôi', 'Phúc', 'Quý', 'Sơn', 'Tú', 'Huy', 'Vinh', 'Khang', 'Phát', 'Nghĩa', 'Trung', 'Hiếu', 'Khoa', 'Lâm', 'Phong', 'Tân', 'Việt']
const FIRST_F = ['Trang', 'Linh', 'Hoa', 'Hương', 'Mai', 'Lan', 'Yến', 'Thảo', 'Quỳnh', 'Hà', 'Phương', 'Ngân', 'Trâm', 'Hằng', 'Nhi', 'Vy', 'Thư', 'Uyên', 'Kiều', 'My', 'Giang', 'Oanh', 'Thúy', 'Diệu', 'Thy', 'Gia', 'Bích', 'Cẩm', 'Đan', 'Kim']
const LASTS = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý', 'Trịnh', 'Đinh', 'Mai', 'Trương', 'Tạ']
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase()

/* ===== Cấu hình phòng ban (headcount + vị trí + khoảng lương + ca) ===== */
const DEPT_CFG: { id: string; head: string; count: number; pos: string; wageMin: number; wageMax: number; shifts: string[] }[] = [
  { id: 'dep-it', head: 'emp-mgr-it', count: 82, pos: 'pos-dev', wageMin: 15, wageMax: 30, shifts: ['office'] },
  { id: 'dep-sales', head: 'emp-mgr-sales', count: 82, pos: 'pos-sale', wageMin: 10, wageMax: 18, shifts: ['office'] },
  { id: 'dep-ops', head: 'emp-mgr-ops', count: 80, pos: 'pos-ops', wageMin: 8, wageMax: 14, shifts: ['morning', 'afternoon', 'night', 'office'] },
  { id: 'dep-cs', head: 'emp-mgr-cs', count: 72, pos: 'pos-cs', wageMin: 8, wageMax: 12, shifts: ['morning', 'afternoon', 'night', 'office'] },
  { id: 'dep-mkt', head: 'emp-mgr-mkt', count: 56, pos: 'pos-mkt', wageMin: 10, wageMax: 17, shifts: ['office'] },
  { id: 'dep-acct', head: 'emp-acct', count: 38, pos: 'pos-acct', wageMin: 12, wageMax: 22, shifts: ['office'] },
  { id: 'dep-hr', head: 'emp-hr', count: 38, pos: 'pos-hr', wageMin: 12, wageMax: 19, shifts: ['office'] },
]

// Nhân viên "đặt tên" (lãnh đạo + demo) — phần còn lại sinh programmatic.
interface Principal { id: string; code: string; fn: string; ln: string; g: 1 | 2; email: string; dept: string; pos: string; mgr: string | null; wage: number; wn: 1 | 2; hire: string; shift: string }
const principals: Principal[] = [
  { id: 'emp-dir', code: 'NV001', fn: 'Minh Triết', ln: 'Phạm', g: 1, email: 'triet.pham@technova.vn', dept: 'dep-it', pos: 'pos-dir', mgr: null, wage: 80_000_000, wn: 1, hire: '2018-03-01', shift: 'shift-office' },
  { id: 'emp-mgr-it', code: 'NV002', fn: 'Hải Yến', ln: 'Trần', g: 2, email: 'yen.tran@technova.vn', dept: 'dep-it', pos: 'pos-mgr', mgr: 'emp-dir', wage: 45_000_000, wn: 1, hire: '2019-06-15', shift: 'shift-office' },
  { id: 'emp-mgr-sales', code: 'NV003', fn: 'Bảo Châu', ln: 'Hoàng', g: 2, email: 'chau.hoang@technova.vn', dept: 'dep-sales', pos: 'pos-mgr', mgr: 'emp-dir', wage: 40_000_000, wn: 1, hire: '2020-04-20', shift: 'shift-office' },
  { id: 'emp-mgr-ops', code: 'NV004', fn: 'Thành Đạt', ln: 'Ngô', g: 1, email: 'dat.ngo@technova.vn', dept: 'dep-ops', pos: 'pos-mgr', mgr: 'emp-dir', wage: 36_000_000, wn: 2, hire: '2020-08-01', shift: 'shift-morning' },
  { id: 'emp-mgr-cs', code: 'NV005', fn: 'Mai Linh', ln: 'Đỗ', g: 2, email: 'linh.do@technova.vn', dept: 'dep-cs', pos: 'pos-mgr', mgr: 'emp-dir', wage: 32_000_000, wn: 2, hire: '2021-01-10', shift: 'shift-afternoon' },
  { id: 'emp-mgr-mkt', code: 'NV006', fn: 'Gia Huy', ln: 'Vũ', g: 1, email: 'huy.vu@technova.vn', dept: 'dep-mkt', pos: 'pos-mgr', mgr: 'emp-dir', wage: 35_000_000, wn: 1, hire: '2020-11-15', shift: 'shift-office' },
  { id: 'emp-acct', code: 'NV007', fn: 'Quang Hùng', ln: 'Bùi', g: 1, email: 'hung.bui@technova.vn', dept: 'dep-acct', pos: 'pos-mgr', mgr: 'emp-dir', wage: 34_000_000, wn: 1, hire: '2019-09-01', shift: 'shift-office' },
  { id: 'emp-hr', code: 'NV008', fn: 'Phương Anh', ln: 'Đặng', g: 2, email: 'anh.dang@technova.vn', dept: 'dep-hr', pos: 'pos-mgr', mgr: 'emp-dir', wage: 33_000_000, wn: 1, hire: '2019-10-01', shift: 'shift-office' },
  // Demo nhân viên (đăng nhập bảo vệ)
  { id: 'emp-dev1', code: 'NV009', fn: 'Minh Khôi', ln: 'Phạm', g: 1, email: 'khoi.pham@technova.vn', dept: 'dep-it', pos: 'pos-dev', mgr: 'emp-mgr-it', wage: 24_000_000, wn: 1, hire: '2022-09-01', shift: 'shift-office' },
  { id: 'emp-dev2', code: 'NV010', fn: 'Thu Trang', ln: 'Nguyễn', g: 2, email: 'trang.nguyen@technova.vn', dept: 'dep-it', pos: 'pos-dev', mgr: 'emp-mgr-it', wage: 21_000_000, wn: 1, hire: '2023-01-10', shift: 'shift-office' },
  { id: 'emp-ops1', code: 'NV011', fn: 'Hoàng Long', ln: 'Đỗ', g: 1, email: 'long.do@technova.vn', dept: 'dep-ops', pos: 'pos-ops', mgr: 'emp-mgr-ops', wage: 13_000_000, wn: 2, hire: '2023-07-01', shift: 'shift-night' },
  { id: 'emp-cs1', code: 'NV012', fn: 'Khánh Huyền', ln: 'Trịnh', g: 2, email: 'huyen.trinh@technova.vn', dept: 'dep-cs', pos: 'pos-cs', mgr: 'emp-mgr-cs', wage: 11_000_000, wn: 2, hire: '2024-02-01', shift: 'shift-afternoon' },
]

/* ============================== HÀNH SEED ================================= */
export function seed(): void {
  initSchema()
  truncateAll()
  const now = nowVn()
  const year = now.getFullYear()
  const rng = makeRand(20260817)

  /* ---- Tổ chức ---- */
  const insBranch = db.prepare('INSERT INTO branches (id, name, address) VALUES (?,?,?)')
  branches.forEach((b) => insBranch.run(b.id, b.name, b.address))
  const insDept = db.prepare('INSERT INTO departments (id, code, name, parent_id, manager_employee_id) VALUES (?,?,?,?,?)')
  departments.forEach((d) => insDept.run(d.id, d.code, d.name, null, d.managerEmployeeId))
  const insPos = db.prepare('INSERT INTO positions (id, code, name) VALUES (?,?,?)')
  positions.forEach((p) => insPos.run(p.id, p.code, p.name))

  const insShift = db.prepare(`INSERT INTO shifts (id, code, name, start_time, end_time, break_start_time, break_end_time,
    check_in_window_from, check_in_window_to, check_out_window_from, check_out_window_to, late_punishment_enabled,
    late_punishment_times, late_punishment_minutes_each, work_days, is_overnight, status, holiday_coefficient, color)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  shifts.forEach((s) => insShift.run(s.id, s.code, s.name, s.startTime, s.endTime, s.breakStartTime, s.breakEndTime,
    s.checkInWindowFrom, s.checkInWindowTo, s.checkOutWindowFrom, s.checkOutWindowTo, s.latePunishmentEnabled ? 1 : 0,
    s.latePunishmentTimes, s.latePunishmentMinutesEach, s.workDays, s.isOvernight ? 1 : 0, s.status, s.holidayCoefficient, s.color))

  /* ---- Lịch lễ tết ---- */
  const insHol = db.prepare('INSERT OR IGNORE INTO holidays (id, date, name, type, coefficient) VALUES (?,?,?,?,3.0)')
  HOLIDAYS.forEach((h, i) => insHol.run(`hol-${h.date}`, h.date, h.name, 1))

  /* ---- Quy định + catalog ---- */
  db.prepare(`INSERT INTO regulation (id, enable_punch_face, enable_punch_gps, enable_punch_wifi, enable_punch_ip, enable_punch_qr,
    require_liveness_check, liveness_strictness, alternative_punch_method, can_employee_track_work_hours,
    allow_employee_shift_registration, allow_employee_view_detail_timesheet_daily,
    duplicate_window_seconds, ot_monthly_cap_hours, ot_yearly_cap_hours, weekday_ot_coeff, weekend_ot_coeff, holiday_ot_coeff, night_coeff, night_ot_extra, standard_monthly_hours)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    regulation.id, regulation.enablePunchFace, regulation.enablePunchGps, regulation.enablePunchWifi, regulation.enablePunchIp,
    regulation.enablePunchQr, regulation.requireLivenessCheck, regulation.livenessStrictness, regulation.alternativePunchMethod,
    regulation.canEmployeeTrackWorkHours, regulation.allowEmployeeShiftRegistration, regulation.allowEmployeeViewDetailTimesheetDaily,
    regulation.duplicateWindowSeconds, regulation.otMonthlyCapHours, regulation.otYearlyCapHours,
    regulation.weekdayOtCoeff, regulation.weekendOtCoeff, regulation.holidayOtCoeff, regulation.nightCoeff, regulation.nightOtExtra, regulation.standardMonthlyHours)
  gpsCatalog.forEach((g) => db.prepare('INSERT INTO gps_catalog (id, regulation_id, name, lat, lng, radius_meters) VALUES (?,?,?,?,?,?)').run(g.id, regulation.id, g.name, g.lat, g.lng, g.radiusMeters))
  wifiCatalog.forEach((w) => db.prepare('INSERT INTO wifi_catalog (id, regulation_id, ssid, bssid) VALUES (?,?,?,?)').run(w.id, regulation.id, w.ssid, w.bssid))
  ipCatalog.forEach((i) => db.prepare('INSERT INTO ip_catalog (id, regulation_id, ip_address, subnet_bits) VALUES (?,?,?,?)').run(i.id, regulation.id, i.ipAddress, i.subnetBits))

  const insLT = db.prepare(`INSERT INTO leave_types (id, name, category, fund_type, max_days, require_attachment, require_reason, day_calculation_type) VALUES (?,?,?,?,?,?,?,?)`)
  leaveTypes.forEach((l) => insLT.run(l.id, l.name, l.category, l.fundType, l.maxDays, l.requireAttachment ? 1 : 0, l.requireReason ? 1 : 0, l.dayCalculationType))

  /* ---- Sinh nhân viên (principals + programmatic ~500) ---- */
  const insEmp = db.prepare(`INSERT INTO employees (id, employee_code, first_name, last_name, full_name, gender, date_of_birth,
    email, phone, address, marital_status, status, avatar_data, manager_id, department_id, position_id, branch_id,
    hire_date, work_nature, contract_type, wage, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  const insUser = db.prepare(`INSERT INTO users (id, email, employee_id, password_hash, roles, permissions, department_scopes, created_at) VALUES (?,?,?,?,?,?,?,?)`)
  const insLB = db.prepare(`INSERT INTO leave_balances (id, employee_id, year, leave_type_category, leave_type_name, allocated_days, used_days, pending_days) VALUES (?,?,?,?,?,?,?,?)`)

  type Emp = { id: string; code: string; fn: string; ln: string; g: 1 | 2; email: string; dept: string; pos: string; mgr: string | null; wage: number; wn: 1 | 2; hire: string; shift: string; roles: string[] }
  const allEmps: Emp[] = []

  // principals
  for (const p of principals) {
    const roles = p.id === 'emp-dir' ? ['Director'] : p.pos === 'pos-mgr' ? (p.id === 'emp-hr' ? ['HR', 'Manager'] : p.id === 'emp-acct' ? ['Accountant', 'Manager'] : ['Manager']) : ['Employee']
    allEmps.push({ ...p, roles })
  }

  // Sinh team leads + nhân viên cho mỗi phòng
  let codeSeq = 13
  const hireYears = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]
  for (const cfg of DEPT_CFG) {
    // Tạo team leads (1 / ~22 NV) — manager = trưởng phòng
    const leadCount = Math.max(1, Math.ceil(cfg.count / 22))
    const leads: string[] = []
    for (let l = 0; l < leadCount; l++) {
      const code = `NV${String(codeSeq++).padStart(4, '0')}`
      const g: 1 | 2 = rng() < 0.5 ? 1 : 2
      const fn = (g === 1 ? FIRST_M : FIRST_F)[Math.floor(rng() * 30)]!
      const ln = LASTS[Math.floor(rng() * 20)]!
      const id = `emp-${code.toLowerCase()}`
      const wage = Math.round((cfg.wageMax * 1.15 + 2) * 1_000_000)
      const email = `${slug(fn)}.${slug(ln)}${codeSeq}@technova.vn`
      leads.push(id)
      allEmps.push({ id, code, fn, ln, g, email, dept: cfg.id, pos: 'pos-lead', mgr: cfg.head, wage, wn: cfg.shifts[0] === 'office' ? 1 : 2, hire: `${hireYears[Math.floor(rng() * 8)]}-0${1 + Math.floor(rng() * 9)}-1${Math.floor(rng() * 9)}`, shift: SHIFT_BY_KEY[cfg.shifts[0]!], roles: ['Employee'] })
    }
    // Nhân viên thường
    for (let i = 0; i < cfg.count; i++) {
      const code = `NV${String(codeSeq++).padStart(4, '0')}`
      const g: 1 | 2 = rng() < 0.5 ? 1 : 2
      const fn = (g === 1 ? FIRST_M : FIRST_F)[Math.floor(rng() * 30)]!
      const ln = LASTS[Math.floor(rng() * 20)]!
      const id = `emp-${code.toLowerCase()}`
      const wage = Math.round((cfg.wageMin + rng() * (cfg.wageMax - cfg.wageMin)) * 1_000_000)
      const shiftKey = cfg.shifts[Math.floor(rng() * cfg.shifts.length)]!
      // 60% NV dưới team lead, 40% dưới trưởng phòng
      const mgr = rng() < 0.6 ? leads[i % leads.length]! : cfg.head
      const hireY = hireYears[Math.floor(rng() * 8)]
      const email = `${slug(fn)}.${slug(ln)}${codeSeq}@technova.vn`
      allEmps.push({ id, code, fn, ln, g, email, dept: cfg.id, pos: cfg.pos, mgr, wage, wn: shiftKey === 'office' ? 1 : 2, hire: `${hireY}-0${1 + Math.floor(rng() * 9)}-1${Math.floor(rng() * 9)}`, shift: SHIFT_BY_KEY[shiftKey], roles: ['Employee'] })
    }
  }

  const ALL_PERMS = ['View', 'Create', 'Edit', 'Delete', 'Export', 'Approve']
  const insertEmpRow = (e: Emp) => insEmp.run(e.id, e.code, e.fn, e.ln, `${e.ln} ${e.fn}`.trim(), e.g, null, e.email,
    `090${Math.floor(rng() * 9_000_000 + 1_000_000)}`, 'Hà Nội', rng() < 0.4 ? 'Married' : 'Single', 2, null, e.mgr, e.dept, e.pos, 'br-hn', e.hire, e.wn, e.hire < '2023' ? 2 : 1, e.wage, isoNow())
  const insertUserRow = (e: Emp) => {
    const roles = e.roles
    const perms = roles.includes('Admin') ? ALL_PERMS : roles.includes('Director') ? ['View', 'Approve', 'Export'] : roles.includes('HR') ? ['View', 'Create', 'Edit', 'Approve', 'Export'] : roles.includes('Accountant') ? ['View', 'Edit', 'Approve', 'Export'] : roles.includes('Manager') ? ['View', 'Create', 'Approve'] : ['View', 'Create']
    const deptScopes = roles.includes('Manager') ? [e.dept] : []
    const userId = roles.some((r) => r !== 'Employee') ? `usr-${e.id.replace('emp-', '')}` : `usr-${e.id.replace('emp-', '')}`
    insUser.run(userId, e.email, e.id, PASSWORD_HASH, JSON.stringify(roles), JSON.stringify(perms), JSON.stringify(deptScopes), isoNow())
  }

  // Insert tất cả NV + user + quỹ phép trong transaction
  const fillEmps = db.transaction(() => {
    for (const e of allEmps) {
      insertEmpRow(e)
      insertUserRow(e)
      insLB.run(uid('lb'), e.id, year, 1, 'Phép năm', 12, 1 + Math.floor(rng() * 4), 0)
      insLB.run(uid('lb'), e.id, year, 5, 'Phép bù', 4, 0, 0)
    }
    // Tài khoản admin tổng (gắn vào emp-hr)
    insUser.run('usr-admin', 'admin@technova.vn', 'emp-hr', PASSWORD_HASH, JSON.stringify(['Admin']), JSON.stringify(ALL_PERMS), '[]', isoNow())
  })
  fillEmps()

  /* ---- Phân ca + chấm công 60 ngày ---- */
  const insSched = db.prepare('INSERT OR REPLACE INTO shift_schedules (id, employee_id, shift_id, date, rule_id, is_active) VALUES (?,?,?,?,NULL,1)')
  const insPunch = db.prepare(`INSERT INTO punches (id, employee_id, date, punched_at, source, device_info, latitude, longitude,
    accuracy, wifi_ssid, notes, snapshot_base64, attendance_record_id, is_check_in, is_active, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)

  const holidaySet = new Set(HOLIDAYS.map((h) => h.date))
  // OT plans: empId -> { weekday:[offsets], weekend:[offsets] }
  const otWeekday: Record<string, number[]> = {}
  const otWeekend: Record<string, number[]> = {}
  const leaveDays: Record<string, number[]> = {}
  const absentDays: Record<string, number[]> = {}

  // Chọn ngẫu nhiên các NV có OT / nghỉ / vắng
  const pool = allEmps.filter((e) => !['emp-dir', 'emp-mgr-it', 'emp-mgr-sales', 'emp-mgr-ops', 'emp-mgr-cs', 'emp-mgr-mkt', 'emp-acct', 'emp-hr'].includes(e.id))
  const shuffle = <T,>(arr: T[]) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j]!, arr[i]!] } return arr }
  const otWeekdayEmps = shuffle(pool.slice()).slice(0, 40)   // OT ngày thường (1.5x)
  const otWeekendEmps = shuffle(pool.slice()).slice(0, 20)   // OT cuối tuần (2x)
  const leaveEmps = shuffle(pool.slice()).slice(0, 30)
  const absentEmps = shuffle(pool.slice()).slice(0, 15)
  otWeekdayEmps.forEach((e, i) => { otWeekday[e.id] = [10 + (i % 40), 25 + (i % 20)] })
  otWeekendEmps.forEach((e, i) => { otWeekend[e.id] = [6 + (i % 7)] })   // các thứ 7 gần đây
  leaveEmps.forEach((e, i) => { leaveDays[e.id] = [5 + (i % 40)] })
  absentEmps.forEach((e, i) => { absentDays[e.id] = [12 + (i % 30)] })

  const seedRun = makeRand(99991)
  const fillPunches = db.transaction(() => {
    for (let i = 59; i >= 0; i--) {
      const d = addDays(now, -i)
      const date = ymd(d)
      const dow = d.getDay()
      const isSat = dow === 6, isSun = dow === 0
      if (holidaySet.has(date)) continue // nghỉ lễ

      for (const e of allEmps) {
        if (e.id === 'emp-dir') { if (i < 50) { insSched.run(uid('sch'), e.id, e.shift, date); const s = shifts.find((x) => x.id === e.shift)!; insPunch.run(uid('p'), e.id, date, makeIso(d, timeStrToMinutes(s.startTime)!), 1, 'Máy chấm công', 21.0137, 105.7982, 18, 'TechNova-Office', null, null, null, 1, 1, isoNow()); insPunch.run(uid('p'), e.id, date, makeIso(d, timeStrToMinutes(s.endTime)!), 1, 'Máy chấm công', 21.0137, 105.7982, 18, 'TechNova-Office', null, null, null, 0, 1, isoNow()) } continue }

        const isNight = e.shift === 'shift-night'
        const isOffice = e.shift === 'shift-office'
        // Văn phòng: T2–T6 (nghỉ T7,CN). Ca: làm 6 ngày, nghỉ luân phiên 1 ngày.
        if (isOffice && (isSat || isSun)) {
          // OT cuối tuần cho một số NV (không có ca → toàn OT 2x)
          if (isSat && otWeekend[e.id]?.includes(i)) {
            const r = makeRand(seedRun() * 2147483647 + 7)
            const cinMin = 8 * 60 + Math.floor(r() * 30)
            const coutMin = 12 * 60 + Math.floor(r() * 60)
            insPunch.run(uid('p'), e.id, date, makeIso(d, cinMin), 1, 'Máy chấm công', 21.0137, 105.7982, 18, 'TechNova-Office', null, null, null, 1, 1, isoNow())
            insPunch.run(uid('p'), e.id, date, makeIso(d, coutMin), 1, 'Máy chấm công', 21.0137, 105.7982, 18, 'TechNova-Office', null, null, null, 0, 1, isoNow())
          }
          continue
        }
        if (!isOffice && !isNight) {
          // Ca sáng/chiều: nghỉ 1 ngày/tuần luân phiên (dựa mã NV)
          const off = (e.code.charCodeAt(e.code.length - 1) + dow) % 7 === 0
          if (isSun || off) continue
        }
        if (isNight) {
          // Ca đêm: nghỉ Chủ nhật
          if (isSun) continue
        }

        const leaveOff = leaveDays[e.id]?.includes(i)
        const absentOff = absentDays[e.id]?.includes(i)
        if (i === 0) { insSched.run(uid('sch'), e.id, e.shift, date); continue } // hôm nay để tự chấm
        insSched.run(uid('sch'), e.id, e.shift, date)
        if (leaveOff || absentOff) continue // có ca nhưng không chấm → vắng

        const shift = shifts.find((s) => s.id === e.shift)!
        const r = makeRand(seedRun() * 2147483647 + e.id.length * 31 + i * 7)
        const startMin = timeStrToMinutes(shift.startTime)!
        const endMin = timeStrToMinutes(shift.endTime)!
        const lateRoll = r()
        const lateMin = lateRoll < 0.12 ? Math.floor(r() * 18) + 8 : lateRoll < 0.4 ? Math.floor(r() * 6) : 0
        const earlyRoll = r()
        const earlyMin = earlyRoll < 0.08 ? Math.floor(r() * 25) + 5 : earlyRoll < 0.25 ? Math.floor(r() * 8) : 0
        const otApproved = isOffice && otWeekday[e.id]?.includes(i)
        const otMin = otApproved ? Math.floor(r() * 90) + 60 : 0

        const cinMin = startMin + lateMin
        const coutMin = endMin - earlyMin + otMin
        insPunch.run(uid('p'), e.id, date, makeIso(d, cinMin, isNight, startMin), pickSource(r), 'Web', 21.0137, 105.7982, 18, 'TechNova-Office', null, null, null, 1, 1, isoNow())
        insPunch.run(uid('p'), e.id, date, makeIso(d, coutMin, isNight, startMin), pickSource(r), 'Web', 21.0137, 105.7982, 18, 'TechNova-Office', null, null, null, 0, 1, isoNow())
      }
    }
  })
  fillPunches()

  // minOfDay = phút từ 0h của ngày bắt đầu ca. Ca qua 0h (overnight): nếu giờ < startMin
  // thì thực chất là ngày hôm sau → cộng 1440 phút để setMinutes tự cuộn sang hôm sau.
  function makeIso(d: Date, minOfDay: number, isOvernight = false, startMin = 0): string {
    const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0)
    let m = minOfDay
    if (isOvernight && m < startMin) m += 1440
    dt.setMinutes(m)
    return vnIso(dt)
  }

  /* ---- Đơn OT approved cho các ngày đã chấm OT ---- */
  const insReq = db.prepare(`INSERT INTO requests (id, type, employee_id, employee_name, employee_code, status, request_version,
    current_level, capabilities, created_at, updated_at, leave_type_id, leave_type_name, start_date, end_date, total_days,
    reason, request_date, late_early_type, requested_time, minutes, ot_date, start_time, end_time, total_hours,
    compensation_type, location, purpose, shift_swap_mode, suggested_swap_partner_id, suggested_swap_partner_name,
    swap_partner_status, update_type, new_check_in_time, new_check_out_time, new_work_hours) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  const insAppr = db.prepare(`INSERT INTO request_approvals (id, request_id, request_type, level, approver_user_id, approver_name, status, comment, approved_at, on_behalf_of_user_id, on_behalf_of_name) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
  const empName = (id: string) => { const e = allEmps.find((x) => x.id === id)!; return `${e.ln} ${e.fn}`.trim() }
  const empCode = (id: string) => allEmps.find((x) => x.id === id)!.code
  const userIdOf = (id: string) => `usr-${id.replace('emp-', '')}`

  const fillOtReqs = db.transaction(() => {
    for (const [empId, offsets] of Object.entries(otWeekday)) {
      for (const off of offsets) {
        const otDate = ymd(addDays(now, -off))
        const otId = uid('req')
        insReq.run(otId, 'overtimes', empId, empName(empId), empCode(empId), 3, 3, 3,
          JSON.stringify({ canEdit: false, canCancel: false, canRespond: false }), isoNow(), isoNow(),
          null, null, null, null, null, 'Làm thêm xử lý gấp dự án', null, null, null, null, otDate, '17:00', '19:00', 2, 1, null, null, null, null, null, null, null, null, null, null)
        insAppr.run(uid('ap'), otId, 'overtimes', 1, userIdOf(empId) === 'usr-dev1' ? 'usr-mgr-it' : userIdOf(allEmps.find((x) => x.id === empId)!.mgr ?? 'emp-dir'), 'Trưởng phòng', 3, 'Đồng ý', isoNow(), null, null)
      }
    }
    for (const [empId, offsets] of Object.entries(otWeekend)) {
      for (const off of offsets) {
        const otDate = ymd(addDays(now, -off))
        const otId = uid('req')
        insReq.run(otId, 'overtimes', empId, empName(empId), empCode(empId), 3, 3, 3,
          JSON.stringify({ canEdit: false, canCancel: false, canRespond: false }), isoNow(), isoNow(),
          null, null, null, null, null, 'Làm thêm cuối tuần', null, null, null, null, otDate, '08:00', '12:00', 4, 1, null, null, null, null, null, null, null, null, null, null)
        insAppr.run(uid('ap'), otId, 'overtimes', 1, 'usr-mgr-it', 'Trưởng phòng', 3, 'Đồng ý', isoNow(), null, null)
      }
    }
  })
  fillOtReqs()

  /* ---- Tính lại bản ghi từ punches ---- */
  const recompute = db.transaction(() => {
    for (const e of allEmps) {
      const dates = (db.prepare('SELECT DISTINCT date FROM punches WHERE employee_id=?').all(e.id) as any[]).map((r) => r.date)
      for (const d of dates) recomputeRecord(e.id, d)
      const schedDates = (db.prepare('SELECT date FROM shift_schedules WHERE employee_id=? AND is_active=1').all(e.id) as any[]).map((r) => r.date)
      for (const d of schedDates) if (!dates.includes(d)) recomputeRecord(e.id, d)
    }
  })
  recompute()

  /* ---- Đơn từ mẫu (nhiều trạng thái + ủy quyền + chờ Kế toán) ---- */
  const lv1Start = ymd(addDays(now, -20))
  const lv1Id = uid('req')
  insReq.run(lv1Id, 'leaves', 'emp-dev1', empName('emp-dev1'), empCode('emp-dev1'), 3, 2, 2,
    JSON.stringify({ canEdit: false, canCancel: false, canRespond: false }), isoNow(), isoNow(),
    'lt-annual', 'Nghỉ phép năm', lv1Start, lv1Start, 1, 'Việc gia đình', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null)
  insAppr.run(uid('ap'), lv1Id, 'leaves', 1, 'usr-mgr-it', 'Trần Hải Yến', 3, 'Đồng ý', isoNow(), null, null)
  insAppr.run(uid('ap'), lv1Id, 'leaves', 2, 'usr-mgr-it', 'Trần Hải Yến', 3, 'Cùng người duyệt — gộp cấp', isoNow(), null, null)

  // Đơn nghỉ >3 ngày (approved + tham vấn Giám đốc)
  const lv2Start = ymd(addDays(now, -16)), lv2End = ymd(addDays(now, -13))
  const lv2Id = uid('req')
  insReq.run(lv2Id, 'leaves', 'emp-dev2', empName('emp-dev2'), empCode('emp-dev2'), 3, 2, 2,
    JSON.stringify({ canEdit: false, canCancel: false, canRespond: false }), isoNow(), isoNow(),
    'lt-annual', 'Nghỉ phép năm', lv2Start, lv2End, 4, 'Du lịch gia đình', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null)
  insAppr.run(uid('ap'), lv2Id, 'leaves', 1, 'usr-mgr-it', 'Trần Hải Yến', 3, 'Đồng ý', isoNow(), null, null)
  insAppr.run(uid('ap'), lv2Id, 'leaves', 2, 'usr-mgr-it', 'Trần Hải Yến', 3, 'Cùng người duyệt', isoNow(), null, null)
  insAppr.run(uid('ap'), lv2Id, 'leaves', 99, 'usr-dir', 'triet.pham@technova.vn', 5, 'Tham vấn Giám đốc (thông báo, không chặn)', isoNow(), null, null)

  // Đơn nghỉ pending (chờ trưởng phòng)
  const lv3Start = ymd(addDays(now, 3)), lv3End = ymd(addDays(now, 4))
  const lv3Id = uid('req')
  insReq.run(lv3Id, 'leaves', 'emp-ops1', empName('emp-ops1'), empCode('emp-ops1'), 2, 1, 1,
    JSON.stringify({ canEdit: true, canCancel: true, canRespond: false }), isoNow(), isoNow(),
    'lt-annual', 'Nghỉ phép năm', lv3Start, lv3End, 2, 'Việc cá nhân', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null)
  insAppr.run(uid('ap'), lv3Id, 'leaves', 1, 'usr-mgr-ops', 'Ngô Thành Đạt', 2, null, null, null, null)

  // Đơn OT pending ở cấp Kế toán (đã qua quản lý + trưởng phòng)
  const otPending = uid('req')
  insReq.run(otPending, 'overtimes', 'emp-cs1', empName('emp-cs1'), empCode('emp-cs1'), 2, 2, 3,
    JSON.stringify({ canEdit: false, canCancel: true, canRespond: false }), isoNow(), isoNow(),
    null, null, null, null, null, 'Làm thêm ca lễ', null, null, null, null, ymd(addDays(now, 2)), '18:00', '22:00', 4, 1, null, null, null, null, null, null, null, null, null, null)
  insAppr.run(uid('ap'), otPending, 'overtimes', 1, 'usr-mgr-cs', 'Đỗ Mai Linh', 3, 'Đồng ý', isoNow(), null, null)
  insAppr.run(uid('ap'), otPending, 'overtimes', 2, 'usr-mgr-cs', 'Đỗ Mai Linh', 3, 'Cùng người duyệt', isoNow(), null, null)
  insAppr.run(uid('ap'), otPending, 'overtimes', 3, 'usr-acct', 'Bùi Quang Hùng', 2, null, null, null, null)

  // Đơn công tác pending ở cấp Kế toán
  const btPending = uid('req')
  insReq.run(btPending, 'business-trips', 'emp-dev1', empName('emp-dev1'), empCode('emp-dev1'), 2, 2, 3,
    JSON.stringify({ canEdit: false, canCancel: true, canRespond: false }), isoNow(), isoNow(),
    null, null, ymd(addDays(now, 5)), ymd(addDays(now, 7)), 3, null, null, null, null, null, null, null, null, null, null, 'Đà Nẵng', 'Gặp đối tác', null, null, null, null, null, null, null, null)
  insAppr.run(uid('ap'), btPending, 'business-trips', 1, 'usr-mgr-it', 'Trần Hải Yến', 3, 'Đồng ý', isoNow(), null, null)
  insAppr.run(uid('ap'), btPending, 'business-trips', 2, 'usr-mgr-it', 'Trần Hải Yến', 3, 'Cùng người duyệt', isoNow(), null, null)
  insAppr.run(uid('ap'), btPending, 'business-trips', 3, 'usr-acct', 'Bùi Quang Hùng', 2, null, null, null, null)

  // Đơn cập nhật công pending ở cấp Kế toán (qua quản lý + HR)
  const auPending = uid('req')
  insReq.run(auPending, 'attendance-updates', 'emp-ops1', empName('emp-ops1'), empCode('emp-ops1'), 2, 2, 3,
    JSON.stringify({ canEdit: false, canCancel: true, canRespond: false }), isoNow(), isoNow(),
    null, null, null, null, null, 'Quên chấm ra', ymd(addDays(now, -3)), null, null, null, null, null, null, null, null, null, null, null, null, null, null, 2, null, '17:00', 8)
  insAppr.run(uid('ap'), auPending, 'attendance-updates', 1, 'usr-mgr-ops', 'Ngô Thành Đạt', 3, 'Xác nhận', isoNow(), null, null)
  insAppr.run(uid('ap'), auPending, 'attendance-updates', 2, 'usr-hr', 'Đặng Phương Anh', 3, 'HR xác nhận', isoNow(), null, null)
  insAppr.run(uid('ap'), auPending, 'attendance-updates', 3, 'usr-acct', 'Bùi Quang Hùng', 2, null, null, null, null)

  // Đơn muộn/sớm approved
  const leId = uid('req')
  insReq.run(leId, 'late-earlies', 'emp-cs1', empName('emp-cs1'), empCode('emp-cs1'), 3, 2, 2,
    JSON.stringify({ canEdit: false, canCancel: false, canRespond: false }), isoNow(), isoNow(),
    null, null, null, null, null, 'Tắc đường', ymd(addDays(now, -7)), 1, '14:30', 30, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null)
  insAppr.run(uid('ap'), leId, 'late-earlies', 1, 'usr-mgr-cs', 'Đỗ Mai Linh', 3, 'Đồng ý', isoNow(), null, null)
  insAppr.run(uid('ap'), leId, 'late-earlies', 2, 'usr-mgr-cs', 'Đỗ Mai Linh', 3, 'Cùng người duyệt', isoNow(), null, null)

  /* ---- Ủy quyền mẫu: trưởng phòng IT ủy quyền cho HR trong 7 ngày qua → 7 ngày tới ---- */
  const dlgFrom = ymd(addDays(now, -7)), dlgTo = ymd(addDays(now, 7))
  db.prepare(`INSERT INTO delegations (id, delegator_user_id, delegate_user_id, from_date, to_date, reason, is_active, created_at) VALUES (?,?,?,?,?,?,1,?)`)
    .run('dlg-seed', 'usr-mgr-it', 'usr-hr', dlgFrom, dlgTo, 'Trưởng phòng IT đi công tác — ủy quyền HR duyệt tạm', isoNow())

  /* ---- Bảng công + payslip: kỳ thực (gần đây) + kỳ fabricated (Tết OT cao) ---- */
  // Kỳ thực từ records
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  seedSummaryAndPayrollFromRecords(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 1)
  seedSummaryAndPayrollFromRecords(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 2)
  if (now.getDate() > 15) seedSummaryAndPayrollFromRecords(now.getFullYear(), now.getMonth() + 1, 1)
  // Kỳ fabricated cho biểu đồ so sánh tháng (Tết = OT lễ cao → quỹ lương cao)
  seedFabricatedPayroll(2026, 2, 1, { holiday: 6, weekend: 4, weekday: 6 })   // Tết H1
  seedFabricatedPayroll(2026, 2, 2, { holiday: 4, weekend: 3, weekday: 5 })   // Tết H2
  seedFabricatedPayroll(2026, 3, 1, { holiday: 0, weekend: 2, weekday: 4 })
  seedFabricatedPayroll(2026, 4, 1, { holiday: 3, weekend: 2, weekday: 4 })   // Giỗ tổ + 30/4 + 1/5
  seedFabricatedPayroll(2026, 5, 1, { holiday: 1, weekend: 2, weekday: 5 })
  seedFabricatedPayroll(2026, 6, 1, { holiday: 0, weekend: 1, weekday: 3 })

  /* ---- Notifications + audit ---- */
  const insNotif = db.prepare(`INSERT INTO notifications (id, recipient_user_id, title, message, type, related_entity_type, related_entity_id, is_read, read_at, link_url, created_at) VALUES (?,?,?,?,?,?,?,0,NULL,?,?)`)
  insNotif.run(uid('nt'), 'usr-mgr-it', 'Có đơn mới chờ duyệt', `${empName('emp-ops1')} gửi đơn nghỉ phép cần bạn duyệt.`, 6, 'request', lv3Id, `/employee/requests/leaves/${lv3Id}`, isoNow())
  insNotif.run(uid('nt'), 'usr-acct', 'Đơn chờ Kế toán duyệt', `Có đơn OT và đơn công tác đang chờ bạn duyệt (cấp Kế toán).`, 6, 'request', otPending, `/employee/requests/overtimes/${otPending}`, isoNow())
  insNotif.run(uid('nt'), 'usr-hr', 'Bạn được ủy quyền duyệt đơn', `Trưởng phòng IT đã ủy quyền bạn duyệt đơn từ ${dlgFrom} đến ${dlgTo}.`, 6, 'delegation', 'dlg-seed', null, isoNow())
  insNotif.run(uid('nt'), 'usr-dev1', 'Đơn được duyệt', `Đơn nghỉ phép của bạn đã được duyệt hoàn toàn.`, 3, 'request', lv1Id, `/employee/requests/leaves/${lv1Id}`, isoNow())
  insNotif.run(uid('nt'), 'usr-admin', 'Tổng hợp hệ thống', `Đã có ${allEmps.length} nhân viên đang làm việc. Tỷ lệ đúng giờ 7 ngày qua ổn định.`, 1, null, null, null, isoNow())

  const insAud = db.prepare(`INSERT INTO audit_logs (id, user_id, user_name, action, entity, entity_id, detail, ip_address, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
  const auditSeed: [string, number, string, string | null, string][] = [
    ['usr-admin', 4, 'session', null, 'Đăng nhập hệ thống'],
    ['usr-admin', 1, 'Employee', null, 'Khởi tạo dữ liệu 500 nhân viên'],
    ['usr-hr', 2, 'Regulation', null, 'Cập nhật quy định chấm công + hệ số OT theo BLD 2019'],
    ['usr-mgr-it', 2, 'Request', lv1Id, 'Duyệt đơn leaves (cấp 1)'],
    ['usr-acct', 2, 'Request', otPending, 'Duyệt đơn overtimes (cấp Kế toán)'],
    ['usr-dir', 2, 'Payroll', null, 'Duyệt kỳ lương 2026071'],
  ]
  auditSeed.forEach(([u, act, ent, eid, det]) => insAud.run(`aud-${uid(u)}`, u, u, act, ent, eid, det, '127.0.0.1', isoNow()))

  console.log(`\n  🌱 Seed hoàn tất: ${allEmps.length} NV, ${HOLIDAYS.length} ngày lễ, 60 ngày chấm công, đơn từ + ủy quyền + payslip nhiều kỳ.`)
  console.log(`     File DB: data/hrm.db`)
  console.log(`     Admin: admin@technova.vn / 123456 | Giám đốc: triet.pham@technova.vn | NV: khoi.pham@technova.vn\n`)
}

/* -------- Payslip từ attendance_records thực (kỳ gần đây) -------- */
function seedSummaryAndPayrollFromRecords(year: number, month: number, half: 1 | 2): void {
  const rng = halfMonthRange(year, month, half)
  const from = ymd(rng.from), to = ymd(rng.to)
  const period = `${year}${String(month).padStart(2, '0')}${half}`
  if (getSummaryByPeriodLocal(period)) return
  const stId = uid('st')
  db.prepare('INSERT INTO summary_timesheets (id, period, status, from_date, to_date) VALUES (?,?,?,?,?)').run(stId, period, 4, from, to)
  const emps = (db.prepare('SELECT * FROM employees WHERE status=2').all() as any[])
  for (const e of emps) {
    const recs = (db.prepare('SELECT * FROM attendance_records WHERE employee_id=? AND date>=? AND date<=?').all(e.id, from, to) as any[])
    const paidUnits = recs.reduce((s, r) => s + (r.status === 4 ? 0 : r.work_hours), 0)
    const otHours = recs.reduce((s, r) => s + r.overtime_hours, 0)
    const breakdown = {
      otWeekday: recs.reduce((s, r) => s + (r.ot_weekday_hours ?? 0), 0),
      otWeekend: recs.reduce((s, r) => s + (r.ot_weekend_hours ?? 0), 0),
      otHoliday: recs.reduce((s, r) => s + (r.ot_holiday_hours ?? 0), 0),
      night: recs.reduce((s, r) => s + (r.night_hours ?? 0), 0),
      nightOt: recs.reduce((s, r) => s + (r.night_ot_hours ?? 0), 0),
    }
    db.prepare(`INSERT INTO summary_timesheet_details (id, summary_timesheet_id, employee_id, employee_name, employee_code,
      paid_units, ot_hours, late_early_count, work_hours, ot_weekday_hours, ot_weekend_hours, ot_holiday_hours, night_hours, night_ot_hours,
      confirmation_status, confirmation_comment) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,3,NULL)`).run(
      uid('std'), stId, e.id, e.full_name, e.employee_code, paidUnits, otHours,
      recs.filter((r) => r.late_minutes > 0 || r.early_leave_minutes > 0).length,
      recs.reduce((s, r) => s + r.actual_work_hours, 0),
      breakdown.otWeekday, breakdown.otWeekend, breakdown.otHoliday, breakdown.night, breakdown.nightOt)
    const slip = buildPayslip({ monthlyWage: e.wage, paidUnits, actualWorkHours: recs.reduce((s, r) => s + r.actual_work_hours, 0), breakdown })
    db.prepare(`INSERT INTO payslips (id, period, employee_id, employee_name, base_salary, paid_work, overtime, allowance, gross, deductions, net, components) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(uid('ps'), period, e.id, e.full_name, slip.base, slip.paidWork, slip.overtime, slip.allowance, slip.gross, slip.deductions, slip.net, JSON.stringify(slip.components))
  }
}

/* -------- Payslip fabricated (kỳ cũ — cho biểu đồ so sánh tháng) -------- */
function seedFabricatedPayroll(year: number, month: number, half: 1 | 2, ot: { holiday: number; weekend: number; weekday: number }): void {
  const rng = halfMonthRange(year, month, half)
  const period = `${year}${String(month).padStart(2, '0')}${half}`
  if (getSummaryByPeriodLocal(period)) return
  const stId = uid('st')
  db.prepare('INSERT INTO summary_timesheets (id, period, status, from_date, to_date) VALUES (?,?,?,?,?)').run(stId, period, 4, ymd(rng.from), ymd(rng.to))
  const rand = makeRand(year * 100 + month * 10 + half)
  const emps = (db.prepare('SELECT * FROM employees WHERE status=2').all() as any[])
  for (const e of emps) {
    const paidUnits = 9 + Math.floor(rand() * 5)         // ~9–13 ngày công
    const workHours = paidUnits * 8
    // NV văn phòng có OT ngày thường; ca có OT đêm; một số có OT cuối tuần/lễ
    const isShift = e.work_nature === 2
    const wd = ot.weekday * (0.5 + rand()) * (isShift ? 0.4 : 1)
    const we = rand() < 0.25 ? ot.weekend * (0.5 + rand()) : 0
    const hl = rand() < 0.4 ? ot.holiday * (0.5 + rand()) : 0
    const night = isShift ? 4 + rand() * 8 : (rand() < 0.1 ? rand() * 2 : 0)
    const breakdown = {
      otWeekday: Math.round(wd * 10) / 10, otWeekend: Math.round(we * 10) / 10, otHoliday: Math.round(hl * 10) / 10,
      night: Math.round(night * 10) / 10, nightOt: Math.round((isShift ? night * 0.3 : 0) * 10) / 10,
    }
    const slip = buildPayslip({ monthlyWage: e.wage, paidUnits, actualWorkHours: workHours, breakdown })
    db.prepare(`INSERT INTO summary_timesheet_details (id, summary_timesheet_id, employee_id, employee_name, employee_code,
      paid_units, ot_hours, late_early_count, work_hours, ot_weekday_hours, ot_weekend_hours, ot_holiday_hours, night_hours, night_ot_hours,
      confirmation_status, confirmation_comment) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,3,NULL)`).run(
      uid('std'), stId, e.id, e.full_name, e.employee_code, paidUnits,
      breakdown.otWeekday + breakdown.otWeekend + breakdown.otHoliday, 0, workHours,
      breakdown.otWeekday, breakdown.otWeekend, breakdown.otHoliday, breakdown.night, breakdown.nightOt)
    db.prepare(`INSERT INTO payslips (id, period, employee_id, employee_name, base_salary, paid_work, overtime, allowance, gross, deductions, net, components) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(uid('ps'), period, e.id, e.full_name, slip.base, slip.paidWork, slip.overtime, slip.allowance, slip.gross, slip.deductions, slip.net, JSON.stringify(slip.components))
  }
}

function getSummaryByPeriodLocal(period: string): any {
  return db.prepare('SELECT 1 FROM summary_timesheets WHERE period=?').get(period) as any
}

/* ------------------------- Export cho org route --------------------------- */
export function truncateAndSeed(): void { seed() }

// Chạy trực tiếp: npm run seed  (không chạy khi bị import)
import { pathToFileURL } from 'node:url'
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) seed()