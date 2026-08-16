// ============================================================================
// ENGINE ĐƠN TỪ & DUYỆT — lõi logic nghiệp vụ (đặc tả §6).
//  - 6 loại đơn, quy trình duyệt nhiều cấp có điều kiện chuyển bước
//  - Quỹ phép: PendingDays += khi tạo, UsedDays += khi duyệt, hoàn khi hủy/từ chối
//  - Optimistic concurrency: expectedRequestVersion
//  - Đổi ca MutualSwap: đồng nghiệp xác nhận trước khi vào quy trình duyệt
// ============================================================================
import type {
  AnyRequest, RequestType, LeaveRequest, LateEarlyRequest,
  OvertimeRequest, BusinessTripRequest, ShiftSwapRequest, AttendanceUpdateRequest,
  RequestApproval, RoleCode, AnyRequest as R, ApprovalStatus, BaseRequest,
  LeaveTypeCategory, LeaveFundType, ShiftSwapMode,
} from '@/types'
import type { DB } from './store'
import { saveDB, uid } from './store'
import { workingDays, calendarDays, parseISO } from '@/lib/date'

/* ----------------------- Cấu hình quy trình duyệt -------------------------- */
interface FlowStep {
  level: number
  approver: ApproverSpec
  condition?: { type: string; op: '<=' | '>' | '=' | '<' | '>=' | '!='; value: number }
  /** Bỏ qua level này nếu condition sai (mặc định: condition sai → skip, true → chạy) */
}

type ApproverSpec =
  | { kind: 'DirectManager' }
  | { kind: 'DepartmentHead' }
  | { kind: 'Role'; role: RoleCode }
  | { kind: 'SpecificUser'; userId: string; name: string }

const FLOWS: Record<RequestType, FlowStep[]> = {
  leaves: [
    { level: 1, approver: { kind: 'DirectManager' } },
    { level: 2, approver: { kind: 'Role', role: 'Director' }, condition: { type: 'ByLeaveDays', op: '>', value: 3 } },
  ],
  overtimes: [
    { level: 1, approver: { kind: 'DirectManager' } },
    { level: 2, approver: { kind: 'Role', role: 'HR' }, condition: { type: 'ByOvertimeHours', op: '>', value: 4 } },
  ],
  'late-earlies': [{ level: 1, approver: { kind: 'DirectManager' } }],
  'business-trips': [
    { level: 1, approver: { kind: 'DirectManager' } },
    { level: 2, approver: { kind: 'DepartmentHead' }, condition: { type: 'ByTripDays', op: '>', value: 2 } },
  ],
  'shift-swaps': [{ level: 1, approver: { kind: 'DirectManager' } }],
  'attendance-updates': [
    { level: 1, approver: { kind: 'DirectManager' } },
    { level: 2, approver: { kind: 'Role', role: 'HR' } },
  ],
}

/* --------------------------- Helper resolution ----------------------------- */
function resolveApprover(db: DB, spec: ApproverSpec, employeeId: string): { userId: string | null; name: string } {
  const emp = db.employees.find((e) => e.id === employeeId)
  if (spec.kind === 'DirectManager') {
    const mgr = db.employees.find((e) => e.id === emp?.managerId)
    const u = db.users.find((x) => x.employeeId === mgr?.id)
    return { userId: u?.id ?? null, name: mgr?.fullName ?? 'Quản lý trực tiếp' }
  }
  if (spec.kind === 'DepartmentHead') {
    const dept = db.departments.find((d) => d.id === emp?.departmentId)
    const head = db.employees.find((e) => e.id === dept?.managerEmployeeId)
    const u = db.users.find((x) => x.employeeId === head?.id)
    return { userId: u?.id ?? null, name: head?.fullName ?? 'Trưởng phòng' }
  }
  if (spec.kind === 'Role') {
    const u = db.users.find((x) => x.roles.includes(spec.role))
    const e = db.employees.find((em) => em.id === u?.employeeId)
    return { userId: u?.id ?? null, name: e?.fullName ?? spec.role }
  }
  return { userId: spec.userId, name: spec.name }
}

