import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import test from 'node:test'
import { SCHEMA_MIGRATIONS } from './index.js'
import { runMigrations } from '../services/migrationService.js'

test('phase 5 migration adds workflow metadata and unique payroll period employee guard', () => {
  const database = new Database(':memory:')
  try {
    database.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE punches (
        id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, date TEXT NOT NULL,
        punched_at TEXT NOT NULL, source INTEGER NOT NULL
      );
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
      INSERT INTO summary_timesheets (id, period, status, from_date, to_date)
      VALUES ('legacy-summary', '2026081', 4, '2026-08-01', '2026-08-15');
      INSERT INTO payslips (id, period, employee_id, employee_name)
      VALUES ('legacy-slip', '2026081', 'employee', 'Employee');
    `)
    assert.deepEqual(runMigrations(database, SCHEMA_MIGRATIONS.slice(0, 3)).appliedVersions, [1, 2, 3])
    const summary = database.prepare(`SELECT version, confirmed_by, confirmed_at, transferred_by, transferred_at,
      approved_by, approved_at FROM summary_timesheets WHERE id='legacy-summary'`).get() as any
    assert.equal(summary.version, 1)
    assert.equal(summary.approved_by, null)
    assert.throws(() => database.prepare(`INSERT INTO payslips (id, period, employee_id, employee_name)
      VALUES ('duplicate', '2026081', 'employee', 'Duplicate')`).run(), /unique/i)
    assert.equal((database.prepare(`SELECT COUNT(*) count FROM payslips WHERE id='legacy-slip'`).get() as any).count, 1)
  } finally { database.close() }
})
