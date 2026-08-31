import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runMigrations } from '../services/migrationService.js'
import { SCHEMA_MIGRATIONS } from './index.js'

function databaseBeforePhase8(): Database.Database {
  const database = new Database(':memory:')
  database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE punches (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, date TEXT NOT NULL, punched_at TEXT NOT NULL, source INTEGER NOT NULL);
    CREATE TABLE summary_timesheets (id TEXT PRIMARY KEY, period TEXT NOT NULL UNIQUE, status INTEGER NOT NULL DEFAULT 2, from_date TEXT NOT NULL, to_date TEXT NOT NULL);
    CREATE TABLE payslips (id TEXT PRIMARY KEY, period TEXT NOT NULL, employee_id TEXT NOT NULL, employee_name TEXT NOT NULL);
    CREATE TABLE requests (id TEXT PRIMARY KEY);
    CREATE TABLE request_approvals (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, request_type TEXT NOT NULL, level INTEGER NOT NULL, approver_name TEXT NOT NULL);
    CREATE TABLE request_attachments (
      id TEXT PRIMARY KEY, request_id TEXT NOT NULL, file_name TEXT NOT NULL, file_size INTEGER NOT NULL,
      mime_type TEXT NOT NULL, data_url TEXT NOT NULL, uploaded_at TEXT NOT NULL,
      uploaded_by_user_id TEXT, checksum_sha256 TEXT
    );
    INSERT INTO requests (id) VALUES ('request-1');
    INSERT INTO request_attachments
      (id, request_id, file_name, file_size, mime_type, data_url, uploaded_at)
    VALUES ('legacy-1', 'request-1', 'proof.pdf', 8, 'application/pdf',
      'data:application/pdf;base64,JVBERi0xLjQ=', '2026-08-31T09:00:00');
  `)
  return database
}

test('phase 8 migration adds nullable storage metadata without changing legacy payload', () => {
  const database = databaseBeforePhase8()
  try {
    assert.deepEqual(runMigrations(database, SCHEMA_MIGRATIONS).appliedVersions, [1, 2, 3, 4, 5])
    const columns = new Set((database.prepare('PRAGMA table_info(request_attachments)').all() as any[]).map((row) => row.name))
    assert.equal(columns.has('storage_provider'), true)
    assert.equal(columns.has('storage_key'), true)
    assert.equal(columns.has('storage_migrated_at'), true)
    const row = database.prepare(`SELECT data_url, storage_provider, storage_key, storage_migrated_at
      FROM request_attachments WHERE id='legacy-1'`).get() as any
    assert.deepEqual(row, {
      data_url: 'data:application/pdf;base64,JVBERi0xLjQ=',
      storage_provider: null,
      storage_key: null,
      storage_migrated_at: null,
    })
    assert.deepEqual(runMigrations(database, SCHEMA_MIGRATIONS).appliedVersions, [])
  } finally {
    database.close()
  }
})
