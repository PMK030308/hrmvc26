// ============================================================================
// ENGINE ĐƠN TỪ & DUYỆT — port từ attendance-web/src/api/mock/requestEngine.ts.
// 6 loại đơn, quy trình duyệt nhiều cấp có điều kiện, quỹ phép, optimistic concurrency,
// MutualSwap partner confirm.
// MỚI: ủy quyền duyệt (delegation) + Kế toán tham gia duyệt đơn tài chính + tham vấn GĐ.
// ============================================================================
import { db } from '../db.js'
import { httpError } from '../types.js'
import { uid, pushNotification } from '../helpers.js'
import {
  getUserById, getUserByEmployeeId, getEmployee, getLeaveType, getRequest, allRequests,
  getActiveDelegation, getRegulation,
} from '../repo.js'
import { recomputeRecord } from './attendance.js'
import { workingDays, calendarDays, parseISO, isoNow, ymd, nowVn } from '../lib/date.js'
import { pushAudit } from '../helpers.js'

type RequestType = 'leaves' | 'late-earlies' | 'overtimes' | 'business-trips' | 'shift-swaps' | 'attendance-updates'
type RoleCode = 'Guest' | 'Employee' | 'Manager' | 'Accountant' | 'HR' | 'Director' | 'Admin'

interface FlowStep {
  level: number
  approver: ApproverSpec
  condition?: { type: string; op: '<=' | '>' | '=' | '<' | '>=' | '!='; value: number }
}
type ApproverSpec =
  | { kind: 'DirectManager' }
  | { kind: 'DepartmentHead' }
  | { kind: 'Role'; role: RoleCode }
  | { kind: 'SpecificUser'; userId: string; name: string }

// Luồng duyệt mới (theo nhận xét giảng viên):
//  - nghỉ / muộn sớm / đổi ca: Quản lý trực tiếp → Trưởng phòng
//  - tăng ca / công tác: + Kế toán (duyệt tài chính)
//  - cập nhật công: Quản lý → HR → Kế toán (căn cứ lương)
//  - đơn nghỉ >3 ngày: sau khi trưởng phòng duyệt → tham vấn Giám đốc (thông báo, không chặn)
const FLOWS: Record<RequestType, FlowStep[]> = {
  leaves: [
    { level: 1, approver: { kind: 'DirectManager' } },
    { level: 2, approver: { kind: 'DepartmentHead' } },
  ],
  'late-earlies': [
    { level: 1, approver: { kind: 'DirectManager' } },
    { level: 2, approver: { kind: 'DepartmentHead' } },
  ],
  overtimes: [
    { level: 1, approver: { kind: 'DirectManager' } },
    { level: 2, approver: { kind: 'DepartmentHead' } },
    { level: 3, approver: { kind: 'Role', role: 'Accountant' } },
  ],
  'business-trips': [
    { level: 1, approver: { kind: 'DirectManager' } },
    { level: 2, approver: { kind: 'DepartmentHead' } },
    { level: 3, approver: { kind: 'Role', role: 'Accountant' } },
  ],
  'shift-swaps': [
    { level: 1, approver: { kind: 'DirectManager' } },
    { level: 2, approver: { kind: 'DepartmentHead' } },
  ],
  'attendance-updates': [
    { level: 1, approver: { kind: 'DirectManager' } },
    { level: 2, approver: { kind: 'Role', role: 'HR' } },
    { level: 3, approver: { kind: 'Role', role: 'Accountant' } },
  ],
}

interface ResolvedApprover { userId: string | null; name: string; onBehalfOfUserId?: string | null; onBehalfOfName?: string | null }

