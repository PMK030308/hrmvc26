import { loadEnvFile } from '../lib/env.js'
loadEnvFile()
import { db } from '../db.js'
import { parseRetentionMaintenanceArgs } from '../lib/retentionMaintenanceArgs.js'
import { runRetentionCleanup } from '../services/retentionService.js'

try {
  const options = parseRetentionMaintenanceArgs(process.argv.slice(2))
  const result = runRetentionCleanup(db, options)
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Retention cleanup failed.')
  process.exitCode = 1
} finally {
  db.close()
}
