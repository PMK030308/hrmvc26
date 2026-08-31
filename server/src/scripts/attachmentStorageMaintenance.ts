import { loadEnvFile } from '../lib/env.js'
loadEnvFile()
import { parseAttachmentMaintenanceArgs } from '../lib/attachmentMaintenanceArgs.js'

async function main(): Promise<void> {
  const { db } = await import('../db.js')
  const { migrateLegacyAttachments } = await import('../services/attachmentBackfillService.js')
  const { processAttachmentStorageCleanup } = await import('../services/attachmentCleanupService.js')
  const { getPrimaryAttachmentStorage } = await import('../services/attachmentStorageRuntime.js')
  const args = parseAttachmentMaintenanceArgs(process.argv.slice(2))
  try {
    const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version=5').get()
    if (!applied) throw new Error('Phase 8 schema migration version 5 chưa được apply. Command không tự chạy migration.')
    const storage = getPrimaryAttachmentStorage()
    if (args.mode === 'backfill') {
      const report = await migrateLegacyAttachments(db, storage, { dryRun: !args.apply, batchSize: args.batchSize })
      console.log(JSON.stringify(report, null, 2))
      if (report.errors.length > 0) process.exitCode = 2
      return
    }

    if (!args.apply) {
      const pending = db.prepare(`SELECT COUNT(*) count FROM attachment_storage_cleanup
        WHERE completed_at IS NULL`).get() as any
      console.log(JSON.stringify({ dryRun: true, pending: pending.count, batchSize: args.batchSize }, null, 2))
      return
    }
    const report = await processAttachmentStorageCleanup(db, (provider) => {
      if (provider !== storage.provider) throw new Error(`Attachment storage provider chưa được hỗ trợ: ${provider}.`)
      return storage
    }, { batchSize: args.batchSize })
    console.log(JSON.stringify({ dryRun: false, ...report }, null, 2))
    if (report.failed > 0) process.exitCode = 2
  } finally {
    db.close()
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Attachment storage maintenance thất bại.')
    process.exitCode = 1
  })
