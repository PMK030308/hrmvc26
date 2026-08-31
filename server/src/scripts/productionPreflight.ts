import { loadEnvFile } from '../lib/env.js'
loadEnvFile()

const { assertProductionReadiness } = await import('../lib/productionReadiness.js')
assertProductionReadiness(process.env)

const { db } = await import('../db.js')
const { SCHEMA_MIGRATIONS } = await import('../migrations/index.js')
const { inspectMigrationState } = await import('../services/migrationService.js')
const { getPrimaryAttachmentStorage } = await import('../services/attachmentStorageRuntime.js')

try {
  getPrimaryAttachmentStorage()
  const migrations = inspectMigrationState(db, SCHEMA_MIGRATIONS)
  const integrity = db.pragma('integrity_check', { simple: true })
  const foreignKeyErrors = db.pragma('foreign_key_check') as unknown[]
  const employees = Number((db.prepare('SELECT COUNT(*) count FROM employees').get() as any).count)
  const users = Number((db.prepare('SELECT COUNT(*) count FROM users').get() as any).count)
  const report = { integrity, foreignKeyErrors: foreignKeyErrors.length, employees, users, migrations }
  console.log(JSON.stringify(report, null, 2))
  if (integrity !== 'ok' || foreignKeyErrors.length > 0 || employees === 0 || users === 0 || migrations.pendingVersions.length > 0) {
    process.exitCode = 1
  }
} finally {
  db.close()
}