function evalCondition(cond: FlowStep['condition'], req: AnyRequest): boolean {
  if (!cond) return true
  let actual = 0
  if (cond.type === 'ByLeaveDays' && req.type === 'leaves') actual = (req as LeaveRequest).totalDays
  else if (cond.type === 'ByOvertimeHours' && req.type === 'overtimes') actual = (req as OvertimeRequest).totalHours
  else if (cond.type === 'ByTripDays' && req.type === 'business-trips') actual = (req as BusinessTripRequest).totalDays
  else return true
  switch (cond.op) {
    case '>': return actual > cond.value
    case '<': return actual < cond.value
    case '>=': return actual >= cond.value
    case '<=': return actual <= cond.value
    case '=': return actual === cond.value
    case '!=': return actual !== cond.value
    default: return true
  }
}

/* --------------------------- Tạo đơn -------------------------------------- */
export function createRequest(
  db: DB, userId: string, type: RequestType, payload: any,
): AnyRequest {
  const user = db.users.find((u) => u.id === userId)!
  const emp = db.employees.find((e) => e.id === user.employeeId)!
  const base: BaseRequest = {
    id: uid('req'), type, employeeId: emp.id, employeeName: emp.fullName,
    employeeCode: emp.employeeCode, status: 2, requestVersion: 1,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    currentLevel: 1, capabilities: { canEdit: true, canCancel: true, canRespond: false },
    attachments: [], approvals: [],
  }

  let req: AnyRequest
  if (type === 'leaves') {
    const lt = db.leaveTypes.find((l) => l.id === payload.leaveTypeId)!
    const totalDays = calcLeaveDays(lt.dayCalculationType, payload.startDate, payload.endDate)
    req = { ...base, type, leaveTypeId: lt.id, leaveTypeName: lt.name,
      startDate: payload.startDate, endDate: payload.endDate, totalDays, reason: payload.reason } as LeaveRequest
    // Quỹ phép: nếu dùng quỹ Annual/Comp → PendingDays += totalDays
    if (lt.fundType !== 0) adjustBalance(db, emp.id, lt.fundType, 'pending', totalDays)
    // Đơn nghỉ MutualSwap? không. Trạng thái đặc biệt nếu cần duyệt cấp cuối?
  } else if (type === 'late-earlies') {
    req = { ...base, type, requestDate: payload.requestDate, lateEarlyType: payload.lateEarlyType,
      requestedTime: payload.requestedTime, minutes: payload.minutes, reason: payload.reason } as LateEarlyRequest
  } else if (type === 'overtimes') {
    const totalHours = computeOtHours(payload.startTime, payload.endTime)
    req = { ...base, type, otDate: payload.otDate, startTime: payload.startTime, endTime: payload.endTime,
      totalHours, compensationType: payload.compensationType, reason: payload.reason } as OvertimeRequest
  } else if (type === 'business-trips') {
    const totalDays = workingDays(parseISO(payload.startDate), parseISO(payload.endDate))
    req = { ...base, type, startDate: payload.startDate, endDate: payload.endDate, totalDays,
      location: payload.location, purpose: payload.purpose } as BusinessTripRequest
  } else if (type === 'shift-swaps') {
    const partner = payload.suggestedSwapPartnerId ? db.employees.find((e) => e.id === payload.suggestedSwapPartnerId) : null
    const mode: ShiftSwapMode = payload.shiftSwapMode
    req = { ...base, type, requestedDate: payload.requestedDate, shiftSwapMode: mode,
      suggestedSwapPartnerId: payload.suggestedSwapPartnerId, suggestedSwapPartnerName: partner?.fullName ?? null,
      swapPartnerStatus: mode === 2 ? 1 : 0, reason: payload.reason } as ShiftSwapRequest
    // MutualSwap → cần đồng nghiệp xác nhận trước
    if (mode === 2) {
      ;(req as ShiftSwapRequest).status = 6 // PendingPartnerConfirmation
      base.capabilities.canRespond = true
    }
  } else {
    req = { ...base, type: 'attendance-updates', requestDate: payload.requestDate, updateType: payload.updateType,
      newCheckInTime: payload.newCheckInTime, newCheckOutTime: payload.newCheckOutTime,
      newWorkHours: payload.newWorkHours, reason: payload.reason } as AttendanceUpdateRequest
  }

  db.requests.push(req)
  // Tạo approval record bước 1 (nếu không phải chờ partner)
  if (req.status === 2) initApproval(db, req)
  saveDB()
  return req
}

