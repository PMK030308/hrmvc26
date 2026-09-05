// Audit log routes (§A5)
import { Router } from 'express'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { db } from '../db.js'
import { mapAuditLog } from '../repo.js'
import { httpError } from '../types.js'
import { createTabularExcel, XLSX_MIME } from '../services/tabularDocumentService.js'
import { pushAudit } from '../helpers.js'
import type { AuthedRequest } from '../middleware/auth.js'

export const auditRouter = Router()

auditRouter.get('/export-excel', requireAuth, requirePermission('audit.view'), async (req: AuthedRequest, res, next) => {
  try {
    const rows = (db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC').all() as any[]).map((row) => ({
      createdAt: row.created_at, userName: row.user_name, action: row.action, entity: row.entity,
      entityId: row.entity_id, detail: row.detail, ipAddress: row.ip_address,
    }))
    const file = await createTabularExcel({
      title: 'Audit log hệ thống', subtitle: `${rows.length} bản ghi`, sheetName: 'Audit log', rows,
      columns: [
        { header: 'Thời gian', key: 'createdAt', width: 24 }, { header: 'Người dùng', key: 'userName', width: 26 },
        { header: 'Hành động', key: 'action', width: 12, numeric: true }, { header: 'Đối tượng', key: 'entity', width: 20 },
        { header: 'ID đối tượng', key: 'entityId', width: 24 }, { header: 'Chi tiết', key: 'detail', width: 50 },
        { header: 'IP', key: 'ipAddress', width: 18 },
      ],
    })
    res.setHeader('Content-Type', XLSX_MIME)
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.xlsx"')
    pushAudit(req.user!.id, req.user!.email, 6, 'AuditExport', null, `Xuất ${rows.length} bản ghi audit`)
    res.send(file)
  } catch (error) { next(error) }
})

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
