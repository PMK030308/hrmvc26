// ============================================================================
// Ủy quyền duyệt (Delegation) — quản lý cài người ủy quyền + khoảng vắng mặt.
// Trong khoảng đó, mọi đơn từ đáng lẽ gửi cho quản lý tự chuyển sang người ủy quyền
// (xử lý trong engines/request.ts resolveApprover) + ghi vết "thay mặt".
// ============================================================================
import { Router } from 'express'
import { db } from '../db.js'
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.js'
import { uid, mapDelegation, getUserById, getEmployee } from '../repo.js'
import { httpError } from '../types.js'
import { pushAudit } from '../helpers.js'
import { ymd, nowVn, isoNow } from '../lib/date.js'

export const delegationRouter = Router()

const APPROVER_ROLES = ['Manager', 'HR', 'Director', 'Accountant', 'Admin']

function canDelegate(req: AuthedRequest): boolean {
  return req.user!.roles.some((r: string) => APPROVER_ROLES.includes(r))
}

// Danh sách người có thể được ủy quyền (approver roles, trừ chính mình) — cho form chọn.
delegationRouter.get('/approvers', requireAuth, (req: AuthedRequest, res) => {
  const me = req.user!.id
  const rows = (db.prepare('SELECT * FROM users').all() as any[]).filter((u) => u.id !== me)
  const out = rows.map((u) => {
    const roles = JSON.parse(u.roles ?? '[]')
    if (!roles.some((r: string) => APPROVER_ROLES.includes(r))) return null
    const emp = getEmployee(u.employee_id)
    return { userId: u.id, name: emp?.fullName ?? u.email, email: u.email, roles }
  }).filter(Boolean)
  res.json(out)
})

// Danh sách ủy quyền: của tôi (tôi ủy quyền) + tôi là người được ủy quyền
delegationRouter.get('/', requireAuth, (req: AuthedRequest, res) => {
  const uid_ = req.user!.id
  const asDelegator = (db.prepare('SELECT * FROM delegations WHERE delegator_user_id=? ORDER BY created_at DESC').all(uid_) as any[]).map(mapDelegation)
  const asDelegate = (db.prepare('SELECT * FROM delegations WHERE delegate_user_id=? AND is_active=1 ORDER BY created_at DESC').all(uid_) as any[]).map(mapDelegation)
  // Kèm tên hiển thị
  const enrich = (d: any) => ({
    ...d,
    delegatorName: getEmployee(getUserById(d.delegatorUserId)?.employeeId ?? '')?.fullName ?? d.delegatorUserId,
    delegateName: getEmployee(getUserById(d.delegateUserId)?.employeeId ?? '')?.fullName ?? d.delegateUserId,
  })
  res.json({ asDelegator: asDelegator.map(enrich), asDelegate: asDelegate.map(enrich) })
})

// Tạo ủy quyền
delegationRouter.post('/', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    if (!canDelegate(req)) throw httpError(403, 'Vai trò của bạn không được ủy quyền duyệt.')
    const { delegateUserId, fromDate, toDate, reason } = req.body ?? {}
    if (!delegateUserId || !fromDate || !toDate) throw httpError(400, 'Thiếu người ủy quyền hoặc khoảng thời gian.')
    if (fromDate > toDate) throw httpError(400, 'Từ ngày phải trước đến ngày.')
    if (delegateUserId === req.user!.id) throw httpError(400, 'Không thể ủy quyền cho chính mình.')
    const delegate = getUserById(delegateUserId)
    if (!delegate) throw httpError(404, 'Không tìm thấy người được ủy quyền.')
    const id = uid('dlg')
    db.prepare(`INSERT INTO delegations (id, delegator_user_id, delegate_user_id, from_date, to_date, reason, is_active, created_at) VALUES (?,?,?,?,?,?,1,?)`)
      .run(id, req.user!.id, delegateUserId, fromDate, toDate, reason ?? null, isoNow())
    const delegatorName = getEmployee(req.user!.employeeId)?.fullName ?? req.user!.email
    const delegateName = getEmployee(delegate.employeeId)?.fullName ?? delegate.email
    pushAudit(req.user!.id, req.user!.email, 2, 'Delegation', id, `Ủy quyền duyệt: ${delegatorName} → ${delegateName} (${fromDate} → ${toDate})`)
    // Thông báo cho người được ủy quyền
    db.prepare(`INSERT INTO notifications (id, recipient_user_id, title, message, type, related_entity_type, related_entity_id, is_read, read_at, link_url, created_at) VALUES (?,?,?,?,?,?,?,0,NULL,NULL,?)`)
      .run(uid('nt'), delegateUserId, 'Bạn được ủy quyền duyệt đơn', `${delegatorName} đã ủy quyền bạn duyệt đơn từ ${fromDate} đến ${toDate}. Trong thời gian này đơn sẽ chuyển tới bạn.`, 6, 'delegation', id, isoNow())
    res.json({ ...mapDelegation(db.prepare('SELECT * FROM delegations WHERE id=?').get(id) as any), delegatorName, delegateName })
  } catch (e) { next(e) }
})

// Hủy ủy quyền
delegationRouter.delete('/:id', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const row = db.prepare('SELECT * FROM delegations WHERE id=?').get(req.params.id) as any
    if (!row) throw httpError(404, 'Không tìm thấy ủy quyền.')
    if (row.delegator_user_id !== req.user!.id && !req.user!.roles.includes('Admin')) throw httpError(403, 'Bạn không phải người tạo ủy quyền này.')
    db.prepare('UPDATE delegations SET is_active=0 WHERE id=?').run(req.params.id)
    pushAudit(req.user!.id, req.user!.email, 3, 'Delegation', req.params.id, 'Hủy ủy quyền duyệt')
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// (HR/Admin) xem tất cả ủy quyền — phục vụ giám sát
delegationRouter.get('/all', requireAuth, requireRole('HR', 'Admin'), (_req, res) => {
  const today = ymd(nowVn())
  res.json((db.prepare('SELECT * FROM delegations ORDER BY from_date DESC').all() as any[]).map((d) => {
    const r = mapDelegation(d)
    return { ...r, delegatorName: getEmployee(getUserById(r.delegatorUserId)?.employeeId ?? '')?.fullName ?? r.delegatorUserId, delegateName: getEmployee(getUserById(r.delegateUserId)?.employeeId ?? '')?.fullName ?? r.delegateUserId, isActiveNow: r.isActive && r.fromDate <= today && r.toDate >= today }
  }))
})