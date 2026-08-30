// ============================================================================
// Lớp truy cập dữ liệu: mapper DB row (snake_case, 0/1) → DTO (camelCase, boolean).
// Cung cấp hàm query tiện dụng cho routes & engines.
// ============================================================================
import { db } from './db.js'
import { isoNow } from './lib/date.js'

const json = (s: string | null | undefined, fallback: any = []) => {
  try { return s ? JSON.parse(s) : fallback } catch { return fallback }
}
const bool = (n: number | null | undefined) => !!n
const num = (n: any) => (n == null ? null : Number(n))
const str = (s: any) => (s == null ? null : String(s))

/* ----------------------------- Tổ chức & NV ------------------------------- */
export function mapEmployee(r: any) {
  return {
    id: r.id, employeeCode: r.employee_code, firstName: r.first_name, lastName: r.last_name,
    fullName: r.full_name, gender: r.gender, dateOfBirth: str(r.date_of_birth), email: r.email,
    phone: r.phone, address: r.address, maritalStatus: r.marital_status, status: r.status,
    avatarData: str(r.avatar_data), managerId: str(r.manager_id), departmentId: r.department_id,
    positionId: r.position_id, branchId: str(r.branch_id), hireDate: r.hire_date,
    workNature: r.work_nature, contractType: r.contract_type, wage: r.wage,
  }
}
export const getEmployee = (id: string) => {
  const r = db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as any
  return r ? mapEmployee(r) : null
}
export const allEmployees = () => (db.prepare('SELECT * FROM employees').all() as any[]).map(mapEmployee)

export function mapBranch(r: any) { return { id: r.id, name: r.name, address: r.address } }
export function mapDepartment(r: any) {
  return { id: r.id, code: r.code, name: r.name, parentId: str(r.parent_id), managerEmployeeId: str(r.manager_employee_id) }
}
export function mapPosition(r: any) { return { id: r.id, code: r.code, name: r.name } }

/* --------------------------------- User ----------------------------------- */
export function mapUser(r: any) {
  return {
    id: r.id, email: r.email, employeeId: r.employee_id, roles: json(r.roles, []),
    permissions: json(r.permissions, []), departmentScopes: json(r.department_scopes, []),
    isActive: r.is_active == null ? true : bool(r.is_active),
    authorizationVersion: Number(r.authz_version ?? 1),
  }
}
export const getUserById = (id: string) => {
  const r = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any
  return r ? mapUser(r) : null
}
export const getUserByEmail = (email: string) => {
  const r = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email) as any
  return r ? { ...mapUser(r), passwordHash: r.password_hash } : null
}
export const getUserByEmployeeId = (employeeId: string) => {
  const r = db.prepare('SELECT * FROM users WHERE employee_id = ?').get(employeeId) as any
  return r ? mapUser(r) : null
}

/* --------------------------------- Ca ------------------------------------- */
export function mapShift(r: any) {
  return {
    id: r.id, code: r.code, name: r.name, startTime: r.start_time, endTime: r.end_time,
    breakStartTime: str(r.break_start_time), breakEndTime: str(r.break_end_time),
    checkInWindowFrom: str(r.check_in_window_from), checkInWindowTo: str(r.check_in_window_to),
    checkOutWindowFrom: str(r.check_out_window_from), checkOutWindowTo: str(r.check_out_window_to),
    latePunishmentEnabled: bool(r.late_punishment_enabled), latePunishmentTimes: r.late_punishment_times,
    latePunishmentMinutesEach: r.late_punishment_minutes_each, workDays: r.work_days,
    isOvernight: bool(r.is_overnight), status: r.status, holidayCoefficient: r.holiday_coefficient,
    color: r.color,
  }
}
export const getShift = (id: string | null) => {
  if (!id) return null
  const r = db.prepare('SELECT * FROM shifts WHERE id = ?').get(id) as any
  return r ? mapShift(r) : null
}
export const allShifts = () => (db.prepare('SELECT * FROM shifts').all() as any[]).map(mapShift)

