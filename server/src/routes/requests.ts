// Requests + Approvals routes (§14.5 / §14.6)
import { Router } from 'express'
import { db } from '../db.js'
import { requireAuth, type AuthedRequest } from '../middleware/auth.js'
import {
  getEmployee, allShifts, mapShift, getSchedule, getShift, mapRequest, getRequest, allRequests, mapAttachment, uid,
} from '../repo.js'
import { httpError } from '../types.js'
import { pushAudit } from '../helpers.js'
import {
  createRequest, approveRequest, rejectRequest, cancelRequest, updateRequest,
  partnerRespond, computeCapabilities, pendingApprovals,
} from '../engines/request.js'
import { isoNow } from '../lib/date.js'

const VALID_TYPES = ['leaves', 'late-earlies', 'overtimes', 'business-trips', 'shift-swaps', 'attendance-updates']

export const requestsRouter = Router()

requestsRouter.get('/mine', requireAuth, (req: AuthedRequest, res) => {
  const mine = (db.prepare('SELECT * FROM requests WHERE employee_id=?').all(req.user!.employeeId) as any[])
    .sort((a, b) => b.created_at.localeCompare(a.created_at)).map((r) => { const q = mapRequest(r); computeCapabilities(q, req.user!.id); return q })
  const pend = pendingApprovals(req.user!.id).map((r) => { computeCapabilities(r, req.user!.id); return r })
  res.json({ mine, pending: pend })
})

requestsRouter.get('/catalog', requireAuth, (req: AuthedRequest, res) => {
  const emp = getEmployee(req.user!.employeeId)!
  const swapPartners = (db.prepare('SELECT * FROM employees WHERE department_id=? AND id!=? AND status=2').all(emp.departmentId, emp.id) as any[])
    .map((e) => ({ id: e.id, name: e.full_name, code: e.employee_code }))
  res.json({
    leaveTypes: (db.prepare('SELECT * FROM leave_types').all() as any[]).map((r) => ({
      id: r.id, name: r.name, category: r.category, fundType: r.fund_type, maxDays: r.max_days,
      requireAttachment: !!r.require_attachment, requireReason: !!r.require_reason, dayCalculationType: r.day_calculation_type,
    })),
    shifts: allShifts(),
    swapPartners,
    businessTripLocations: ['Hà Nội', 'TP. HCM', 'Đà Nẵng', 'Hải Phòng', 'Cần Thơ'],
    lateEarlyTypes: [{ value: 1, label: 'Đi muộn' }, { value: 2, label: 'Về sớm' }],
    attendanceUpdateTypes: [{ value: 1, label: 'Thêm bản ghi' }, { value: 2, label: 'Sửa giờ chấm' }, { value: 3, label: 'Xóa bản ghi' }],
    compensationTypes: [{ value: 1, label: 'Trả lương' }, { value: 2, label: 'Bù nghỉ' }, { value: 3, label: 'Lương + Bù' }],
    shiftSwapModes: [{ value: 1, label: 'Tự đổi ca (chỉ mình)' }, { value: 2, label: 'Đổi với đồng nghiệp' }],
  })
})

requestsRouter.get('/:type', requireAuth, (req: AuthedRequest, res, next) => {
  const type = req.params.type
  if (!VALID_TYPES.includes(type)) return next(httpError(404, 'Không tìm thấy loại đơn.'))
  const user = req.user!
  const isAdmin = user.roles.some((r) => r === 'Admin' || r === 'HR' || r === 'Director')
  const isManager = user.roles.includes('Manager')
  const rows = (db.prepare('SELECT * FROM requests WHERE type=?').all(type) as any[]).filter((r) => {
    if (isAdmin) return true
    if (isManager) {
      const emp = getEmployee(r.employee_id)
      return user.departmentScopes.includes(emp?.departmentId ?? '') || r.employee_id === user.employeeId
    }
    return r.employee_id === user.employeeId
  }).sort((a, b) => b.created_at.localeCompare(a.created_at)).map((r) => { const q = mapRequest(r); computeCapabilities(q, user.id); return q })
  res.json(rows)
})

requestsRouter.get('/:type/:id', requireAuth, (req, res, next) => {
  const q = getRequest(req.params.type, req.params.id)
  if (!q) return next(httpError(404, 'Không tìm thấy đơn.'))
  computeCapabilities(q, (req as AuthedRequest).user!.id)
  res.json(q)
})

requestsRouter.post('/:type', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const type = req.params.type
    if (!VALID_TYPES.includes(type)) return next(httpError(404, 'Không tìm thấy loại đơn.'))
    const q = createRequest(req.user!.id, type as any, req.body)
    const emp = getEmployee(req.user!.employeeId)!
    pushAudit(req.user!.id, emp.fullName, 1, 'Request', q.id, `Tạo ${type} (#${q.id.slice(-6)})`)
    res.json(q)
  } catch (e) { next(e) }
})

