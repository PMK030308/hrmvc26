import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runMigrations } from '../services/migrationService.js'
import { SCHEMA_MIGRATIONS } from './index.js'

function legacyDatabase(): Database.Database {
  const database = new Database(':memory:')
  database.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE punches (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, date TEXT NOT NULL, punched_at TEXT NOT NULL, source INTEGER NOT NULL);
    CREATE TABLE summary_timesheets (id TEXT PRIMARY KEY, period TEXT NOT NULL UNIQUE, status INTEGER NOT NULL DEFAULT 2, from_date TEXT NOT NULL, to_date TEXT NOT NULL);
    CREATE TABLE payslips (
      id TEXT PRIMARY KEY, period TEXT NOT NULL, employee_id TEXT NOT NULL, employee_name TEXT NOT NULL,
      base_salary REAL NOT NULL DEFAULT 0, paid_work REAL NOT NULL DEFAULT 0, overtime REAL NOT NULL DEFAULT 0,
      allowance REAL NOT NULL DEFAULT 0, gross REAL NOT NULL DEFAULT 0, deductions REAL NOT NULL DEFAULT 0,
      net REAL NOT NULL DEFAULT 0, components TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE requests (id TEXT PRIMARY KEY);
    CREATE TABLE request_approvals (
      id TEXT PRIMARY KEY, request_id TEXT NOT NULL, request_type TEXT NOT NULL, level INTEGER NOT NULL,
      approver_user_id TEXT, approver_name TEXT NOT NULL, status INTEGER NOT NULL DEFAULT 2,
      comment TEXT, approved_at TEXT
    );
    CREATE TABLE request_attachments (
      id TEXT PRIMARY KEY, request_id TEXT NOT NULL, file_name TEXT NOT NULL, file_size INTEGER NOT NULL,
      mime_type TEXT NOT NULL, data_url TEXT NOT NULL, uploaded_at TEXT NOT NULL
    );
  `)
  return database
}

test('phase 7 migration adds approval uniqueness and attachment provenance without changing existing content', () => {
  const database = legacyDatabase()
  try {
    database.exec(`
      INSERT INTO requests (id) VALUES ('request-1');
      INSERT INTO request_approvals (id, request_id, request_type, level, approver_name)
      VALUES ('approval-1', 'request-1', 'leaves', 1, 'Manager');
      INSERT INTO request_attachments (id, request_id, file_name, file_size, mime_type, data_url, uploaded_at)
      VALUES ('attachment-1', 'request-1', 'proof.pdf', 8, 'application/pdf', 'data:application/pdf;base64,JVBERi0xLjQ=', '2026-08-31T09:00:00');
    `)

    assert.deepEqual(runMigrations(database, SCHEMA_MIGRATIONS).appliedVersions, [1, 2, 3, 4])
    const columns = new Set((database.prepare('PRAGMA table_info(request_attachments)').all() as any[]).map((row) => row.name))
    assert.equal(columns.has('uploaded_by_user_id'), true)
    assert.equal(columns.has('checksum_sha256'), true)
    const attachment = database.prepare("SELECT file_name, data_url, uploaded_by_user_id, checksum_sha256 FROM request_attachments WHERE id='attachment-1'").get() as any
    assert.equal(attachment.file_name, 'proof.pdf')
    assert.equal(attachment.data_url, 'data:application/pdf;base64,JVBERi0xLjQ=')
    assert.equal(attachment.uploaded_by_user_id, null)
    assert.equal(attachment.checksum_sha256, null)
    assert.throws(() => database.prepare(`INSERT INTO request_approvals
      (id, request_id, request_type, level, approver_name) VALUES ('approval-2', 'request-1', 'leaves', 1, 'Other')`).run(), /unique/i)
  } finally { database.close() }
})

test('phase 7 migration stops on duplicate approval levels without deleting or guessing data', () => {
  const database = legacyDatabase()
  try {
    database.exec(`
      INSERT INTO requests (id) VALUES ('request-1');
      INSERT INTO request_approvals (id, request_id, request_type, level, approver_name)
      VALUES ('approval-1', 'request-1', 'leaves', 1, 'Manager'),
             ('approval-2', 'request-1', 'leaves', 1, 'Other');
    `)
    assert.throws(() => runMigrations(database, SCHEMA_MIGRATIONS), /request-1.*level 1/i)
    assert.equal((database.prepare('SELECT COUNT(*) count FROM request_approvals').get() as any).count, 2)
    assert.equal((database.prepare("SELECT COUNT(*) count FROM schema_migrations WHERE version=4").get() as any).count, 0)
  } finally { database.close() }
})