function initApproval(db: DB, req: AnyRequest): void {
  const flow = FLOWS[req.type]
  const step = flow[0]!
  const ap = resolveApprover(db, step.approver, req.employeeId)
  const approval: RequestApproval = {
    id: uid('ap'), requestId: req.id, requestType: req.type, level: 1,
    approverUserId: ap.userId, approverName: ap.name, status: 2, comment: null, approvedAt: null,
  }
  req.approvals = [approval]
  // Thông báo người duyệt
  if (ap.userId) pushNotification(db, ap.userId, 'Có đơn mới chờ duyệt', `${req.employeeName} gửi ${labelType(req.type)} cần bạn duyệt.`, 6, 'request', req.id, `/employee/requests/${req.type}/${req.id}`)
}

/* --------------------------- Duyệt / Từ chối ------------------------------ */
export function approveRequest(db: DB, _userId: string, type: RequestType, id: string, comment: string, expectedVersion: number): AnyRequest {
  const req = findReq(db, type, id)
  ensureVersion(req, expectedVersion)
  if (req.status !== 2 && req.status !== 8) throw httpError(409, 'Đơn không ở trạng thái chờ duyệt.')

  const flow = FLOWS[type]
  const currentLevel = req.currentLevel
  // Đánh dấu bước hiện tại Approved
  const ap = req.approvals.find((a) => a.level === currentLevel)
  if (ap) { ap.status = 3 as ApprovalStatus; ap.comment = comment; ap.approvedAt = new Date().toISOString() }

  // Tìm bước tiếp theo có condition đúng
  let nextStep: FlowStep | null = null
  for (const s of flow) {
    if (s.level <= currentLevel) continue
    if (evalCondition(s.condition, req)) { nextStep = s; break }
    // condition sai → bỏ qua (skipped)
    const skip: RequestApproval = { id: uid('ap'), requestId: req.id, requestType: type, level: s.level,
      approverUserId: null, approverName: '—', status: 5 as ApprovalStatus, comment: 'Bỏ qua (điều kiện không thỏa)', approvedAt: new Date().toISOString() }
    req.approvals.push(skip)
  }

  if (nextStep) {
    req.currentLevel = nextStep.level
    req.status = 2
    const nap = resolveApprover(db, nextStep.approver, req.employeeId)
    req.approvals.push({ id: uid('ap'), requestId: req.id, requestType: type, level: nextStep.level,
      approverUserId: nap.userId, approverName: nap.name, status: 2, comment: null, approvedAt: null })
    if (nap.userId) pushNotification(db, nap.userId, 'Đơn chuyển đến bạn duyệt', `${req.employeeName} — ${labelType(type)} (cấp ${nextStep.level}).`, 6, 'request', req.id, `/employee/requests/${type}/${req.id}`)
  } else {
    // Duyệt xong toàn bộ
    req.status = 3
    applyApprovedEffect(db, req)
    pushNotification(db, userIdOfEmployee(db, req.employeeId), 'Đơn được duyệt', `${labelType(type)} của bạn đã được duyệt hoàn toàn.`, 3, 'request', req.id, `/employee/requests/${type}/${req.id}`)
  }
  req.requestVersion += 1
  req.updatedAt = new Date().toISOString()
  saveDB()
  return req
}