export function mapShiftSchedule(r: any) {
  return { id: r.id, employeeId: r.employee_id, shiftId: r.shift_id, date: r.date, ruleId: str(r.rule_id), isActive: bool(r.is_active) }
}
export const getSchedule = (employeeId: string, date: string) => {
  const r = db.prepare('SELECT * FROM shift_schedules WHERE employee_id = ? AND date = ? AND is_active = 1').get(employeeId, date) as any
  return r ? mapShiftSchedule(r) : null
}

/* ------------------------------ Chấm công --------------------------------- */
export function mapPunch(r: any) {
  return {
    id: r.id, employeeId: r.employee_id, date: r.date, punchedAt: r.punched_at, source: r.source,
    deviceInfo: str(r.device_info), latitude: num(r.latitude), longitude: num(r.longitude),
    accuracy: num(r.accuracy), wifiSsid: str(r.wifi_ssid), notes: str(r.notes),
    snapshotBase64: str(r.snapshot_base64), attendanceRecordId: str(r.attendance_record_id),
    isCheckIn: bool(r.is_check_in), isActive: bool(r.is_active), createdAt: r.created_at,
    ipAddress: str(r.ip_address),
  }
}
export const punchesOfDay = (employeeId: string, date: string) =>
  (db.prepare(`SELECT * FROM punches WHERE employee_id = ? AND date = ? AND is_active = 1 ORDER BY punched_at ASC`)
    .all(employeeId, date) as any[]).map(mapPunch)

export function mapAttendanceRecord(r: any) {
  return {
    id: r.id, employeeId: r.employee_id, date: r.date, shiftId: str(r.shift_id), shiftName: str(r.shift_name),
    checkInTime: str(r.check_in_time), checkOutTime: str(r.check_out_time),
    actualWorkHours: r.actual_work_hours, workHours: r.work_hours, lateMinutes: r.late_minutes,
    earlyLeaveMinutes: r.early_leave_minutes, overtimeHours: r.overtime_hours, status: r.status,
    mainStatus: r.main_status, approvalStatus: r.approval_status, issues: r.issues,
    otWeekdayHours: num(r.ot_weekday_hours) ?? 0, otWeekendHours: num(r.ot_weekend_hours) ?? 0,
    otHolidayHours: num(r.ot_holiday_hours) ?? 0, nightHours: num(r.night_hours) ?? 0,
    nightOtHours: num(r.night_ot_hours) ?? 0,
    notes: str(r.notes), isActive: bool(r.is_active), createdAt: r.created_at, updatedAt: r.updated_at,
  }
}
export const getRecord = (employeeId: string, date: string) => {
  const r = db.prepare('SELECT * FROM attendance_records WHERE employee_id = ? AND date = ?').get(employeeId, date) as any
  return r ? mapAttendanceRecord(r) : null
}
export const allRecords = () => (db.prepare('SELECT * FROM attendance_records').all() as any[]).map(mapAttendanceRecord)

/* --------------------------- Loại nghỉ / quỹ ------------------------------ */
export function mapLeaveType(r: any) {
  return {
    id: r.id, name: r.name, category: r.category, fundType: r.fund_type,
    maxDays: num(r.max_days), requireAttachment: bool(r.require_attachment),
    requireReason: bool(r.require_reason), dayCalculationType: r.day_calculation_type,
  }
}
export const getLeaveType = (id: string) => {
  const r = db.prepare('SELECT * FROM leave_types WHERE id = ?').get(id) as any
  return r ? mapLeaveType(r) : null
}
export function mapLeaveBalance(r: any) {
  return {
    id: r.id, employeeId: r.employee_id, year: r.year, leaveTypeCategory: r.leave_type_category,
    leaveTypeName: r.leave_type_name, allocatedDays: r.allocated_days, usedDays: r.used_days,
    pendingDays: r.pending_days,
  }
}

