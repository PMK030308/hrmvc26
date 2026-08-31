import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import test from 'node:test'
import { runRetentionCleanup } from './retentionService.js'

function database(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE audit_logs (id TEXT PRIMARY KEY, retention_class TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE face_attempt_tokens (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
    CREATE TABLE retention_cleanup_runs (
      id TEXT PRIMARY KEY, category TEXT NOT NULL, dry_run INTEGER NOT NULL, cutoff_at TEXT NOT NULL,
      scanned_count INTEGER NOT NULL, deleted_count INTEGER NOT NULL, error_count INTEGER NOT NULL,
      started_at TEXT NOT NULL, completed_at TEXT
    );
    CREATE TABLE retention_cleanup_locks (category TEXT PRIMARY KEY, owner_id TEXT NOT NULL, expires_at TEXT NOT NULL);
  `)
  return db
}

test('retention cleanup honors category boundaries and dry-run does not mutate rows', () => {
  const db = database()
  db.prepare('INSERT INTO audit_logs VALUES (?, ?, ?)').run('security-old', 'security', '2025-08-30T23:59:59.999Z')
  db.prepare('INSERT INTO audit_logs VALUES (?, ?, ?)').run('security-boundary', 'security', '2025-08-31T00:00:00.000Z')
  db.prepare('INSERT INTO audit_logs VALUES (?, ?, ?)').run('business-young', 'business', '2025-08-30T23:59:59.999Z')
  const result = runRetentionCleanup(db, { category: 'audit-security', now: new Date('2026-08-31T00:00:00.000Z'), dryRun: true, batchSize: 10 })
  assert.deepEqual({ scanned: result.scanned, deleted: result.deleted }, { scanned: 1, deleted: 0 })
  assert.equal((db.prepare('SELECT COUNT(*) count FROM audit_logs').get() as any).count, 3)
  db.close()
})

test('face-attempt metadata uses 90 days and cleanup never deletes outside the bounded batch', () => {
  const db = database()
  for (let index = 0; index < 4; index += 1) {
    db.prepare('INSERT INTO face_attempt_tokens VALUES (?, ?)').run(`old-${index}`, '2026-06-01T00:00:00.000Z')
  }
  db.prepare('INSERT INTO face_attempt_tokens VALUES (?, ?)').run('boundary', '2026-06-02T00:00:00.000Z')
  const result = runRetentionCleanup(db, { category: 'face-attempt-metadata', now: new Date('2026-08-31T00:00:00.000Z'), dryRun: false, batchSize: 2 })
  assert.deepEqual({ scanned: result.scanned, deleted: result.deleted }, { scanned: 2, deleted: 2 })
  assert.equal((db.prepare('SELECT COUNT(*) count FROM face_attempt_tokens').get() as any).count, 3)
  db.close()
})

test('a live category lease prevents concurrent cleanup workers', () => {
  const db = database()
  db.prepare('INSERT INTO retention_cleanup_locks VALUES (?, ?, ?)').run('audit-security', 'worker-a', '2026-08-31T00:05:00.000Z')
  assert.throws(() => runRetentionCleanup(db, {
    category: 'audit-security', now: new Date('2026-08-31T00:00:00.000Z'), dryRun: false, batchSize: 10, ownerId: 'worker-b',
  }), /locked|processing/i)
  db.close()
})