export function rejectRequest(db: DB, _userId: string, type: RequestType, id: string, comment: string, expectedVersion: number): AnyRequest {
  const req = findReq(db, type, id)
  ensureVersion(req, expectedVersion)
  if (req.status !== 2 && req.status !== 8 && req.status !== 6) throw httpError(409, 'Đơn không ở trạng thái có thể xử lý.')
  const ap = req.approvals.find((a) => a.level === req.currentLevel)
  if (ap) { ap.status = 4 as ApprovalStatus; ap.comment = comment; ap.approvedAt = new Date().toISOString() }
  req.status = 4
  // Hoàn quỹ phép đang chờ
  if (req.type === 'leaves') {
    const lt = db.leaveTypes.find((l) => l.id === (req as LeaveRequest).leaveTypeId)
    if (lt && lt.fundType !== 0) adjustBalance(db, req.employeeId, lt.fundType, 'cancel', (req as LeaveRequest).totalDays)
  }
  req.requestVersion += 1
  req.updatedAt = new Date().toISOString()
  pushNotification(db, userIdOfEmployee(db, req.employeeId), 'Đơn bị từ chối', `${labelType(type)} của bạn bị từ chối: ${comment}`, 4, 'request', req.id, `/employee/requests/${type}/${req.id}`)
  saveDB()
  return req
}

export function cancelRequest(db: DB, type: RequestType, id: string, expectedVersion: number): AnyRequest {
  const req = findReq(db, type, id)
  ensureVersion(req, expectedVersion)
  if (req.status === 3 || req.status === 4 || req.status === 5) throw httpError(409, 'Đơn không thể hủy ở trạng thái này.')
  if (req.type === 'leaves') {
    const lt = db.leaveTypes.find((l) => l.id === (req as LeaveRequest).leaveTypeId)
    if (lt && lt.fundType !== 0) adjustBalance(db, req.employeeId, lt.fundType, 'cancel', (req as LeaveRequest).totalDays)
  }
  req.status = 5
  req.requestVersion += 1
  req.updatedAt = new Date().toISOString()
  saveDB()
  return req
}

export function updateRequest(db: DB, _userId: string, type: RequestType, id: string, payload: any, expectedVersion: number): AnyRequest {
  const req = findReq(db, type, id)
  ensureVersion(req, expectedVersion)
  if (req.status !== 1 && req.status !== 2 && req.status !== 6) throw httpError(409, 'Đơn không ở trạng thái có thể sửa.')
  // Áp dụng payload (simplified — chỉ cập nhật trường chung + theo loại)
  Object.assign(req, payloadForType(type, payload))
  req.requestVersion += 1
  req.updatedAt = new Date().toISOString()
  saveDB()
  return req
}

/* ----------------- Đồng nghiệp xác nhận đổi ca (MutualSwap) --------------- */
export function partnerRespond(db: DB, _userId: string, id: string, accepted: boolean, comment: string | null, expectedVersion: number): AnyRequest {
  const req = db.requests.find((r) => r.id === id && r.type === 'shift-swaps') as ShiftSwapRequest | undefined
  if (!req) throw httpError(404, 'Không tìm thấy đơn đổi ca.')
  ensureVersion(req, expectedVersion)
  if (req.status !== 6) throw httpError(409, 'Đơn không chờ bạn xác nhận.')
  if (accepted) {
    req.swapPartnerStatus = 2
    req.status = 2
    initApproval(db, req)
  } else {
    req.swapPartnerStatus = 3
    req.status = 7
  }
  req.requestVersion += 1
  req.updatedAt = new Date().toISOString()
  pushNotification(db, userIdOfEmployee(db, req.employeeId), accepted ? 'Đồng nghiệp đồng ý đổi ca' : 'Đồng nghiệp từ chối đổi ca',
    accepted ? `${req.suggestedSwapPartnerName} đã đồng ý đổi ca. Đơn chuyển sang chờ duyệt.` : `${req.suggestedSwapPartnerName} từ chối: ${comment ?? ''}`,
    accepted ? 3 : 4, 'request', req.id, `/employee/requests/shift-swaps/${req.id}`)
  saveDB()
  return req
}