function resolveApprover(spec: ApproverSpec, employeeId: string): ResolvedApprover {
  const emp = getEmployee(employeeId)
  let baseUserId: string | null = null
  let baseName = 'Quản lý'
  let approverEmpId: string | null = null // employeeId của approver gốc (để check nghỉ phép)
  if (spec.kind === 'DirectManager') {
    const mgr = emp?.managerId ? getEmployee(emp.managerId) : null
    const u = mgr ? getUserByEmployeeId(mgr.id) : null
    baseUserId = u?.id ?? null
    baseName = mgr?.fullName ?? 'Quản lý trực tiếp'
    approverEmpId = mgr?.id ?? null
  } else if (spec.kind === 'DepartmentHead') {
    const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(emp?.departmentId ?? '') as any
    const head = dept?.manager_employee_id ? getEmployee(dept.manager_employee_id) : null
    const u = head ? getUserByEmployeeId(head.id) : null
    baseUserId = u?.id ?? null
    baseName = head?.fullName ?? 'Trưởng phòng'
    approverEmpId = head?.id ?? null
  } else if (spec.kind === 'Role') {
    const u = (db.prepare('SELECT * FROM users').all() as any[]).find((x) => JSON.parse(x.roles).includes(spec.role))
    const e = u ? getEmployee(u.employee_id) : null
    baseUserId = u?.id ?? null
    baseName = e?.fullName ?? spec.role
  } else {
    baseUserId = spec.userId
    baseName = spec.name
  }
  // Ủy quyền tay: nếu approver gốc đang vắng (có delegation active hôm nay) → chuyển sang delegate
  const today = ymd(nowVn())
  if (baseUserId) {
    const dlg = getActiveDelegation(baseUserId, today)
    if (dlg) {
      const delegateUser = getUserById(dlg.delegateUserId)
      const delegateEmp = delegateUser ? getEmployee(delegateUser.employeeId) : null
      const delegateName = delegateEmp?.fullName ?? delegateUser?.email ?? 'Người ủy quyền'
      return {
        userId: dlg.delegateUserId,
        name: `${delegateName} (thay mặt ${baseName})`,
        onBehalfOfUserId: baseUserId,
        onBehalfOfName: baseName,
      }
    }
  }
  // Escalation ngầm: approver gốc đang nghỉ phép (đơn leave approved hôm nay) và KHÔNG có
  // ủy quyền tay → chuyển lên cấp trên kế tiếp để đơn không bị kẹt.
  if (baseUserId && approverEmpId && isOnApprovedLeave(approverEmpId, today)) {
    if (spec.kind === 'DepartmentHead') {
      // Trưởng phòng nghỉ → Giám đốc duyệt.
      const dir = findDirectorUser()
      if (dir) return { userId: dir.id, name: `Giám đốc (thay mặt ${baseName})`, onBehalfOfUserId: baseUserId, onBehalfOfName: baseName }
    } else if (spec.kind === 'DirectManager') {
      // Trưởng nhóm nghỉ → Trưởng phòng duyệt.
      const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(emp?.departmentId ?? '') as any
      const head = dept?.manager_employee_id ? getEmployee(dept.manager_employee_id) : null
      const hu = head ? getUserByEmployeeId(head.id) : null
      if (hu) return { userId: hu.id, name: `${head?.fullName ?? 'Trưởng phòng'} (thay mặt ${baseName})`, onBehalfOfUserId: baseUserId, onBehalfOfName: baseName }
    }
  }
  return { userId: baseUserId, name: baseName }
}

/** NV này có đang nghỉ phép được duyệt trong ngày `today` không? */
function isOnApprovedLeave(employeeId: string, today: string): boolean {
  if (!employeeId) return false
  const r = db.prepare(
    `SELECT 1 FROM requests WHERE type='leaves' AND employee_id=? AND status=3 AND start_date<=? AND end_date>=? LIMIT 1`,
  ).get(employeeId, today, today) as any
  return !!r
}

/** Tìm user mang role Director (dùng khi escalate từ trưởng phòng). */
function findDirectorUser(): { id: string; email: string } | null {
  const u = (db.prepare('SELECT * FROM users').all() as any[]).find((x) => JSON.parse(x.roles).includes('Director'))
  return u ? { id: u.id, email: u.email } : null
}