/* ------------------------------ Quy định ---------------------------------- */
export function mapRegulation(r: any) {
  const gps = db.prepare('SELECT * FROM gps_catalog WHERE regulation_id = ?').all(r.id) as any[]
  const wifi = db.prepare('SELECT * FROM wifi_catalog WHERE regulation_id = ?').all(r.id) as any[]
  const ip = db.prepare('SELECT * FROM ip_catalog WHERE regulation_id = ?').all(r.id) as any[]
  return {
    id: r.id, enablePunchFace: bool(r.enable_punch_face), enablePunchGps: bool(r.enable_punch_gps),
    enablePunchWifi: bool(r.enable_punch_wifi), enablePunchIp: bool(r.enable_punch_ip),
    enablePunchQr: bool(r.enable_punch_qr), requireLivenessCheck: bool(r.require_liveness_check),
    livenessStrictness: r.liveness_strictness, alternativePunchMethod: num(r.alternative_punch_method),
    canEmployeeTrackWorkHours: bool(r.can_employee_track_work_hours),
    allowEmployeeShiftRegistration: bool(r.allow_employee_shift_registration),
    allowEmployeeViewDetailTimesheetDaily: bool(r.allow_employee_view_detail_timesheet_daily),
    duplicateWindowSeconds: r.duplicate_window_seconds ?? 60,
    otMonthlyCapHours: r.ot_monthly_cap_hours ?? 40,
    otYearlyCapHours: r.ot_yearly_cap_hours ?? 200,
    weekdayOtCoeff: r.weekday_ot_coeff ?? 1.5,
    weekendOtCoeff: r.weekend_ot_coeff ?? 2.0,
    holidayOtCoeff: r.holiday_ot_coeff ?? 3.0,
    nightCoeff: r.night_coeff ?? 1.3,
    nightOtExtra: r.night_ot_extra ?? 0.2,
    standardMonthlyHours: r.standard_monthly_hours ?? 160,
    gpsCatalog: gps.map((g) => ({ id: g.id, name: g.name, lat: g.lat, lng: g.lng, radiusMeters: g.radius_meters })),
    wifiCatalog: wifi.map((w) => ({ id: w.id, ssid: w.ssid, bssid: str(w.bssid) })),
    ipCatalog: ip.map((i) => ({ id: i.id, ipAddress: i.ip_address, subnetBits: i.subnet_bits })),
  }
}
export const getRegulation = () => {
  const r = db.prepare('SELECT * FROM regulation LIMIT 1').get() as any
  return r ? mapRegulation(r) : null
}

/* --------------------------------- Đơn ------------------------------------ */
export function mapApproval(r: any) {
  return {
    id: r.id, requestId: r.request_id, requestType: r.request_type, level: r.level,
    approverUserId: str(r.approver_user_id), approverName: r.approver_name, status: r.status,
    comment: str(r.comment), approvedAt: str(r.approved_at),
    onBehalfOfUserId: str(r.on_behalf_of_user_id), onBehalfOfName: str(r.on_behalf_of_name),
  }
}
export function mapAttachment(r: any) {
  return {
    id: r.id, requestId: r.request_id, fileName: r.file_name, fileSize: r.file_size,
    mimeType: r.mime_type, dataUrl: r.data_url, uploadedAt: r.uploaded_at,
  }
}
export function mapRequest(r: any) {
  const approvals = (db.prepare('SELECT * FROM request_approvals WHERE request_id = ? ORDER BY level ASC').all(r.id) as any[]).map(mapApproval)
  const attachments = (db.prepare('SELECT * FROM request_attachments WHERE request_id = ?').all(r.id) as any[]).map(mapAttachment)
  const base = {
    id: r.id, type: r.type, employeeId: r.employee_id, employeeName: r.employee_name,
    employeeCode: r.employee_code, status: r.status, requestVersion: r.request_version,
    createdAt: r.created_at, updatedAt: r.updated_at, currentLevel: r.current_level,
    capabilities: json(r.capabilities, { canEdit: false, canCancel: false, canRespond: false }),
    attachments, approvals,
  }
  const r2 = r as any
  switch (r.type) {
    case 'leaves': return { ...base, type: 'leaves', leaveTypeId: r2.leave_type_id, leaveTypeName: r2.leave_type_name, startDate: r2.start_date, endDate: r2.end_date, totalDays: r2.total_days, reason: r2.reason }
    case 'late-earlies': return { ...base, type: 'late-earlies', requestDate: r2.request_date, lateEarlyType: r2.late_early_type, requestedTime: r2.requested_time, minutes: r2.minutes, reason: r2.reason }
    case 'overtimes': return { ...base, type: 'overtimes', otDate: r2.ot_date, startTime: r2.start_time, endTime: r2.end_time, totalHours: r2.total_hours, compensationType: r2.compensation_type, reason: r2.reason }
    case 'business-trips': return { ...base, type: 'business-trips', startDate: r2.start_date, endDate: r2.end_date, totalDays: r2.total_days, location: r2.location, purpose: r2.purpose }
    case 'shift-swaps': return { ...base, type: 'shift-swaps', requestedDate: r2.request_date, shiftSwapMode: r2.shift_swap_mode, suggestedSwapPartnerId: str(r2.suggested_swap_partner_id), suggestedSwapPartnerName: str(r2.suggested_swap_partner_name), swapPartnerStatus: r2.swap_partner_status ?? 0, reason: r2.reason }
    case 'attendance-updates': return { ...base, type: 'attendance-updates', requestDate: r2.request_date, updateType: r2.update_type, newCheckInTime: str(r2.new_check_in_time), newCheckOutTime: str(r2.new_check_out_time), newWorkHours: num(r2.new_work_hours), reason: r2.reason }
    default: return base
  }
}
export const getRequest = (type: string, id: string) => {
  const r = db.prepare('SELECT * FROM requests WHERE id = ? AND type = ?').get(id, type) as any
  return r ? mapRequest(r) : null
}
export const getRequestAny = (id: string) => {
  const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(id) as any
  return r ? mapRequest(r) : null
}
export const allRequests = () => (db.prepare('SELECT * FROM requests').all() as any[]).map(mapRequest)

