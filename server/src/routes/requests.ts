// Requests + Approvals routes (§14.5 / §14.6)
import { Router } from 'express'
import { db } from '../db.js'
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js'
import {
  getEmployee, allShifts, mapShift, getSchedule, getShift, mapRequest, getRequest, allRequests, mapAttachment, uid,
} from '../repo.js'
import { httpError } from '../types.js'
import { pushAudit } from '../helpers.js'
import {
  createRequest, approveRequest, rejectRequest, cancelRequest, updateRequest,
  partnerRespond, computeCapabilities, pendingApprovals, otUsedHours,
} from '../engines/request.js'
import { isoNow, ymd, nowVn } from '../lib/date.js'
import { getRegulation } from '../repo.js'
import { REQUEST_PERMISSIONS, canManageRequestAttachment, canViewRequest } from '../authz/requestAuthorization.js'
import { assertAuthorizedAction, loadRequestActor, loadRequestAuthorizationContext, requireViewableRequest } from '../authz/requestAuthorizationContext.js'
import { isEligibleShiftSwapPartner, listEligibleShiftSwapPartners } from '../authz/shiftSwapPartnerAuthorization.js'

const VALID_TYPES = ['leaves', 'late-earlies', 'overtimes', 'business-trips', 'shift-swaps', 'attendance-updates']

export const requestsRouter = Router()

requestsRouter.get('/mine', requireAuth, (req: AuthedRequest, res) => {
  const actor = loadRequestActor(req.user!.id)
  const mine = (db.prepare('SELECT * FROM requests WHERE employee_id=?').all(req.user!.employeeId) as any[])
    .filter((r) => {
      const context = loadRequestAuthorizationContext(r.type, r.id)
      return !!context && canViewRequest(actor, context)
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at)).map((r) => { const q = mapRequest(r); computeCapabilities(q, actor.userId); return q })
  const pend = pendingApprovals(actor.userId).map((r) => { computeCapabilities(r, actor.userId); return r })
  res.json({ mine, pending: pend })
})

requestsRouter.get('/catalog', requireAuth, requirePermission(REQUEST_PERMISSIONS.CREATE_OWN), (req: AuthedRequest, res) => {
  const actor = loadRequestActor(req.user!.id)
  const swapPartners = listEligibleShiftSwapPartners(actor)
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

// Tiến độ OT của NV hiện tại theo tháng/năm của `date` (cho form tạo đơn OT hiển thị cap).
requestsRouter.get('/ot-usage', requireAuth, requirePermission(REQUEST_PERMISSIONS.CREATE_OWN), (req: AuthedRequest, res) => {
  const date = String(req.query.date ?? ymd(nowVn()))
  const reg = getRegulation()
  const { monthUsed, yearUsed } = otUsedHours(req.user!.employeeId, date)
  res.json({
    date, monthUsed, yearUsed,
    monthCap: reg?.otMonthlyCapHours ?? 40,
    yearCap: reg?.otYearlyCapHours ?? 200,
  })
})

// Static helpers must be declared before /:type and /:type/:id.
requestsRouter.get('/my-shift/:date', requireAuth, (req: AuthedRequest, res) => {
  const sched = getSchedule(req.user!.employeeId, req.params.date)
  const shift = sched ? getShift(sched.shiftId) : null
  res.json({ shift, schedule: sched })
})

requestsRouter.get('/partner-shift/:partnerId/:date', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const actor = loadRequestActor(req.user!.id)
    if (!isEligibleShiftSwapPartner(actor, req.params.partnerId)) throw httpError(404, 'Không tìm thấy ca của đối tác.')
    const sched = getSchedule(req.params.partnerId, req.params.date)
    res.json({ shift: sched ? getShift(sched.shiftId) : null })
  } catch (error) { next(error) }
})

requestsRouter.get('/:type', requireAuth, (req: AuthedRequest, res, next) => {
  const type = req.params.type
  if (!VALID_TYPES.includes(type)) return next(httpError(404, 'Không tìm thấy loại đơn.'))
  const actor = loadRequestActor(req.user!.id)
  const rows = (db.prepare('SELECT * FROM requests WHERE type=?').all(type) as any[]).filter((r) => {
    const context = loadRequestAuthorizationContext(type, r.id)
    return !!context && canViewRequest(actor, context)
  }).sort((a, b) => b.created_at.localeCompare(a.created_at)).map((r) => { const q = mapRequest(r); computeCapabilities(q, actor.userId); return q })
  res.json(rows)
})

