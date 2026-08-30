import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runMigrations, type SchemaMigration } from './migrationService.js'

function migration(version: number, name: string, sql: string): SchemaMigration {
  return { version, name, checksumSource: sql, up: (database) => database.exec(sql) }
}

test('migration runner applies ordered migrations once and records their checksums', () => {
  const database = new Database(':memory:')
  const migrations = [
    migration(1, 'create_example', 'CREATE TABLE example (id TEXT PRIMARY KEY)'),
    migration(2, 'add_example_name', 'ALTER TABLE example ADD COLUMN name TEXT'),
  ]
  try {
    assert.deepEqual(runMigrations(database, migrations).appliedVersions, [1, 2])
    assert.deepEqual(runMigrations(database, migrations).appliedVersions, [])
    const rows = database.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all() as any[]
    assert.equal(rows.length, 2)
    assert.equal(rows[0].name, 'create_example')
    assert.match(rows[0].checksum, /^[a-f0-9]{64}$/)
  } finally { database.close() }
})

test('migration runner rejects checksum drift and rolls back a failed migration', () => {
  const database = new Database(':memory:')
  const first = migration(1, 'create_example', 'CREATE TABLE example (id TEXT PRIMARY KEY)')
  try {
    runMigrations(database, [first])
    assert.throws(
      () => runMigrations(database, [migration(1, 'create_example', 'CREATE TABLE example (id TEXT PRIMARY KEY, changed TEXT)')]),
      /checksum/i,
    )
    const failing: SchemaMigration = {
      version: 2, name: 'failing_migration', checksumSource: 'create then fail',
      up: (db) => { db.exec('CREATE TABLE should_rollback (id TEXT)'); throw new Error('boom') },
    }
    assert.throws(() => runMigrations(database, [first, failing]), /boom/)
    assert.equal((database.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='should_rollback'").get() as any).count, 0)
    assert.equal((database.prepare('SELECT COUNT(*) count FROM schema_migrations WHERE version=2').get() as any).count, 0)
  } finally { database.close() }
})

test('migration checksum is stable across LF and CRLF line endings', () => {
  const database = new Database(':memory:')
  const lf = migration(1, 'line_endings', 'CREATE TABLE line_test (\n  id TEXT\n)')
  const crlf = migration(1, 'line_endings', 'CREATE TABLE line_test (\r\n  id TEXT\r\n)')
  try {
    runMigrations(database, [lf])
    assert.doesNotThrow(() => runMigrations(database, [crlf]))
  } finally { database.close() }
})