function evalCondition(cond: FlowStep['condition'], req: any): boolean {
  if (!cond) return true
  let actual = 0
  if (cond.type === 'ByLeaveDays' && req.type === 'leaves') actual = req.totalDays
  else if (cond.type === 'ByOvertimeHours' && req.type === 'overtimes') actual = req.totalHours
  else if (cond.type === 'ByTripDays' && req.type === 'business-trips') actual = req.totalDays
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

function labelType(type: RequestType): string {
  return { leaves: 'đơn nghỉ phép', 'late-earlies': 'đơn muộn/sớm', overtimes: 'đơn làm thêm',
    'business-trips': 'đơn công tác', 'shift-swaps': 'đơn đổi ca', 'attendance-updates': 'đơn cập nhật công' }[type]
}

function insertApprovalRow(requestId: string, type: RequestType, level: number, ap: ResolvedApprover,
  status: number, comment: string | null, approvedAt: string | null): void {
  db.prepare(`INSERT INTO request_approvals (id, request_id, request_type, level, approver_user_id, approver_name,
    status, comment, approved_at, on_behalf_of_user_id, on_behalf_of_name)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    uid('ap'), requestId, type, level, ap.userId, ap.name, status, comment, approvedAt,
    ap.onBehalfOfUserId ?? null, ap.onBehalfOfName ?? null)
}

/* --------------------------- Tạo đơn -------------------------------------- */
export function createRequest(userId: string, type: RequestType, payload: any): any {
  const user = getUserById(userId)!
  const emp = getEmployee(user.employeeId)!
  const now = isoNow()
  const id = uid('req')
  const base: any = {
    id, type, employee_id: emp.id, employee_name: emp.fullName, employee_code: emp.employeeCode,
    status: 2, request_version: 1, current_level: 1, created_at: now, updated_at: now,
    capabilities: JSON.stringify({ canEdit: true, canCancel: true, canRespond: false }),
  }
  const cols: string[] = ['id', 'type', 'employee_id', 'employee_name', 'employee_code', 'status', 'request_version', 'current_level', 'created_at', 'updated_at', 'capabilities']
  const vals: any[] = [base.id, base.type, base.employee_id, base.employee_name, base.employee_code, base.status, base.request_version, base.current_level, base.created_at, base.updated_at, base.capabilities]

  let status = 2
  let canRespond = false

  if (type === 'leaves') {
    const lt = getLeaveType(payload.leaveTypeId)!
    const totalDays = calcLeaveDays(lt.dayCalculationType, payload.startDate, payload.endDate)
    cols.push('leave_type_id', 'leave_type_name', 'start_date', 'end_date', 'total_days', 'reason')
    vals.push(lt.id, lt.name, payload.startDate, payload.endDate, totalDays, payload.reason)
    if (lt.fundType !== 0) adjustBalance(emp.id, lt.fundType, 'pending', totalDays)
  } else if (type === 'late-earlies') {
    cols.push('request_date', 'late_early_type', 'requested_time', 'minutes', 'reason')
    vals.push(payload.requestDate, payload.lateEarlyType, payload.requestedTime, payload.minutes, payload.reason)
  } else if (type === 'overtimes') {
    const totalHours = computeOtHours(payload.startTime, payload.endTime)
    // Enforce cap OT theo luật (regulation.otMonthlyCapHours / otYearlyCapHours).
    enforceOtCap(emp.id, payload.otDate, totalHours)
    cols.push('ot_date', 'start_time', 'end_time', 'total_hours', 'compensation_type', 'reason')
    vals.push(payload.otDate, payload.startTime, payload.endTime, totalHours, payload.compensationType, payload.reason)
  } else if (type === 'business-trips') {
    const totalDays = workingDays(parseISO(payload.startDate), parseISO(payload.endDate))
    cols.push('start_date', 'end_date', 'total_days', 'location', 'purpose')
    vals.push(payload.startDate, payload.endDate, totalDays, payload.location, payload.purpose)
  } else if (type === 'shift-swaps') {
    const partner = payload.suggestedSwapPartnerId ? getEmployee(payload.suggestedSwapPartnerId) : null
    const mode = payload.shiftSwapMode
    cols.push('request_date', 'shift_swap_mode', 'suggested_swap_partner_id', 'suggested_swap_partner_name', 'swap_partner_status', 'reason')
    vals.push(payload.requestedDate, mode, payload.suggestedSwapPartnerId ?? null, partner?.fullName ?? null, mode === 2 ? 1 : 0, payload.reason)
    if (mode === 2) { status = 6; canRespond = true }
  } else {
    cols.push('request_date', 'update_type', 'new_check_in_time', 'new_check_out_time', 'new_work_hours', 'reason')
    vals.push(payload.requestDate, payload.updateType, payload.newCheckInTime ?? null, payload.newCheckOutTime ?? null, payload.newWorkHours ?? null, payload.reason)
  }

  if (status !== base.status) { vals[cols.indexOf('status')] = status }
  if (canRespond) { vals[cols.indexOf('capabilities')] = JSON.stringify({ canEdit: true, canCancel: true, canRespond: true }) }

  const placeholders = cols.map(() => '?').join(',')
  db.prepare(`INSERT INTO requests (${cols.join(',')}) VALUES (${placeholders})`).run(...vals)

  const req = getRequest(type, id)!
  if (req.status === 2) initApproval(req)
  return getRequest(type, id)!
}

function initApproval(req: any): void {
  const flow = FLOWS[req.type as RequestType]
  const step = flow[0]!
  const ap = resolveApprover(step.approver, req.employeeId)
  insertApprovalRow(req.id, req.type, 1, ap, 2, null, null)
  if (ap.userId) pushNotification(ap.userId, 'Có đơn mới chờ duyệt',
    `${req.employeeName} gửi ${labelType(req.type)} cần bạn duyệt${ap.onBehalfOfName ? ` (thay mặt ${ap.onBehalfOfName})` : ''}.`,
    6, 'request', req.id, `/employee/requests/${req.type}/${req.id}`)
}

/* --------------------------- Duyệt / Từ chối ------------------------------ */
export function approveRequest(userId: string, type: RequestType, id: string, comment: string, expectedVersion: number): any {
  const row = findReqRow(type, id)
  ensureVersion(row, expectedVersion)
  if (row.status !== 2 && row.status !== 8) throw httpError(409, 'Đơn không ở trạng thái chờ duyệt.')

  const flow = FLOWS[type]
  const currentLevel = row.current_level
  const apRow = db.prepare('SELECT * FROM request_approvals WHERE request_id=? AND level=?').get(id, currentLevel) as any
  if (apRow) db.prepare('UPDATE request_approvals SET status=3, comment=?, approved_at=? WHERE id=?').run(comment, isoNow(), apRow.id)

  // Vết audit — ghi rõ "thay mặt" nếu duyệt qua ủy quyền
  const auditDetail = `Duyệt ${labelType(type)} cấp ${currentLevel}${apRow?.on_behalf_of_name ? ` — ${apRow.approver_name}` : ''}`
  pushAudit(userId, getUserById(userId)?.email ?? '', 2, 'Request', id, auditDetail)

  let prevApproverUserId: string | null = apRow?.approver_user_id ?? null
  let nextStep: FlowStep | null = null
  for (const s of flow) {
    if (s.level <= currentLevel) continue
    const reqObj = getRequest(type, id)!
    if (!evalCondition(s.condition, reqObj)) {
      insertApprovalRow(id, type, s.level, { userId: null, name: '—' }, 5, 'Bỏ qua (điều kiện không thỏa)', isoNow())
      continue
    }
    const nap = resolveApprover(s.approver, row.employee_id)
    if (nap.userId && nap.userId === prevApproverUserId) {
      // Cùng một người duyệt → tự động duyệt cấp trùng
      insertApprovalRow(id, type, s.level, nap, 3, 'Cùng người duyệt — gộp cấp', isoNow())
      prevApproverUserId = nap.userId
      continue
    }
    nextStep = s
    break
  }

  if (nextStep) {
    const nextLevel = nextStep.level
    const nap = resolveApprover(nextStep.approver, row.employee_id)
    insertApprovalRow(id, type, nextLevel, nap, 2, null, null)
    db.prepare('UPDATE requests SET current_level=?, status=2, request_version=request_version+1, updated_at=? WHERE id=?').run(nextLevel, isoNow(), id)
    if (nap.userId) pushNotification(nap.userId, 'Đơn chuyển đến bạn duyệt',
      `${row.employee_name} — ${labelType(type)} (cấp ${nextLevel})${nap.onBehalfOfName ? ` (thay mặt ${nap.onBehalfOfName})` : ''}.`,
      6, 'request', id, `/employee/requests/${type}/${id}`)
  } else {
    // Recheck cap OT lúc duyệt cuối (phòng trường hợp HR giảm cap sau khi đơn tạo).
    if (type === 'overtimes') {
      const otReq = getRequest(type, id) as any
      enforceOtCap(otReq.employeeId, otReq.otDate, 0) // đơn đã nằm trong used → addHours=0
    }
    db.prepare('UPDATE requests SET status=3, request_version=request_version+1, updated_at=? WHERE id=?').run(isoNow(), id)
    applyApprovedEffect(type, id)
    // Tham vấn Giám đốc: đơn nghỉ >3 ngày → thông báo (không chặn)
    if (type === 'leaves') {
      const req = getRequest(type, id) as any
      if (req.totalDays > 3) {
        const dirUser = (db.prepare('SELECT * FROM users').all() as any[]).find((x) => JSON.parse(x.roles).includes('Director'))
        if (dirUser) {
          insertApprovalRow(id, type, 99, { userId: dirUser.id, name: dirUser.email }, 5, 'Tham vấn Giám đốc (thông báo, không chặn)', isoNow())
          pushNotification(dirUser.id, 'Tham vấn: đơn nghỉ >3 ngày đã duyệt',
            `${req.employeeName} nghỉ ${req.totalDays} ngày từ ${req.startDate} — trưởng phòng đã duyệt, thông báo Giám đốc biết.`,
            1, 'request', id, `/employee/requests/leaves/${id}`)
        }
      }
    }
    const ownerUser = getUserByEmployeeId(row.employee_id)
    if (ownerUser) pushNotification(ownerUser.id, 'Đơn được duyệt', `${labelType(type)} của bạn đã được duyệt hoàn toàn.`, 3, 'request', id, `/employee/requests/${type}/${id}`)
  }
  return getRequest(type, id)!
}

export function rejectRequest(_userId: string, type: RequestType, id: string, comment: string, expectedVersion: number): any {
  const row = findReqRow(type, id)
  ensureVersion(row, expectedVersion)
  if (row.status !== 2 && row.status !== 8 && row.status !== 6) throw httpError(409, 'Đơn không ở trạng thái có thể xử lý.')
  const apRow = db.prepare('SELECT * FROM request_approvals WHERE request_id=? AND level=?').get(id, row.current_level) as any
  if (apRow) db.prepare('UPDATE request_approvals SET status=4, comment=?, approved_at=? WHERE id=?').run(comment, isoNow(), apRow.id)
  db.prepare('UPDATE requests SET status=4, request_version=request_version+1, updated_at=? WHERE id=?').run(isoNow(), id)
  if (type === 'leaves') {
    const req = getRequest(type, id) as any
    const lt = getLeaveType(req.leaveTypeId)
    if (lt && lt.fundType !== 0) adjustBalance(req.employeeId, lt.fundType, 'cancel', req.totalDays)
  }
  const ownerUser = getUserByEmployeeId(row.employee_id)
  if (ownerUser) pushNotification(ownerUser.id, 'Đơn bị từ chối', `${labelType(type)} của bạn bị từ chối: ${comment}`, 4, 'request', id, `/employee/requests/${type}/${id}`)
  return getRequest(type, id)!
}

export function cancelRequest(type: RequestType, id: string, expectedVersion: number): any {
  const row = findReqRow(type, id)
  ensureVersion(row, expectedVersion)
  if (row.status === 3 || row.status === 4 || row.status === 5) throw httpError(409, 'Đơn không thể hủy ở trạng thái này.')
  if (type === 'leaves') {
    const req = getRequest(type, id) as any
    const lt = getLeaveType(req.leaveTypeId)
    if (lt && lt.fundType !== 0) adjustBalance(req.employeeId, lt.fundType, 'cancel', req.totalDays)
  }
  db.prepare('UPDATE requests SET status=5, request_version=request_version+1, updated_at=? WHERE id=?').run(isoNow(), id)
  return getRequest(type, id)!
}

export function updateRequest(_userId: string, type: RequestType, id: string, payload: any, expectedVersion: number): any {
  const row = findReqRow(type, id)
  ensureVersion(row, expectedVersion)
  if (row.status !== 1 && row.status !== 2 && row.status !== 6) throw httpError(409, 'Đơn không ở trạng thái có thể sửa.')
  const updates = payloadForType(type, payload)
  const setClauses = Object.keys(updates).map((k) => `${k}=?`).join(',')
  const vals = [...Object.values(updates), isoNow(), id]
  if (setClauses) db.prepare(`UPDATE requests SET ${setClauses}, request_version=request_version+1, updated_at=? WHERE id=?`).run(...vals)
  else db.prepare('UPDATE requests SET request_version=request_version+1, updated_at=? WHERE id=?').run(isoNow(), id)
  return getRequest(type, id)!
}

/* ----------------- Đồng nghiệp xác nhận đổi ca (MutualSwap) --------------- */
export function partnerRespond(userId: string, id: string, accepted: boolean, comment: string | null, expectedVersion: number): any {
  const row = db.prepare('SELECT * FROM requests WHERE id=? AND type="shift-swaps"').get(id) as any
  if (!row) throw httpError(404, 'Không tìm thấy đơn đổi ca.')
  ensureVersion(row, expectedVersion)
  if (row.status !== 6) throw httpError(409, 'Đơn không chờ bạn xác nhận.')
  if (accepted) {
    db.prepare('UPDATE requests SET swap_partner_status=2, status=2, request_version=request_version+1, updated_at=? WHERE id=?').run(isoNow(), id)
    const req = getRequest('shift-swaps', id)!
    initApproval(req)
  } else {
    db.prepare('UPDATE requests SET swap_partner_status=3, status=7, request_version=request_version+1, updated_at=? WHERE id=?').run(isoNow(), id)
  }
  const req = getRequest('shift-swaps', id)! as any
  const ownerUser = getUserByEmployeeId(req.employeeId)
  if (ownerUser) pushNotification(ownerUser.id, accepted ? 'Đồng nghiệp đồng ý đổi ca' : 'Đồng nghiệp từ chối đổi ca',
    accepted ? `${req.suggestedSwapPartnerName} đã đồng ý đổi ca. Đơn chuyển sang chờ duyệt.` : `${req.suggestedSwapPartnerName} từ chối: ${comment ?? ''}`,
    accepted ? 3 : 4, 'request', id, `/employee/requests/shift-swaps/${id}`)
  void userId
  return req
}

/* ------------------------------ Helper ------------------------------------ */
function applyApprovedEffect(type: RequestType, id: string): void {
  if (type === 'leaves') {
    const req = getRequest(type, id) as any
    const lt = getLeaveType(req.leaveTypeId)
    if (lt && lt.fundType !== 0) adjustBalance(req.employeeId, lt.fundType, 'approve', req.totalDays)
  }
  if (type === 'attendance-updates') {
    applyAttendanceUpdate(getRequest(type, id) as any)
  }
}

function applyAttendanceUpdate(req: any): void {
  const rec = db.prepare('SELECT * FROM attendance_records WHERE employee_id=? AND date=?').get(req.employeeId, req.requestDate) as any
  if (!rec) return
  if (req.updateType === 3) { db.prepare('UPDATE attendance_records SET is_active=0, updated_at=? WHERE id=?').run(isoNow(), rec.id); return }
  const cin = req.newCheckInTime ?? rec.check_in_time
  const cout = req.newCheckOutTime ?? rec.check_out_time
  const wh = req.newWorkHours ?? rec.actual_work_hours
  db.prepare(`UPDATE attendance_records SET check_in_time=?, check_out_time=?, actual_work_hours=?, status=5, main_status=1, updated_at=? WHERE id=?`)
    .run(cin, cout, wh, isoNow(), rec.id)
}

function adjustBalance(employeeId: string, fundType: number, action: 'pending' | 'approve' | 'cancel', days: number): void {
  const cat = fundType === 1 ? 1 : 5
  const year = new Date().getFullYear()
  let bal = db.prepare('SELECT * FROM leave_balances WHERE employee_id=? AND year=? AND leave_type_category=?').get(employeeId, year, cat) as any
  if (!bal) {
    const id = uid('lb')
    db.prepare(`INSERT INTO leave_balances (id, employee_id, year, leave_type_category, leave_type_name, allocated_days, used_days, pending_days) VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, employeeId, year, cat, cat === 1 ? 'Phép năm' : 'Phép bù', cat === 1 ? 12 : 4, 0, 0)
    bal = db.prepare('SELECT * FROM leave_balances WHERE id=?').get(id) as any
  }
  if (action === 'pending') bal.pending_days += days
  else if (action === 'approve') { bal.used_days += days; bal.pending_days = Math.max(0, bal.pending_days - days) }
  else if (action === 'cancel') bal.pending_days = Math.max(0, bal.pending_days - days)
  db.prepare('UPDATE leave_balances SET used_days=?, pending_days=? WHERE id=?').run(bal.used_days, bal.pending_days, bal.id)
}

