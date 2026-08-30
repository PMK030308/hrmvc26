import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import Database from 'better-sqlite3'

const directory = mkdtempSync(join(tmpdir(), 'hrm-phase3-migration-'))
process.env.HRM_DB_PATH = join(directory, 'fresh.db')
const { db, initSchema } = await import('../db.js')
const { runMigrations } = await import('../services/migrationService.js')
const { SCHEMA_MIGRATIONS } = await import('./index.js')

after(() => {
  db.close()
  delete process.env.HRM_DB_PATH
  rmSync(directory, { recursive: true, force: true })
})

test('phase 3 migration applies on a fresh initialized database', () => {
  initSchema()
  assert.deepEqual(runMigrations(db).appliedVersions, [1, 2, 3])
  const columns = new Set((db.prepare('PRAGMA table_info(punches)').all() as any[]).map((row) => row.name))
  assert.equal(columns.has('device_id'), true)
  assert.equal(columns.has('proxy_actor_user_id'), true)
  assert.equal(columns.has('proxy_reason'), true)
  assert.equal((db.prepare(`SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='attendance_devices'`).get() as any).count, 1)
})

test('phase 3 migration preserves legacy punch data while adding device and proxy provenance', () => {
  const legacy = new Database(':memory:')
  try {
    legacy.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      INSERT INTO users (id) VALUES ('legacy-user');
      CREATE TABLE punches (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL,
        date TEXT NOT NULL,
        punched_at TEXT NOT NULL,
        source INTEGER NOT NULL
      );
      INSERT INTO punches (id, employee_id, date, punched_at, source)
      VALUES ('legacy-punch', 'employee-1', '2026-08-01', '2026-08-01T08:00:00', 2);
      CREATE TABLE summary_timesheets (
        id TEXT PRIMARY KEY, period TEXT NOT NULL UNIQUE, status INTEGER NOT NULL DEFAULT 2,
        from_date TEXT NOT NULL, to_date TEXT NOT NULL
      );
      CREATE TABLE payslips (
        id TEXT PRIMARY KEY, period TEXT NOT NULL, employee_id TEXT NOT NULL, employee_name TEXT NOT NULL,
        base_salary REAL NOT NULL DEFAULT 0, paid_work REAL NOT NULL DEFAULT 0, overtime REAL NOT NULL DEFAULT 0,
        allowance REAL NOT NULL DEFAULT 0, gross REAL NOT NULL DEFAULT 0, deductions REAL NOT NULL DEFAULT 0,
        net REAL NOT NULL DEFAULT 0, components TEXT NOT NULL DEFAULT '[]'
      );
    `)
    assert.deepEqual(runMigrations(legacy, SCHEMA_MIGRATIONS).appliedVersions, [1, 2, 3])
    const punch = legacy.prepare(`SELECT id, employee_id, source, device_id, proxy_actor_user_id, proxy_reason
      FROM punches WHERE id='legacy-punch'`).get() as any
    assert.deepEqual(punch, {
      id: 'legacy-punch', employee_id: 'employee-1', source: 2,
      device_id: null, proxy_actor_user_id: null, proxy_reason: null,
    })
    assert.deepEqual(runMigrations(legacy, SCHEMA_MIGRATIONS).appliedVersions, [])
  } finally { legacy.close() }
})
