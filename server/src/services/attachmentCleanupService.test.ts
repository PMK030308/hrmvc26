import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { attachmentStorageKey } from './attachmentStorage.js'
import { LocalAttachmentStorage } from './localAttachmentStorage.js'
import { completeAttachmentCleanup, processAttachmentStorageCleanup, queueAttachmentCleanup } from './attachmentCleanupService.js'

function cleanupDatabase(): Database.Database {
  const database = new Database(':memory:')
  database.exec(`CREATE TABLE attachment_storage_cleanup (
    id TEXT PRIMARY KEY, storage_provider TEXT NOT NULL, storage_key TEXT NOT NULL,
    created_at TEXT NOT NULL, last_attempt_at TEXT, last_error TEXT, completed_at TEXT
  )`)
  return database
}

test('attachment cleanup queue retries provider failures and completes idempotently', async () => {
  const database = cleanupDatabase()
  const root = mkdtempSync(join(tmpdir(), 'hrm-attachment-cleanup-'))
  const storage = new LocalAttachmentStorage(root)
  const content = Buffer.from('%PDF-1.4')
  const checksum = createHash('sha256').update(content).digest('hex')
  const key = attachmentStorageKey('cleanup-1', checksum)
  try {
    await storage.put({ key, content, contentType: 'application/pdf', checksumSha256: checksum })
    const cleanupId = queueAttachmentCleanup(database, 'local', key)
    const report = await processAttachmentStorageCleanup(database, () => storage, { batchSize: 10 })
    assert.deepEqual(report, { scanned: 1, completed: 1, failed: 0 })
    assert.equal((await storage.head(key)).exists, false)
    assert.equal((database.prepare('SELECT completed_at FROM attachment_storage_cleanup WHERE id=?').get(cleanupId) as any).completed_at != null, true)

    completeAttachmentCleanup(database, cleanupId)
    const repeat = await processAttachmentStorageCleanup(database, () => storage, { batchSize: 10 })
    assert.deepEqual(repeat, { scanned: 0, completed: 0, failed: 0 })
  } finally {
    database.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('attachment cleanup records a bounded error without deleting the pending task', async () => {
  const database = cleanupDatabase()
  try {
    const cleanupId = queueAttachmentCleanup(database, 'local', 'request-attachments/missing/key')
    const report = await processAttachmentStorageCleanup(database, () => ({
      provider: 'local',
      put: async () => {},
      open: async () => { throw new Error('offline') },
      head: async () => ({ exists: true }),
      delete: async () => { throw new Error('provider offline with secret=must-not-be-stored') },
    }), { batchSize: 10 })
    assert.deepEqual(report, { scanned: 1, completed: 0, failed: 1 })
    const row = database.prepare('SELECT completed_at, last_error FROM attachment_storage_cleanup WHERE id=?').get(cleanupId) as any
    assert.equal(row.completed_at, null)
    assert.match(row.last_error, /provider offline/)
    assert.doesNotMatch(row.last_error, /secret=/)
  } finally {
    database.close()
  }
})
