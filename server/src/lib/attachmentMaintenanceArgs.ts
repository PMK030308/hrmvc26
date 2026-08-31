export interface AttachmentMaintenanceArgs {
  mode: 'backfill' | 'cleanup'
  apply: boolean
  batchSize: number
}

export function parseAttachmentMaintenanceArgs(args: readonly string[]): AttachmentMaintenanceArgs {
  const [mode, ...flags] = args
  if (mode !== 'backfill' && mode !== 'cleanup') throw new Error('Attachment maintenance mode phải là backfill hoặc cleanup.')
  let apply = false
  let batchSize = 100
  for (const flag of flags) {
    if (flag === '--apply') {
      apply = true
      continue
    }
    const batch = flag.match(/^--batch-size=(\d+)$/)
    if (batch) {
      batchSize = Number(batch[1])
      if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) {
        throw new Error('Attachment maintenance batch size phải từ 1 đến 500.')
      }
      continue
    }
    throw new Error(`Attachment maintenance argument không hợp lệ: ${flag}`)
  }
  return { mode, apply, batchSize }
}
