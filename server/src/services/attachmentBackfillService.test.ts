import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { LocalAttachmentStorage } from './localAttachmentStorage.js'
import { migrateLegacyAttachments } from './attachmentBackfillService.js'

function attachmentDatabase(): Database.Database {
  const database = new Database(':memory:')
  database.exec(`CREATE TABLE request_attachments (
    id TEXT PRIMARY KEY, request_id TEXT NOT NULL, file_name TEXT NOT NULL, file_size INTEGER NOT NULL,
    mime_type TEXT NOT NULL, data_url TEXT NOT NULL, uploaded_at TEXT NOT NULL,
    uploaded_by_user_id TEXT, checksum_sha256 TEXT, storage_provider TEXT, storage_key TEXT, storage_migrated_at TEXT
  )`)
  return database
}

test('legacy attachment backfill defaults to dry-run and migrates verified rows idempotently', async () => {
  const database = attachmentDatabase()
  const root = mkdtempSync(join(tmpdir(), 'hrm-attachment-backfill-'))
  const pdf = Buffer.from('%PDF-1.4')
  try {
    database.prepare(`INSERT INTO request_attachments
      (id, request_id, file_name, file_size, mime_type, data_url, uploaded_at)
      VALUES ('legacy-1', 'request-1', 'proof.pdf', ?, 'application/pdf', ?, '2026-08-31T09:00:00')`)
      .run(pdf.length, `data:application/pdf;base64,${pdf.toString('base64')}`)
    const storage = new LocalAttachmentStorage(root)

    const dryRun = await migrateLegacyAttachments(database, storage, { batchSize: 10 })
    assert.deepEqual({ scanned: dryRun.scanned, migrated: dryRun.migrated, errors: dryRun.errors.length }, { scanned: 1, migrated: 0, errors: 0 })
    assert.equal((database.prepare("SELECT storage_key FROM request_attachments WHERE id='legacy-1'").get() as any).storage_key, null)

    const migrated = await migrateLegacyAttachments(database, storage, { dryRun: false, batchSize: 10 })
    assert.deepEqual({ scanned: migrated.scanned, migrated: migrated.migrated, errors: migrated.errors.length }, { scanned: 1, migrated: 1, errors: 0 })
    const row = database.prepare("SELECT storage_provider, storage_key, data_url FROM request_attachments WHERE id='legacy-1'").get() as any
    assert.equal(row.storage_provider, 'local')
    assert.match(row.storage_key, /^request-attachments\/legacy-1\/[a-f0-9]{64}$/)
    assert.notEqual(row.data_url, '')

    const repeat = await migrateLegacyAttachments(database, storage, { dryRun: false, batchSize: 10 })
    assert.deepEqual({ scanned: repeat.scanned, migrated: repeat.migrated }, { scanned: 0, migrated: 0 })
  } finally {
    database.close()
    rmSync(root, { recursive: true, force: true })
  }
})
test('legacy backfill reports corrupt rows without deleting payload or writing metadata', async () => {
  const database = attachmentDatabase()
  const root = mkdtempSync(join(tmpdir(), 'hrm-attachment-backfill-corrupt-'))
  try {
    database.prepare(`INSERT INTO request_attachments
      (id, request_id, file_name, file_size, mime_type, data_url, uploaded_at, checksum_sha256)
      VALUES ('corrupt-1', 'request-1', 'proof.pdf', 8, 'application/pdf',
        'data:application/pdf;base64,JVBERi0xLjQ=', '2026-08-31T09:00:00', 'deadbeef')`).run()
    const report = await migrateLegacyAttachments(database, new LocalAttachmentStorage(root), { dryRun: false })
    assert.equal(report.migrated, 0)
    assert.equal(report.errors.length, 1)
    const row = database.prepare("SELECT data_url, storage_key FROM request_attachments WHERE id='corrupt-1'").get() as any
    assert.notEqual(row.data_url, '')
    assert.equal(row.storage_key, null)
  } finally {
    database.close()
    rmSync(root, { recursive: true, force: true })
  }
})