function calcLeaveDays(calcType: number, start: string, end: string): number {
  if (calcType === 2) return calendarDays(parseISO(start), parseISO(end))
  if (calcType === 3) return 1
  return workingDays(parseISO(start), parseISO(end))
}
function computeOtHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let mins = (eh * 60 + em) - (sh * 60 + sm)
  if (mins < 0) mins += 24 * 60
  return Math.round((mins / 60) * 100) / 100
}

/** Tổng giờ OT đã dùng (pending + approved) trong cùng tháng/năm với otDate.
 *  Đếm status IN (2,3,8) để tránh tạo nhiều đơn rồi mới vượt cap. */
export function otUsedHours(employeeId: string, otDate: string): { monthUsed: number; yearUsed: number } {
  const ym = otDate.slice(0, 7) // YYYY-MM
  const yy = otDate.slice(0, 4) // YYYY
  const rows = db.prepare(
    `SELECT ot_date, total_hours FROM requests WHERE type='overtimes' AND employee_id=? AND status IN (2,3,8)`,
  ).all(employeeId) as any[]
  let monthUsed = 0, yearUsed = 0
  for (const r of rows) {
    const d = String(r.ot_date ?? '')
    if (d.startsWith(ym)) monthUsed += Number(r.total_hours ?? 0)
    if (d.startsWith(yy)) yearUsed += Number(r.total_hours ?? 0)
  }
  return { monthUsed: Math.round(monthUsed * 100) / 100, yearUsed: Math.round(yearUsed * 100) / 100 }
}

