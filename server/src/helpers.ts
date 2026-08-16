// ============================================================================
// Helper ghi audit log + thông báo vào DB (dùng nội bộ bởi routes & engines).
// ============================================================================
import { db } from './db.js'
import { uid } from './repo.js'
import { isoNow } from './lib/date.js'

export type AuditAction = 1 | 2 | 3 | 4 | 5 | 6 // Create|Update|Delete|Login|Logout|View

export function pushAudit(
  userId: string, userName: string, action: number, entity: string,
  entityId: string | null, detail: string, ipAddress = '127.0.0.1',
): void {
  db.prepare(`INSERT INTO audit_logs (id, user_id, user_name, action, entity, entity_id, detail, ip_address, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, userId, userName, action, entity, entityId, detail, ipAddress, isoNow())
}

export function pushNotification(
  recipientUserId: string, title: string, message: string,
  type: 1 | 2 | 3 | 4 | 5 | 6, relatedEntityType: string | null, relatedEntityId: string | null, linkUrl: string | null,
): void {
  if (!recipientUserId) return
  db.prepare(`INSERT INTO notifications (id, recipient_user_id, title, message, type, related_entity_type, related_entity_id, is_read, read_at, link_url, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`).run(
    uid('nt'), recipientUserId, title, message, type, relatedEntityType, relatedEntityId, linkUrl, isoNow())
}

export { uid }