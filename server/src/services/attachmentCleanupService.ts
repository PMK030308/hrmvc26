import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { isoNow } from '../lib/date.js'
import type { AttachmentStorage } from './attachmentStorage.js'

function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'Attachment storage cleanup thất bại.'
  return raw
    .replace(/\b(?:secret|token|password|api[_-]?key)\s*=\s*\S+/gi, '[redacted]')
    .slice(0, 500)
}

export function queueAttachmentCleanup(
  database: Database.Database,
  storageProvider: string,
  storageKey: string,
  initialError?: unknown,
): string {
  if (!storageProvider || !storageKey) throw new Error('Thiếu attachment storage cleanup target.')
  const existing = database.prepare(`SELECT id FROM attachment_storage_cleanup
    WHERE storage_provider=? AND storage_key=? AND completed_at IS NULL LIMIT 1`).get(storageProvider, storageKey) as any
  if (existing) return existing.id
  const id = randomUUID()
  database.prepare(`INSERT INTO attachment_storage_cleanup
    (id, storage_provider, storage_key, created_at, last_attempt_at, last_error, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)`)
    .run(id, storageProvider, storageKey, isoNow(), initialError ? isoNow() : null, initialError ? safeErrorMessage(initialError) : null)
  return id
}

export function completeAttachmentCleanup(database: Database.Database, cleanupId: string): void {
  database.prepare(`UPDATE attachment_storage_cleanup
    SET completed_at=COALESCE(completed_at, ?), last_attempt_at=?, last_error=NULL WHERE id=?`)
    .run(isoNow(), isoNow(), cleanupId)
}

export function failAttachmentCleanup(database: Database.Database, cleanupId: string, error: unknown): void {
  database.prepare(`UPDATE attachment_storage_cleanup SET last_attempt_at=?, last_error=?
    WHERE id=? AND completed_at IS NULL`).run(isoNow(), safeErrorMessage(error), cleanupId)
}

export async function processAttachmentStorageCleanup(
  database: Database.Database,
  resolveStorage: (provider: string) => AttachmentStorage,
  options: { batchSize?: number } = {},
): Promise<{ scanned: number; completed: number; failed: number }> {
  const batchSize = Number.isSafeInteger(options.batchSize) && Number(options.batchSize) > 0
    ? Math.min(Number(options.batchSize), 500)
    : 100
  const rows = database.prepare(`SELECT id, storage_provider, storage_key FROM attachment_storage_cleanup
    WHERE completed_at IS NULL ORDER BY created_at, id LIMIT ?`).all(batchSize) as any[]
  const report = { scanned: rows.length, completed: 0, failed: 0 }
  for (const row of rows) {
    try {
      await resolveStorage(row.storage_provider).delete(row.storage_key)
      completeAttachmentCleanup(database, row.id)
      report.completed += 1
    } catch (error) {
      failAttachmentCleanup(database, row.id, error)
      report.failed += 1
    }
  }
  return report
}
