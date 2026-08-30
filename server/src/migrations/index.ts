import type Database from 'better-sqlite3'
import type { SchemaMigration } from '../services/migrationService.js'

function hasColumn(database: Database.Database, table: string, column: string): boolean {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as any[]).some((row) => row.name === column)
}

export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  {
    version: 1,
    name: 'shared_authorization_foundation',
    checksumSource: [
      'users.is_active INTEGER NOT NULL DEFAULT 1',
      // Per-principal revision for optimistic UI/audit diagnostics. It is not an authorization cache:
      // every protected request still hydrates the actor and effective permissions directly from DB.
      'users.authz_version INTEGER NOT NULL DEFAULT 1',
      'permission_matrix_state(id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL)',
    ].join('\n'),
    up(database) {
      if (!hasColumn(database, 'users', 'is_active')) {
        database.exec('ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1')
      }
      if (!hasColumn(database, 'users', 'authz_version')) {
        database.exec('ALTER TABLE users ADD COLUMN authz_version INTEGER NOT NULL DEFAULT 1')
      }
      database.exec(`CREATE TABLE IF NOT EXISTS permission_matrix_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL
      )`)
      database.prepare('INSERT OR IGNORE INTO permission_matrix_state (id, version) VALUES (1, 1)').run()
    },
  },
]