/** Kiểm tra vượt hạn mức OT (tháng/năm) theo regulation. Ném 409 nếu vượt.
 *  `addHours` = giờ của đơn đang tạo (0 khi recheck ở lúc duyệt — đơn đã nằm trong used). */
function enforceOtCap(employeeId: string, otDate: string, addHours: number): void {
  const reg = getRegulation()
  const monthCap = reg?.otMonthlyCapHours ?? 40
  const yearCap = reg?.otYearlyCapHours ?? 200
  const { monthUsed, yearUsed } = otUsedHours(employeeId, otDate)
  const monthAfter = Math.round((monthUsed + addHours) * 100) / 100
  const yearAfter = Math.round((yearUsed + addHours) * 100) / 100
  if (monthAfter > monthCap) {
    throw httpError(409, `Vượt hạn mức làm thêm tháng: đã dùng ${monthUsed}h + đơn này ${addHours}h = ${monthAfter}h > ${monthCap}h/tháng (theo luật).`)
  }
  if (yearAfter > yearCap) {
    throw httpError(409, `Vượt hạn mức làm thêm năm: đã dùng ${yearUsed}h + đơn này ${addHours}h = ${yearAfter}h > ${yearCap}h/năm (theo luật).`)
  }
}
function payloadForType(type: RequestType, p: any): Record<string, any> {
  const allowed: Record<RequestType, string[]> = {
    leaves: ['leave_type_id', 'start_date', 'end_date', 'total_days', 'reason'],
    'late-earlies': ['request_date', 'late_early_type', 'requested_time', 'minutes', 'reason'],
    overtimes: ['ot_date', 'start_time', 'end_time', 'total_hours', 'compensation_type', 'reason'],
    'business-trips': ['start_date', 'end_date', 'total_days', 'location', 'purpose'],
    'shift-swaps': ['request_date', 'shift_swap_mode', 'suggested_swap_partner_id', 'reason'],
    'attendance-updates': ['request_date', 'update_type', 'new_check_in_time', 'new_check_out_time', 'new_work_hours', 'reason'],
  }
  const colMap: Record<string, string> = {
    leave_type_id: 'leave_type_id', start_date: 'start_date', end_date: 'end_date', total_days: 'total_days', reason: 'reason',
    request_date: 'request_date', late_early_type: 'late_early_type', requested_time: 'requested_time', minutes: 'minutes',
    ot_date: 'ot_date', start_time: 'start_time', end_time: 'end_time', total_hours: 'total_hours', compensation_type: 'compensation_type',
    location: 'location', purpose: 'purpose', shift_swap_mode: 'shift_swap_mode',
    suggested_swap_partner_id: 'suggested_swap_partner_id', update_type: 'update_type',
    new_check_in_time: 'new_check_in_time', new_check_out_time: 'new_check_out_time', new_work_hours: 'new_work_hours',
  }
  const out: Record<string, any> = {}
  for (const k of allowed[type]) if (k in p) out[colMap[k]] = p[k]
  return out
}