/* ----------------------------- Bảng công/Lương --------------------------- */
export function mapSummaryTimesheet(r: any) {
  const details = (db.prepare('SELECT * FROM summary_timesheet_details WHERE summary_timesheet_id = ?').all(r.id) as any[]).map((d) => ({
    id: d.id, summaryTimesheetId: d.summary_timesheet_id, employeeId: d.employee_id,
    employeeName: d.employee_name, employeeCode: d.employee_code, paidUnits: d.paid_units,
    otHours: d.ot_hours, lateEarlyCount: d.late_early_count, workHours: d.work_hours,
    otWeekdayHours: num(d.ot_weekday_hours) ?? 0, otWeekendHours: num(d.ot_weekend_hours) ?? 0,
    otHolidayHours: num(d.ot_holiday_hours) ?? 0, nightHours: num(d.night_hours) ?? 0,
    nightOtHours: num(d.night_ot_hours) ?? 0,
    confirmationStatus: d.confirmation_status, confirmationComment: str(d.confirmation_comment),
  }))
  return { id: r.id, period: r.period, status: r.status, from: r.from_date, to: r.to_date, details }
}
export const getSummary = (id: string) => {
  const r = db.prepare('SELECT * FROM summary_timesheets WHERE id = ?').get(id) as any
  return r ? mapSummaryTimesheet(r) : null
}
export const getSummaryByPeriod = (period: string) => {
  const r = db.prepare('SELECT * FROM summary_timesheets WHERE period = ?').get(period) as any
  return r ? mapSummaryTimesheet(r) : null
}
export function mapPayslip(r: any) {
  return {
    id: r.id, period: r.period, employeeId: r.employee_id, employeeName: r.employee_name,
    baseSalary: r.base_salary, paidWork: r.paid_work, overtime: r.overtime, allowance: r.allowance,
    gross: r.gross, deductions: r.deductions, net: r.net, components: json(r.components, []),
  }
}
export const allPayslips = () => (db.prepare('SELECT * FROM payslips').all() as any[]).map(mapPayslip)

/* ----------------------------- Thông báo ---------------------------------- */
export function mapNotification(r: any) {
  return {
    id: r.id, recipientUserId: r.recipient_user_id, title: r.title, message: r.message,
    type: r.type, relatedEntityType: str(r.related_entity_type), relatedEntityId: str(r.related_entity_id),
    isRead: bool(r.is_read), readAt: str(r.read_at), linkUrl: str(r.link_url), createdAt: r.created_at,
  }
}

/* ------------------------------- Audit ------------------------------------ */
export function mapAuditLog(r: any) {
  return {
    id: r.id, userId: r.user_id, userName: r.user_name, action: r.action, entity: r.entity,
    entityId: str(r.entity_id), detail: r.detail, ipAddress: str(r.ip_address), createdAt: r.created_at,
  }
}