requestsRouter.get('/:type/:id', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const actor = loadRequestActor(req.user!.id)
    requireViewableRequest(actor, req.params.type, req.params.id)
    const q = getRequest(req.params.type, req.params.id)!
    computeCapabilities(q, actor.userId)
    res.json(q)
  } catch (e) { next(e) }
})

requestsRouter.post('/:type', requireAuth, requirePermission(REQUEST_PERMISSIONS.CREATE_OWN), (req: AuthedRequest, res, next) => {
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
    res.json(q)
  } catch (e) { next(e) }
})

requestsRouter.post('/:type/:id/cancel', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const q = cancelRequest(req.user!.id, req.params.type as any, req.params.id, Number(req.body?.expectedVersion ?? req.body?.requestVersion))
    res.json(q)
  } catch (e) { next(e) }
})

requestsRouter.get('/:type/:id/timeline', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const actor = loadRequestActor(req.user!.id)
    requireViewableRequest(actor, req.params.type, req.params.id)
    res.json(getRequest(req.params.type, req.params.id)!.approvals)
  } catch (e) { next(e) }
})

requestsRouter.get('/:type/:id/attachments', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const actor = loadRequestActor(req.user!.id)
    const context = requireViewableRequest(actor, req.params.type, req.params.id)
    if (!canManageRequestAttachment(actor, context, 'read')) throw httpError(403, 'Bạn không có quyền đọc file đính kèm.')
    res.json((db.prepare('SELECT * FROM request_attachments WHERE request_id=?').all(req.params.id) as any[]).map(mapAttachment))
  } catch (e) { next(e) }
})

requestsRouter.post('/:type/:id/attachments', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const attachment = db.transaction(() => {
      const actor = loadRequestActor(req.user!.id)
      const context = loadRequestAuthorizationContext(req.params.type, req.params.id)
      if (!context) throw httpError(404, 'Không tìm thấy đơn.')
      assertAuthorizedAction(actor, context, canManageRequestAttachment(actor, context, 'upload'))
      const file = req.body ?? {}
      const attachmentId = uid('att')
      db.prepare(`INSERT INTO request_attachments (id, request_id, file_name, file_size, mime_type, data_url, uploaded_at) VALUES (?,?,?,?,?,?,?)`)
        .run(attachmentId, req.params.id, file.fileName, file.fileSize, file.mimeType, file.dataUrl, isoNow())
      pushAudit(req.user!.id, req.user!.email, 1, 'Attachment', attachmentId, `Đính kèm ${file.fileName} vào đơn ${req.params.id}`)
      return mapAttachment(db.prepare('SELECT * FROM request_attachments WHERE id=?').get(attachmentId) as any)
    })()
    res.json(attachment)
  } catch (e) { next(e) }
})

requestsRouter.delete('/attachments/:attachmentId', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    db.transaction(() => {
      const attachment = db.prepare(`SELECT a.*, r.type FROM request_attachments a
        JOIN requests r ON r.id=a.request_id WHERE a.id=?`).get(req.params.attachmentId) as any
      if (!attachment) throw httpError(404, 'Không tìm thấy file đính kèm.')
      const actor = loadRequestActor(req.user!.id)
      const context = loadRequestAuthorizationContext(attachment.type, attachment.request_id)
      if (!context) throw httpError(404, 'Không tìm thấy file đính kèm.')
      assertAuthorizedAction(actor, context, canManageRequestAttachment(actor, context, 'delete'))
      const deleted = db.prepare('DELETE FROM request_attachments WHERE id=?').run(req.params.attachmentId)
      if (deleted.changes !== 1) throw httpError(404, 'Không tìm thấy file đính kèm.')
      pushAudit(req.user!.id, req.user!.email, 3, 'Attachment', req.params.attachmentId, `Xóa đính kèm ${req.params.attachmentId}`)
    })()
    res.json({ ok: true })
  } catch (e) { next(e) }
})

requestsRouter.post('/shift-swaps/:id/partner-response', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const { accepted, rejectionReason, expectedVersion } = req.body ?? {}
    const q = partnerRespond(req.user!.id, req.params.id, !!accepted, rejectionReason ?? null, Number(expectedVersion))
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
    res.json(q)
  } catch (e) { next(e) }
})

approvalsRouter.post('/:type/:id/reject', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const { comment, expectedVersion } = req.body ?? {}
    const q = rejectRequest(req.user!.id, req.params.type as any, req.params.id, comment ?? '', Number(expectedVersion))
    res.json(q)
  } catch (e) { next(e) }
})
