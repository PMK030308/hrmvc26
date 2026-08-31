import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

export type RetentionCategory = 'audit-security' | 'audit-business' | 'face-attempt-metadata' | 'chatbot-metadata'

export interface RetentionCleanupOptions {
  category: RetentionCategory
  now?: Date
  dryRun?: boolean
  batchSize?: number
  ownerId?: string
  leaseMs?: number
}

export interface RetentionCleanupResult {
  runId: string
  category: RetentionCategory
  cutoffAt: string
  scanned: number
  deleted: number
  errors: number
  dryRun: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000
const BUSINESS_AUDIT_ENTITIES = [
  'Employee', 'User', 'Delegation', 'Request', 'ShiftSwap', 'SummaryTimesheet',
  'SummaryTimesheetDetail', 'Payroll', 'Payslip', 'Regulation', 'LeaveType',
]

function retentionDays(category: RetentionCategory): number {
  if (category === 'audit-business') return 730
  if (category === 'audit-security') return 365
  return 90
}

function validateBatchSize(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 500) throw new Error('Batch size must be between 1 and 500.')
  return value
}

function selectIds(
  database: Database.Database,
  category: RetentionCategory,
  cutoffAt: string,
  batchSize: number,
): string[] {
  if (category === 'chatbot-metadata') return []
  if (category === 'face-attempt-metadata') {
    return (database.prepare(`SELECT id FROM face_attempt_tokens WHERE created_at < ?
      ORDER BY created_at, id LIMIT ?`).all(cutoffAt, batchSize) as any[]).map((row) => row.id)
  }
  const placeholders = BUSINESS_AUDIT_ENTITIES.map(() => '?').join(',')
  const businessExpression = `(retention_class='business' OR entity IN (${placeholders}))`
  const condition = category === 'audit-business' ? businessExpression : `NOT ${businessExpression}`
  return (database.prepare(`SELECT id FROM audit_logs WHERE ${condition} AND created_at < ?
    ORDER BY created_at, id LIMIT ?`).all(...BUSINESS_AUDIT_ENTITIES, cutoffAt, batchSize) as any[]).map((row) => row.id)
}

function deleteIds(database: Database.Database, category: RetentionCategory, ids: string[]): number {
  if (ids.length === 0 || category === 'chatbot-metadata') return 0
  const placeholders = ids.map(() => '?').join(',')
  const table = category === 'face-attempt-metadata' ? 'face_attempt_tokens' : 'audit_logs'
  return database.prepare(`DELETE FROM ${table} WHERE id IN (${placeholders})`).run(...ids).changes
}

export function runRetentionCleanup(
  database: Database.Database,
  options: RetentionCleanupOptions,
): RetentionCleanupResult {
  const now = options.now ?? new Date()
  const dryRun = options.dryRun ?? true
  const batchSize = validateBatchSize(options.batchSize ?? 100)
  const ownerId = options.ownerId ?? randomUUID()
  const leaseMs = options.leaseMs ?? 5 * 60 * 1000
  const nowIso = now.toISOString()
  const cutoffAt = new Date(now.getTime() - retentionDays(options.category) * DAY_MS).toISOString()
  const runId = randomUUID()

  database.transaction(() => {
    database.prepare('DELETE FROM retention_cleanup_locks WHERE category=? AND expires_at<=?').run(options.category, nowIso)
    try {
      database.prepare(`INSERT INTO retention_cleanup_locks (category, owner_id, expires_at)
        VALUES (?, ?, ?)`).run(options.category, ownerId, new Date(now.getTime() + leaseMs).toISOString())
    } catch {
      throw new Error(`Retention category ${options.category} is locked and already processing.`)
    }
  }).immediate()

  let scanned = 0
  let deleted = 0
  let errors = 0
  try {
    const ids = selectIds(database, options.category, cutoffAt, batchSize)
    scanned = ids.length
    database.transaction(() => {
      if (!dryRun) deleted = deleteIds(database, options.category, ids)
      database.prepare(`INSERT INTO retention_cleanup_runs
        (id, category, dry_run, cutoff_at, scanned_count, deleted_count, error_count, started_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(
        runId, options.category, dryRun ? 1 : 0, cutoffAt, scanned, deleted, nowIso, new Date().toISOString(),
      )
      database.prepare('DELETE FROM retention_cleanup_locks WHERE category=? AND owner_id=?').run(options.category, ownerId)
    }).immediate()
  } catch (error) {
    errors = 1
    database.transaction(() => {
      database.prepare(`INSERT OR REPLACE INTO retention_cleanup_runs
        (id, category, dry_run, cutoff_at, scanned_count, deleted_count, error_count, started_at, completed_at)
        VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)`).run(
        runId, options.category, dryRun ? 1 : 0, cutoffAt, scanned, nowIso, new Date().toISOString(),
      )
      database.prepare('DELETE FROM retention_cleanup_locks WHERE category=? AND owner_id=?').run(options.category, ownerId)
    }).immediate()
    throw error
  }
  return { runId, category: options.category, cutoffAt, scanned, deleted, errors, dryRun }
}
