import type Database from 'better-sqlite3'
import { isoNow } from '../lib/date.js'
import { prepareAttachmentUpload } from './attachmentService.js'
import type { AttachmentStorage } from './attachmentStorage.js'
import { attachmentStorageKey, checksumSha256, streamToBuffer } from './attachmentStorage.js'

export interface AttachmentBackfillOptions {
  dryRun?: boolean
  batchSize?: number
}

export interface AttachmentBackfillReport {
  dryRun: boolean
  scanned: number
  migrated: number
  skipped: number
  errors: Array<{ id: string; message: string }>
}

export async function migrateLegacyAttachments(
  database: Database.Database,
  storage: AttachmentStorage,
  options: AttachmentBackfillOptions = {},
): Promise<AttachmentBackfillReport> {
  const dryRun = options.dryRun !== false
  const batchSize = Number.isSafeInteger(options.batchSize) && Number(options.batchSize) > 0
    ? Math.min(Number(options.batchSize), 500)
    : 100
  const rows = database.prepare(`SELECT * FROM request_attachments
    WHERE storage_key IS NULL AND data_url <> '' ORDER BY id LIMIT ?`).all(batchSize) as any[]
  const report: AttachmentBackfillReport = { dryRun, scanned: rows.length, migrated: 0, skipped: 0, errors: [] }

  for (const row of rows) {
    try {
      const prepared = prepareAttachmentUpload({
        fileName: row.file_name,
        fileSize: row.file_size,
        mimeType: row.mime_type,
        dataUrl: row.data_url,
      }, row.uploaded_by_user_id || 'legacy-backfill')
      if (row.checksum_sha256 && row.checksum_sha256 !== prepared.checksumSha256) throw new Error('Checksum legacy attachment không khớp.')
      if (dryRun) continue

      const key = attachmentStorageKey(row.id, prepared.checksumSha256)
      await storage.put({
        key,
        content: prepared.content,
        contentType: prepared.mimeType,
        checksumSha256: prepared.checksumSha256,
      })
      const stored = await storage.open(key)
      const verified = await streamToBuffer(stored.stream, prepared.fileSize)
      if (stored.size !== prepared.fileSize || checksumSha256(verified) !== prepared.checksumSha256) {
        throw new Error('Attachment storage verification thất bại sau khi ghi.')
      }
      const updated = database.prepare(`UPDATE request_attachments
        SET storage_provider=?, storage_key=?, storage_migrated_at=?, checksum_sha256=COALESCE(checksum_sha256, ?)
        WHERE id=? AND storage_key IS NULL`).run(storage.provider, key, isoNow(), prepared.checksumSha256, row.id)
      if (updated.changes === 1) report.migrated += 1
      else report.skipped += 1
    } catch (error) {
      report.errors.push({ id: row.id, message: error instanceof Error ? error.message : 'Attachment backfill thất bại.' })
    }
  }
  return report
}
