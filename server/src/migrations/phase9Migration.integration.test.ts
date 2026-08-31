import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

const directory = mkdtempSync(join(tmpdir(), 'hrm-phase9-migration-'))
process.env.HRM_DB_PATH = join(directory, 'phase9.db')

const { db, initSchema } = await import('../db.js')
const { runMigrations } = await import('../services/migrationService.js')

after(() => {
  db.close()
  delete process.env.HRM_DB_PATH
  rmSync(directory, { recursive: true, force: true })
})

test('phase 9 migration adds session invalidation, hashed reset tokens and bounded retention state', () => {
  initSchema()
  const first = runMigrations(db)
  assert.deepEqual(first.appliedVersions, [1, 2, 3, 4, 5, 6])

  const userColumns = new Set((db.prepare('PRAGMA table_info(users)').all() as any[]).map((row) => row.name))
  const auditColumns = new Set((db.prepare('PRAGMA table_info(audit_logs)').all() as any[]).map((row) => row.name))
  assert.equal(userColumns.has('session_version'), true)
  assert.equal(auditColumns.has('retention_class'), true)

  for (const table of ['password_reset_tokens', 'retention_cleanup_runs', 'retention_cleanup_locks']) {
    assert.equal((db.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name=?").get(table) as any).count, 1)
  }

  const resetColumns = new Set((db.prepare('PRAGMA table_info(password_reset_tokens)').all() as any[]).map((row) => row.name))
  assert.equal(resetColumns.has('token_hash'), true)
  assert.equal(resetColumns.has('token'), false)
  assert.deepEqual(runMigrations(db).appliedVersions, [])
})