/* ------------------------------ Tiện ích ---------------------------------- */
function applyApprovedEffect(db: DB, req: AnyRequest): void {
  if (req.type === 'leaves') {
    const lt = db.leaveTypes.find((l) => l.id === (req as LeaveRequest).leaveTypeId)
    if (lt && lt.fundType !== 0) {
      // UsedDays += days; PendingDays -= days
      adjustBalance(db, req.employeeId, lt.fundType, 'approve', (req as LeaveRequest).totalDays)
    }
  }
  if (req.type === 'attendance-updates') {
    // Áp dụng cập nhật công lên AttendanceRecord
    applyAttendanceUpdate(db, req as AttendanceUpdateRequest)
  }
}

function applyAttendanceUpdate(db: DB, req: AttendanceUpdateRequest): void {
  const rec = db.records.find((r) => r.employeeId === req.employeeId && r.date === req.requestDate)
  if (!rec) return
  if (req.updateType === 3) { rec.isActive = false; return }
  if (req.newCheckInTime) rec.checkInTime = req.newCheckInTime
  if (req.newCheckOutTime) rec.checkOutTime = req.newCheckOutTime
  if (req.newWorkHours != null) rec.actualWorkHours = req.newWorkHours
  rec.status = 5
  rec.mainStatus = 1
  rec.updatedAt = new Date().toISOString()
}

function adjustBalance(db: DB, employeeId: string, fundType: LeaveFundType, action: 'pending' | 'approve' | 'cancel', days: number): void {
  const cat: LeaveTypeCategory = fundType === 1 ? 1 : 5 // Annual | Compensatory
  const year = new Date().getFullYear()
  let bal = db.leaveBalances.find((b) => b.employeeId === employeeId && b.year === year && b.leaveTypeCategory === cat)
  if (!bal) {
    bal = { id: uid('lb'), employeeId, year, leaveTypeCategory: cat, leaveTypeName: cat === 1 ? 'Phép năm' : 'Phép bù',
      allocatedDays: cat === 1 ? 12 : 4, usedDays: 0, pendingDays: 0 }
    db.leaveBalances.push(bal)
  }
  if (action === 'pending') bal.pendingDays += days
  else if (action === 'approve') { bal.usedDays += days; bal.pendingDays = Math.max(0, bal.pendingDays - days) }
  else if (action === 'cancel') bal.pendingDays = Math.max(0, bal.pendingDays - days)
}

function calcLeaveDays(calcType: number, start: string, end: string): number {
  if (calcType === 2) return calendarDays(parseISO(start), parseISO(end))
  if (calcType === 3) return 1 // ShiftHours — demo: 1 ca = 1 ngày
  return workingDays(parseISO(start), parseISO(end))
}

function computeOtHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let mins = (eh * 60 + em) - (sh * 60 + sm)
  if (mins < 0) mins += 24 * 60 // qua đêm
  return Math.round((mins / 60) * 100) / 100
}

function payloadForType(type: RequestType, p: any): any {
  // Chỉ giữ trường theo loại — tránh ghi đè trường hệ thống
  const allowed: Record<RequestType, string[]> = {
    leaves: ['leaveTypeId', 'startDate', 'endDate', 'totalDays', 'reason'],
    'late-earlies': ['requestDate', 'lateEarlyType', 'requestedTime', 'minutes', 'reason'],
    overtimes: ['otDate', 'startTime', 'endTime', 'totalHours', 'compensationType', 'reason'],
    'business-trips': ['startDate', 'endDate', 'totalDays', 'location', 'purpose'],
    'shift-swaps': ['requestedDate', 'shiftSwapMode', 'suggestedSwapPartnerId', 'reason'],
    'attendance-updates': ['requestDate', 'updateType', 'newCheckInTime', 'newCheckOutTime', 'newWorkHours', 'reason'],
  }
  const out: any = {}
  for (const k of allowed[type]) if (k in p) out[k] = p[k]
  return out
}

