import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { isoNow } from '../lib/date.js'
import { SCHEMA_MIGRATIONS } from '../migrations/index.js'

export interface SchemaMigration {
  version: number
  name: string
  checksumSource: string
  up: (database: Database.Database) => void
}

export interface MigrationResult {
  appliedVersions: number[]
}

function checksum(migration: SchemaMigration): string {
  // Repository checkout line endings must not change the identity of an immutable migration.
  const normalizedSource = migration.checksumSource.replace(/\r\n?/g, '\n')
  return createHash('sha256')
    .update(`${migration.version}\n${migration.name}\n${normalizedSource}`, 'utf8')
    .digest('hex')
}

function validateMigrations(migrations: readonly SchemaMigration[]): void {
  const versions = new Set<number>()
  let previous = 0
  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version <= 0 || versions.has(migration.version)) {
      throw new Error(`Migration version không hợp lệ hoặc bị trùng: ${migration.version}`)
    }
    if (migration.version <= previous) throw new Error('Migration phải được sắp xếp tăng dần theo version.')
    if (!migration.name.trim() || !migration.checksumSource) throw new Error(`Migration ${migration.version} thiếu metadata.`)
    versions.add(migration.version)
    previous = migration.version
  }
}

export function runMigrations(
  database: Database.Database,
  migrations: readonly SchemaMigration[] = SCHEMA_MIGRATIONS,
): MigrationResult {
  validateMigrations(migrations)
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`)

  const appliedVersions: number[] = []
  for (const migration of migrations) {
    const expectedChecksum = checksum(migration)
    const applied = database.prepare('SELECT name, checksum FROM schema_migrations WHERE version=?').get(migration.version) as any
    if (applied) {
      if (applied.name !== migration.name || applied.checksum !== expectedChecksum) {
        throw new Error(`Migration checksum mismatch ở version ${migration.version}.`)
      }
      continue
    }

    const apply = database.transaction(() => {
      migration.up(database)
      database.prepare('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)')
        .run(migration.version, migration.name, expectedChecksum, isoNow())
    })
    apply.immediate()
    appliedVersions.push(migration.version)
  }
  return { appliedVersions }
}
