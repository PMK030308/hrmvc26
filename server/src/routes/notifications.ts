// Notifications routes (§14.8 / §10.3)
import { Router } from 'express'
import { db } from '../db.js'
import { requireAuth, type AuthedRequest } from '../middleware/auth.js'
import { mapNotification } from '../repo.js'
import { isoNow } from '../lib/date.js'

export const notificationsRouter = Router()

notificationsRouter.get('/', requireAuth, (req: AuthedRequest, res) => {
  const items = (db.prepare('SELECT * FROM notifications WHERE recipient_user_id=?').all(req.user!.id) as any[])
    .sort((a, b) => b.created_at.localeCompare(a.created_at)).map(mapNotification)
  res.json({ items, unread: items.filter((n) => !n.isRead).length })
})

notificationsRouter.post('/mark-read/:id', requireAuth, (req: AuthedRequest, res) => {
  db.prepare('UPDATE notifications SET is_read=1, read_at=? WHERE id=? AND recipient_user_id=?').run(isoNow(), req.params.id, req.user!.id)
  res.json({ ok: true })
})

notificationsRouter.post('/mark-all-read', requireAuth, (req: AuthedRequest, res) => {
  db.prepare('UPDATE notifications SET is_read=1, read_at=? WHERE recipient_user_id=?').run(isoNow(), req.user!.id)
  res.json({ ok: true })
})