function findReq(db: DB, type: RequestType, id: string): AnyRequest {
  const r = db.requests.find((x) => x.id === id && x.type === type)
  if (!r) throw httpError(404, 'Không tìm thấy đơn.')
  return r
}

function ensureVersion(req: AnyRequest, expected: number): void {
  if (req.requestVersion !== expected) {
    throw httpError(409, `Phiên bản đơn không khớp (đã có người xử lý). Vui lòng tải lại. (kỳ vọng ${expected}, hiện tại ${req.requestVersion})`)
  }
}

function userIdOfEmployee(db: DB, employeeId: string): string {
  return db.users.find((u) => u.employeeId === employeeId)?.id ?? ''
}

function labelType(type: RequestType): string {
  return { leaves: 'đơn nghỉ phép', 'late-earlies': 'đơn muộn/sớm', overtimes: 'đơn làm thêm',
    'business-trips': 'đơn công tác', 'shift-swaps': 'đơn đổi ca', 'attendance-updates': 'đơn cập nhật công' }[type]
}

/* ----------------------------- Thông báo ---------------------------------- */
export function pushNotification(
  db: DB, recipientUserId: string, title: string, message: string,
  type: 1 | 2 | 3 | 4 | 5 | 6, relatedEntityType: string | null, relatedEntityId: string | null, linkUrl: string | null,
): void {
  if (!recipientUserId) return
  db.notifications.unshift({
    id: uid('nt'), recipientUserId, title, message, type,
    relatedEntityType, relatedEntityId, isRead: false, readAt: null, linkUrl,
    createdAt: new Date().toISOString(),
  })
}

/* ------------------------------ HTTP err ---------------------------------- */
export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message) }
}
export function httpError(status: number, message: string, code?: string): HttpError {
  return new HttpError(status, message, code)
}

/** Capabilities động theo trạng thái & user. */
export function computeCapabilities(req: AnyRequest, userId: string, db: DB): void {
  const user = db.users.find((u) => u.id === userId)
  const isOwner = user?.employeeId === req.employeeId
  const isCurrentApprover = req.approvals.some((a) => a.level === req.currentLevel && a.approverUserId === userId && a.status === 2)
  req.capabilities = {
    canEdit: isOwner && (req.status === 1 || req.status === 2 || req.status === 6),
    canCancel: isOwner && (req.status === 1 || req.status === 2 || req.status === 6 || req.status === 8),
    canRespond: req.type === 'shift-swaps' && (req as ShiftSwapRequest).swapPartnerStatus === 1 &&
      user?.employeeId === (req as ShiftSwapRequest).suggestedSwapPartnerId,
  }
  void isCurrentApprover
}

/** Lấy danh sách đơn chờ 1 user duyệt (theo role + phòng ban scope). */
export function pendingApprovals(db: DB, userId: string): AnyRequest[] {
  const user = db.users.find((u) => u.id === userId)
  if (!user) return []
  const isHR = user.roles.includes('HR') || user.roles.includes('Admin')
  const isDirector = user.roles.includes('Director') || user.roles.includes('Admin')
  return db.requests.filter((r) => {
    if (r.status !== 2 && r.status !== 8) return false
    const ap = r.approvals.find((a) => a.level === r.currentLevel && a.status === 2)
    if (!ap) return false
    if (ap.approverUserId === userId) return true
    // Role-based: HR/Director/Admin duyệt mọi đơn ở cấp role
    if (isHR && ap.approverName === 'HR') return true
    if (isDirector && ap.approverName === 'Director') return true
    if (user.roles.includes('Admin')) return true
    return false
  })
}

export type R2 = R