import type { RetentionCategory } from '../services/retentionService.js'

const CATEGORIES = new Set<RetentionCategory>([
  'audit-security', 'audit-business', 'face-attempt-metadata', 'chatbot-metadata',
])

export interface RetentionMaintenanceArgs {
  category: RetentionCategory
  dryRun: boolean
  batchSize: number
}

export function parseRetentionMaintenanceArgs(args: string[]): RetentionMaintenanceArgs {
  const category = args[0] as RetentionCategory | undefined
  if (!category || !CATEGORIES.has(category)) throw new Error('A supported retention category is required.')
  let dryRun = true
  let batchSize = 100
  for (const argument of args.slice(1)) {
    if (argument === '--apply') dryRun = false
    else if (argument.startsWith('--batch-size=')) batchSize = Number(argument.slice('--batch-size='.length))
    else throw new Error(`Unsupported argument: ${argument}`)
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error('Batch size must be between 1 and 500.')
  }
  return { category, dryRun, batchSize }
}
