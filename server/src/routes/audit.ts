// Audit log routes (§A5)
import { Router } from 'express'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { db } from '../db.js'
import { mapAuditLog } from '../repo.js'

export const auditRouter = Router()

auditRouter.get('/', requireAuth, requireRole('Admin'), (req, res) => {
  const page = Number(req.query.page) || 1
  const pageSize = Number(req.query.pageSize) || 50
  const total = (db.prepare('SELECT COUNT(*) c FROM audit_logs').get() as any).c
  const items = (db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?').all(pageSize, (page - 1) * pageSize) as any[]).map(mapAuditLog)
  res.json({ items, total })
})