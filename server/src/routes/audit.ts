// Audit log routes (§A5)
import { Router } from 'express'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { db } from '../db.js'
import { mapAuditLog } from '../repo.js'
import { httpError } from '../types.js'

export const auditRouter = Router()

auditRouter.get('/', requireAuth, requirePermission('audit.view'), (req, res, next) => {
  try {
    const page = req.query.page === undefined ? 1 : Number(req.query.page)
    const requestedPageSize = req.query.pageSize === undefined ? 50 : Number(req.query.pageSize)
    if (!Number.isInteger(page) || page < 1) throw httpError(400, 'Trang không hợp lệ.')
    if (!Number.isInteger(requestedPageSize) || requestedPageSize < 1) throw httpError(400, 'Kích thước trang không hợp lệ.')
    const pageSize = Math.min(requestedPageSize, 100)
    const total = (db.prepare('SELECT COUNT(*) c FROM audit_logs').get() as any).c
    const items = (db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(pageSize, (page - 1) * pageSize) as any[]).map(mapAuditLog)
    res.json({ items, total, page, pageSize })
  } catch (error) { next(error) }
})
