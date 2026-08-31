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
  {
    version: 2,
    name: 'attendance_device_and_proxy_provenance',
    checksumSource: [
      'attendance_devices(id,name,credential_salt,credential_hash,is_active,created_at,updated_at,revoked_at,last_used_at)',
      'punches.device_id TEXT',
      'punches.proxy_actor_user_id TEXT',
      'punches.proxy_reason TEXT',
    ].join('\n'),
    up(database) {
      database.exec(`CREATE TABLE IF NOT EXISTS attendance_devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        credential_salt TEXT NOT NULL,
        credential_hash TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revoked_at TEXT,
        last_used_at TEXT
      ); CREATE INDEX IF NOT EXISTS idx_attendance_devices_active ON attendance_devices(is_active)`)
      if (!hasColumn(database, 'punches', 'device_id')) database.exec('ALTER TABLE punches ADD COLUMN device_id TEXT')
      if (!hasColumn(database, 'punches', 'proxy_actor_user_id')) database.exec('ALTER TABLE punches ADD COLUMN proxy_actor_user_id TEXT')
      if (!hasColumn(database, 'punches', 'proxy_reason')) database.exec('ALTER TABLE punches ADD COLUMN proxy_reason TEXT')
    },
  },
  {
    version: 3,
    name: 'timesheet_payroll_workflow_integrity',
    checksumSource: [
      'summary_timesheets.version INTEGER NOT NULL DEFAULT 1',
      'summary_timesheets.confirmed_by TEXT',
      'summary_timesheets.confirmed_at TEXT',
      'summary_timesheets.transferred_by TEXT',
      'summary_timesheets.transferred_at TEXT',
      'summary_timesheets.approved_by TEXT',
      'summary_timesheets.approved_at TEXT',
      'UNIQUE payslips(period,employee_id)',
    ].join('\n'),
    up(database) {
      if (!hasColumn(database, 'summary_timesheets', 'version')) database.exec('ALTER TABLE summary_timesheets ADD COLUMN version INTEGER NOT NULL DEFAULT 1')
      if (!hasColumn(database, 'summary_timesheets', 'confirmed_by')) database.exec('ALTER TABLE summary_timesheets ADD COLUMN confirmed_by TEXT')
      if (!hasColumn(database, 'summary_timesheets', 'confirmed_at')) database.exec('ALTER TABLE summary_timesheets ADD COLUMN confirmed_at TEXT')
      if (!hasColumn(database, 'summary_timesheets', 'transferred_by')) database.exec('ALTER TABLE summary_timesheets ADD COLUMN transferred_by TEXT')
      if (!hasColumn(database, 'summary_timesheets', 'transferred_at')) database.exec('ALTER TABLE summary_timesheets ADD COLUMN transferred_at TEXT')
      if (!hasColumn(database, 'summary_timesheets', 'approved_by')) database.exec('ALTER TABLE summary_timesheets ADD COLUMN approved_by TEXT')
      if (!hasColumn(database, 'summary_timesheets', 'approved_at')) database.exec('ALTER TABLE summary_timesheets ADD COLUMN approved_at TEXT')
      const duplicate = database.prepare(`SELECT period, employee_id, COUNT(*) count FROM payslips
        GROUP BY period, employee_id HAVING COUNT(*) > 1 LIMIT 1`).get() as any
      if (duplicate) throw new Error(`Không thể áp dụng migration: kỳ ${duplicate.period} có phiếu lương trùng cho nhân viên ${duplicate.employee_id}.`)
      database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_payslips_period_employee ON payslips(period, employee_id)')
    },
  },
  {
    version: 4,
    name: 'request_approval_and_attachment_integrity',
    checksumSource: [
      'UNIQUE request_approvals(request_id,level)',
      'request_attachments.uploaded_by_user_id TEXT',
      'request_attachments.checksum_sha256 TEXT',
      'INDEX request_attachments(request_id)',
    ].join('\n'),
    up(database) {
      const duplicate = database.prepare(`SELECT request_id, level, COUNT(*) count FROM request_approvals
        GROUP BY request_id, level HAVING COUNT(*) > 1 LIMIT 1`).get() as any
      if (duplicate) {
        throw new Error(`Cannot apply migration: request ${duplicate.request_id} has duplicate approval level ${duplicate.level}.`)
      }
      if (!hasColumn(database, 'request_attachments', 'uploaded_by_user_id')) {
        database.exec('ALTER TABLE request_attachments ADD COLUMN uploaded_by_user_id TEXT')
      }
      if (!hasColumn(database, 'request_attachments', 'checksum_sha256')) {
        database.exec('ALTER TABLE request_attachments ADD COLUMN checksum_sha256 TEXT')
      }
      database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_request_approvals_request_level
        ON request_approvals(request_id, level)`)
      database.exec(`CREATE INDEX IF NOT EXISTS idx_request_attachments_request
        ON request_attachments(request_id)`)
    },
  },
  {
    version: 5,
    name: 'attachment_storage_expand',
    checksumSource: [
      'request_attachments.storage_provider TEXT',
      'request_attachments.storage_key TEXT',
      'request_attachments.storage_migrated_at TEXT',
      'UNIQUE request_attachments(storage_provider,storage_key)',
      'attachment_storage_cleanup(id,storage_provider,storage_key,created_at,last_attempt_at,last_error,completed_at)',
    ].join('\n'),
    up(database) {
      if (!hasColumn(database, 'request_attachments', 'storage_provider')) {
        database.exec('ALTER TABLE request_attachments ADD COLUMN storage_provider TEXT')
      }
      if (!hasColumn(database, 'request_attachments', 'storage_key')) {
        database.exec('ALTER TABLE request_attachments ADD COLUMN storage_key TEXT')
      }
      if (!hasColumn(database, 'request_attachments', 'storage_migrated_at')) {
        database.exec('ALTER TABLE request_attachments ADD COLUMN storage_migrated_at TEXT')
      }
      database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_request_attachments_storage_key
        ON request_attachments(storage_provider, storage_key)
        WHERE storage_provider IS NOT NULL AND storage_key IS NOT NULL`)
      database.exec(`CREATE TABLE IF NOT EXISTS attachment_storage_cleanup (
        id TEXT PRIMARY KEY,
        storage_provider TEXT NOT NULL,
        storage_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_attempt_at TEXT,
        last_error TEXT,
        completed_at TEXT
      ); CREATE UNIQUE INDEX IF NOT EXISTS idx_attachment_storage_cleanup_pending
        ON attachment_storage_cleanup(storage_provider, storage_key)
        WHERE completed_at IS NULL`)
    },
  },
  {
    version: 6,
    name: 'session_invalidation_and_retention',
    checksumSource: [
      'users.session_version INTEGER NOT NULL DEFAULT 1',
      'audit_logs.retention_class TEXT NOT NULL DEFAULT security',
      'password_reset_tokens(id,user_id,token_hash,expires_at,consumed_at,created_at)',
      'retention_cleanup_runs(id,category,dry_run,cutoff_at,scanned_count,deleted_count,error_count,started_at,completed_at)',
      'retention_cleanup_locks(category,owner_id,expires_at)',
    ].join('\n'),
    up(database) {
      if (!hasColumn(database, 'users', 'session_version')) {
        database.exec('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1')
      }
      if (!hasColumn(database, 'audit_logs', 'retention_class')) {
        database.exec("ALTER TABLE audit_logs ADD COLUMN retention_class TEXT NOT NULL DEFAULT 'security'")
      }
      database.exec(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      ); CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user
        ON password_reset_tokens(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expiry
        ON password_reset_tokens(expires_at) WHERE consumed_at IS NULL;
      CREATE TABLE IF NOT EXISTS retention_cleanup_runs (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        dry_run INTEGER NOT NULL,
        cutoff_at TEXT NOT NULL,
        scanned_count INTEGER NOT NULL DEFAULT 0,
        deleted_count INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS retention_cleanup_locks (
        category TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_retention
        ON audit_logs(retention_class, created_at)`)
    },
  },
]