requestsRouter.put('/:type/:id', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const q = updateRequest(req.user!.id, req.params.type as any, req.params.id, req.body, Number(req.body?.expectedVersion ?? req.body?.requestVersion))
    pushAudit(req.user!.id, req.user!.email, 2, 'Request', req.params.id, `Sửa đơn ${req.params.type}`)
    res.json(q)
  } catch (e) { next(e) }
})

requestsRouter.post('/:type/:id/cancel', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const q = cancelRequest(req.params.type as any, req.params.id, Number(req.body?.expectedVersion ?? req.body?.requestVersion))
    pushAudit(req.user!.id, req.user!.email, 3, 'Request', req.params.id, `Hủy đơn ${req.params.type}`)
    res.json(q)
  } catch (e) { next(e) }
})

requestsRouter.get('/:type/:id/timeline', requireAuth, (req, res, next) => {
  const q = getRequest(req.params.type, req.params.id)
  if (!q) return next(httpError(404, 'Không tìm thấy đơn.'))
  res.json(q.approvals)
})

requestsRouter.get('/:type/:id/attachments', requireAuth, (req, res) => {
  res.json((db.prepare('SELECT * FROM request_attachments WHERE request_id=?').all(req.params.id) as any[]).map(mapAttachment))
})

requestsRouter.post('/:type/:id/attachments', requireAuth, (req: AuthedRequest, res) => {
  const f = req.body ?? {}
  const id = uid('att')
  db.prepare(`INSERT INTO request_attachments (id, request_id, file_name, file_size, mime_type, data_url, uploaded_at) VALUES (?,?,?,?,?,?,?)`)
    .run(id, req.params.id, f.fileName, f.fileSize, f.mimeType, f.dataUrl, isoNow())
  pushAudit(req.user!.id, req.user!.email, 1, 'Attachment', id, `Đính kèm ${f.fileName} vào đơn ${req.params.id}`)
  res.json(mapAttachment(db.prepare('SELECT * FROM request_attachments WHERE id=?').get(id) as any))
})

requestsRouter.delete('/attachments/:attachmentId', requireAuth, (req: AuthedRequest, res) => {
  db.prepare('DELETE FROM request_attachments WHERE id=?').run(req.params.attachmentId)
  pushAudit(req.user!.id, req.user!.email, 3, 'Attachment', req.params.attachmentId, `Xóa đính kèm ${req.params.attachmentId}`)
  res.json({ ok: true })
})

requestsRouter.get('/my-shift/:date', requireAuth, (req: AuthedRequest, res) => {
  const sched = getSchedule(req.user!.employeeId, req.params.date)
  const shift = sched ? getShift(sched.shiftId) : null
  res.json({ shift, schedule: sched })
})

requestsRouter.get('/partner-shift/:partnerId/:date', requireAuth, (req, res) => {
  const sched = getSchedule(req.params.partnerId, req.params.date)
  res.json({ shift: sched ? getShift(sched.shiftId) : null })
})

requestsRouter.post('/shift-swaps/:id/partner-response', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const { accepted, rejectionReason, expectedVersion } = req.body ?? {}
    const q = partnerRespond(req.user!.id, req.params.id, !!accepted, rejectionReason ?? null, Number(expectedVersion))
    pushAudit(req.user!.id, req.user!.email, 2, 'ShiftSwap', req.params.id, accepted ? 'Đồng ý đổi ca' : 'Từ chối đổi ca')
    res.json(q)
  } catch (e) { next(e) }
})

/* --------------------------- Approvals ------------------------------------ */
export const approvalsRouter = Router()

approvalsRouter.get('/', requireAuth, (req: AuthedRequest, res) => {
  res.json(pendingApprovals(req.user!.id).map((r) => { computeCapabilities(r, req.user!.id); return r }))
})

approvalsRouter.post('/:type/:id/approve', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const { comment, expectedVersion } = req.body ?? {}
    const q = approveRequest(req.user!.id, req.params.type as any, req.params.id, comment ?? '', Number(expectedVersion))
    pushAudit(req.user!.id, req.user!.email, 2, 'Request', req.params.id, `Duyệt đơn ${req.params.type} (cấp ${q.currentLevel})`)
    res.json(q)
  } catch (e) { next(e) }
})

approvalsRouter.post('/:type/:id/reject', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const { comment, expectedVersion } = req.body ?? {}
    const q = rejectRequest(req.user!.id, req.params.type as any, req.params.id, comment ?? '', Number(expectedVersion))
    pushAudit(req.user!.id, req.user!.email, 2, 'Request', req.params.id, `Từ chối đơn ${req.params.type}: ${comment}`)
    res.json(q)
  } catch (e) { next(e) }
})