// ============================================================================
// Ủy quyền duyệt (Delegation) — quản lý cài người ủy quyền + khoảng vắng mặt.
// Trong khoảng đó, mọi đơn từ đáng lẽ gửi cho quản lý tự chuyển sang người ủy quyền
// (xử lý trong engines/request.ts resolveApprover) + ghi vết "thay mặt".
// ============================================================================
import { Router } from 'express'
import { db } from '../db.js'
import { requireAuth, type AuthedRequest } from '../middleware/auth.js'
import { uid, mapDelegation, getUserById, getEmployee } from '../repo.js'
import { httpError } from '../types.js'
import { pushAudit } from '../helpers.js'
import { ymd, nowVn, isoNow } from '../lib/date.js'
import { loadAuthorizationActor } from '../authz/authorizationActor.js'
import {
  canCreateDelegation, canRevokeDelegation, canViewAllDelegations, hasApprovalAuthority,
} from '../authz/delegationAuthorization.js'

export const delegationRouter = Router()

function eligibleDelegate(userId: string) {
  try {
    const actor = loadAuthorizationActor(userId)
    return hasApprovalAuthority(actor) ? actor : null
  } catch { return null }
}

// Danh sách người có thể được ủy quyền (approver roles, trừ chính mình) — cho form chọn.
delegationRouter.get('/approvers', requireAuth, (req: AuthedRequest, res) => {
  const me = req.user!.id
  const rows = (db.prepare('SELECT * FROM users WHERE is_active=1').all() as any[]).filter((u) => u.id !== me)
  const out = rows.map((u) => {
    const actor = eligibleDelegate(u.id)
    if (!actor) return null
    const emp = getEmployee(u.employee_id)
    return { userId: u.id, name: emp?.fullName ?? u.email, email: u.email, roles: actor.roles }
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
    const { delegateUserId, fromDate, toDate, reason } = req.body ?? {}
    if (!delegateUserId || !fromDate || !toDate) throw httpError(400, 'Thiếu người ủy quyền hoặc khoảng thời gian.')
    if (typeof delegateUserId !== 'string' || typeof fromDate !== 'string' || typeof toDate !== 'string') {
      throw httpError(400, 'Dữ liệu ủy quyền không hợp lệ.')
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
      throw httpError(400, 'Ngày ủy quyền không hợp lệ.')
    }
    if (fromDate > toDate) throw httpError(400, 'Từ ngày phải trước đến ngày.')
    if (delegateUserId === req.user!.id) throw httpError(400, 'Không thể ủy quyền cho chính mình.')
    const create = db.transaction(() => {
      const actor = loadAuthorizationActor(req.user!.id)
      if (!canCreateDelegation(actor)) throw httpError(403, 'Bạn không có quyền ủy quyền duyệt.')
      const delegateActor = eligibleDelegate(delegateUserId)
      if (!delegateActor) throw httpError(400, 'Người được ủy quyền không hoạt động hoặc không có quyền duyệt.')
      const overlap = db.prepare(`SELECT 1 FROM delegations
        WHERE delegator_user_id=? AND is_active=1 AND from_date<=? AND to_date>=? LIMIT 1`)
        .get(actor.userId, toDate, fromDate)
      if (overlap) throw httpError(409, 'Khoảng thời gian ủy quyền bị trùng với ủy quyền đang hoạt động.')
      const id = uid('dlg')
      db.prepare(`INSERT INTO delegations
        (id, delegator_user_id, delegate_user_id, from_date, to_date, reason, is_active, created_at)
        VALUES (?,?,?,?,?,?,1,?)`).run(
        id, actor.userId, delegateUserId, fromDate, toDate,
        typeof reason === 'string' ? reason.trim() || null : null, isoNow(),
      )
      const delegatorName = getEmployee(actor.employeeId)?.fullName ?? actor.email
      const delegate = getUserById(delegateActor.userId)!
      const delegateName = getEmployee(delegate.employeeId)?.fullName ?? delegate.email
      pushAudit(actor.userId, actor.email, 2, 'Delegation', id, `Ủy quyền duyệt: ${delegatorName} → ${delegateName} (${fromDate} → ${toDate})`)
      db.prepare(`INSERT INTO notifications
        (id, recipient_user_id, title, message, type, related_entity_type, related_entity_id, is_read, read_at, link_url, created_at)
        VALUES (?,?,?,?,?,?,?,0,NULL,NULL,?)`).run(
        uid('nt'), delegateUserId, 'Bạn được ủy quyền duyệt đơn',
        `${delegatorName} đã ủy quyền bạn duyệt đơn từ ${fromDate} đến ${toDate}.`,
        6, 'delegation', id, isoNow(),
      )
      return { ...mapDelegation(db.prepare('SELECT * FROM delegations WHERE id=?').get(id) as any), delegatorName, delegateName }
    })
    res.json(create.immediate())
  } catch (e) { next(e) }
})

// Hủy ủy quyền
delegationRouter.delete('/:id', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const revoke = db.transaction(() => {
      const actor = loadAuthorizationActor(req.user!.id)
      const row = db.prepare('SELECT * FROM delegations WHERE id=?').get(req.params.id) as any
      if (!row || !canRevokeDelegation(actor, { delegatorUserId: row.delegator_user_id })) {
        throw httpError(404, 'Không tìm thấy ủy quyền.')
      }
      const result = db.prepare('UPDATE delegations SET is_active=0 WHERE id=? AND is_active=1').run(req.params.id)
      if (result.changes !== 1) throw httpError(409, 'Ủy quyền đã được thu hồi.')
      pushAudit(actor.userId, actor.email, 3, 'Delegation', req.params.id, 'Hủy ủy quyền duyệt')
    })
    revoke.immediate()
    res.json({ ok: true })
  } catch (e) { next(e) }
})

// (HR/Admin) xem tất cả ủy quyền — phục vụ giám sát
delegationRouter.get('/all', requireAuth, (req: AuthedRequest, res, next) => {
  if (!req.authorizationActor || !canViewAllDelegations(req.authorizationActor)) {
    return next(httpError(403, 'Bạn không có quyền xem tất cả ủy quyền.'))
  }
  const today = ymd(nowVn())
  res.json((db.prepare('SELECT * FROM delegations ORDER BY from_date DESC').all() as any[]).map((d) => {
    const r = mapDelegation(d)
    return { ...r, delegatorName: getEmployee(getUserById(r.delegatorUserId)?.employeeId ?? '')?.fullName ?? r.delegatorUserId, delegateName: getEmployee(getUserById(r.delegateUserId)?.employeeId ?? '')?.fullName ?? r.delegateUserId, isActiveNow: r.isActive && r.fromDate <= today && r.toDate >= today }
  }))
})