/* ------------------------- Helpers viết DB --------------------------------- */
export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/* ------------------------- Lễ tết & Ủy quyền ------------------------------- */
export function mapHoliday(r: any) {
  return { id: r.id, date: r.date, name: r.name, type: r.type, coefficient: r.coefficient }
}
export const getHolidays = () => (db.prepare('SELECT * FROM holidays ORDER BY date ASC').all() as any[]).map(mapHoliday)
export const isHoliday = (date: string) => !!(db.prepare('SELECT 1 FROM holidays WHERE date = ?').get(date) as any)

export function mapDelegation(r: any) {
  return {
    id: r.id, delegatorUserId: r.delegator_user_id, delegateUserId: r.delegate_user_id,
    fromDate: r.from_date, toDate: r.to_date, reason: str(r.reason), isActive: bool(r.is_active),
    createdAt: r.created_at,
  }
}
/** Tìm ủy quyền đang hiệu lực (today trong [from,to]) cho một approver. */
export const getActiveDelegation = (delegatorUserId: string, today: string) => {
  const r = db.prepare(
    `SELECT * FROM delegations WHERE delegator_user_id = ? AND is_active = 1 AND ? >= from_date AND ? <= to_date ORDER BY created_at DESC LIMIT 1`,
  ).get(delegatorUserId, today, today) as any
  return r ? mapDelegation(r) : null
}

/* ------------------------------ Khuôn mặt --------------------------------- */
export function mapFaceData(r: any) {
  return {
    id: r.id, employeeId: r.employee_id, descriptors: json(r.descriptors, []),
    photoBase64: str(r.photo_base64), capturedCount: r.captured_count,
    registeredAt: r.registered_at, updatedAt: r.updated_at,
  }
}
export const getFaceData = (employeeId: string) => {
  const r = db.prepare('SELECT * FROM employee_face_data WHERE employee_id = ?').get(employeeId) as any
  return r ? mapFaceData(r) : null
}
export function upsertFaceData(employeeId: string, descriptorsJson: string, photoBase64: string | null, count: number): void {
  const now = isoNow()
  const existing = db.prepare('SELECT id FROM employee_face_data WHERE employee_id = ?').get(employeeId) as any
  if (existing) {
    db.prepare('UPDATE employee_face_data SET descriptors=?, photo_base64=?, captured_count=?, updated_at=? WHERE id=?')
      .run(descriptorsJson, photoBase64, count, now, existing.id)
  } else {
    db.prepare(`INSERT INTO employee_face_data (id, employee_id, descriptors, photo_base64, captured_count, registered_at, updated_at) VALUES (?,?,?,?,?,?,?)`)
      .run(uid('face'), employeeId, descriptorsJson, photoBase64, count, now, now)
  }
}

/* ------------------------- Token phiên chấm mặt -------------------------- */
const ATTEMPT_TTL_MS = 5 * 60 * 1000 // 5 phút

export function createAttemptToken(userId: string): { token: string; expiresAt: string } {
  const token = uid('fat') + '-' + Math.random().toString(36).slice(2, 10)
  const now = new Date()
  const createdIso = isoNow()
  db.prepare('INSERT INTO face_attempt_tokens (id, user_id, token, created_at, used) VALUES (?,?,?,?,0)').run(uid('fat'), userId, token, createdIso)
  const expiresAt = new Date(now.getTime() + ATTEMPT_TTL_MS).toISOString()
  return { token, expiresAt }
}

/** Lấy + đánh dấu dùng token. Trả về row nếu hợp lệ (chưa dùng, còn hạn). */
export function consumeAttemptToken(token: string): { userId: string } | null {
  const row = db.prepare('SELECT * FROM face_attempt_tokens WHERE token = ?').get(token) as any
  if (!row) return null
  if (row.used) return null
  const age = Date.now() - new Date(row.created_at).getTime()
  if (age > ATTEMPT_TTL_MS) return null
  db.prepare('UPDATE face_attempt_tokens SET used = 1 WHERE id = ?').run(row.id)
  return { userId: row.user_id }
}