function findReqRow(type: RequestType, id: string): any {
  const r = db.prepare('SELECT * FROM requests WHERE id=? AND type=?').get(id, type) as any
  if (!r) throw httpError(404, 'Không tìm thấy đơn.')
  return r
}
function ensureVersion(row: any, expected: number): void {
  if (row.request_version !== expected) throw httpError(409, `Phiên bản đơn không khớp (đã có người xử lý). Vui lòng tải lại. (kỳ vọng ${expected}, hiện tại ${row.request_version})`)
}

/* ---------------------- Capabilities & pending ---------------------------- */
export function computeCapabilities(req: any, userId: string): void {
  const user = getUserById(userId)
  const isOwner = user?.employeeId === req.employeeId
  req.capabilities = {
    canEdit: isOwner && (req.status === 1 || req.status === 2 || req.status === 6),
    canCancel: isOwner && (req.status === 1 || req.status === 2 || req.status === 6 || req.status === 8),
    canRespond: req.type === 'shift-swaps' && req.swapPartnerStatus === 1 && user?.employeeId === req.suggestedSwapPartnerId,
  }
}

export function pendingApprovals(userId: string): any[] {
  const user = getUserById(userId)
  if (!user) return []
  const isHR = user.roles.includes('HR') || user.roles.includes('Admin')
  const isDirector = user.roles.includes('Director') || user.roles.includes('Admin')
  const isAccountant = user.roles.includes('Accountant') || user.roles.includes('Admin')
  const reqs = allRequests()
  return reqs.filter((r: any) => {
    if (r.status !== 2 && r.status !== 8) return false
    const ap = r.approvals.find((a: any) => a.level === r.currentLevel && a.status === 2)
    if (!ap) return false
    if (ap.approverUserId === userId) return true
    // Approver theo vai trò: HR/Accountant/Director thấy đơn chờ vai trò của mình (kể cả qua ủy quyền)
    const approverName = String(ap.approverName ?? '')
    if (isHR && (approverName === 'HR' || approverName.includes('(thay mặt HR)'))) return true
    if (isAccountant && (approverName === 'Accountant' || approverName.includes('(thay mặt Accountant)'))) return true
    if (isDirector && (approverName === 'Director' || approverName.includes('(thay mặt Director)'))) return true
    if (user.roles.includes('Admin')) return true
    return false
  })
}