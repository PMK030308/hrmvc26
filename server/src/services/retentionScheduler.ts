import type Database from 'better-sqlite3'
import { runRetentionCleanup, type RetentionCategory } from './retentionService.js'

export interface RetentionSchedulerOptions {
  initialDelayMs: number
  intervalMs: number
  runCycle: () => Promise<void>
  setTimer?: (callback: () => void, delayMs: number) => NodeJS.Timeout
  clearTimer?: (timer: NodeJS.Timeout) => void
}

export function createRetentionScheduler(options: RetentionSchedulerOptions) {
  const setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay))
  const clearTimer = options.clearTimer ?? clearTimeout
  let timer: NodeJS.Timeout | undefined
  let stopped = true
  let running = false

  const schedule = (delayMs: number) => {
    if (stopped) return
    timer = setTimer(() => { void execute() }, delayMs)
    timer.unref?.()
  }
  const execute = async () => {
    if (stopped) return
    if (running) return schedule(options.intervalMs)
    running = true
    try { await options.runCycle() } finally {
      running = false
      schedule(options.intervalMs)
    }
  }
  return {
    start() {
      if (!stopped) return
      stopped = false
      schedule(options.initialDelayMs)
    },
    stop() {
      stopped = true
      if (timer) clearTimer(timer)
      timer = undefined
    },
  }
}

const RETENTION_CATEGORIES: RetentionCategory[] = [
  'audit-security', 'audit-business', 'face-attempt-metadata', 'chatbot-metadata',
]

export function startRetentionScheduler(
  database: Database.Database,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
) {
  if (env.RETENTION_SCHEDULER_ENABLED?.trim().toLowerCase() !== 'true') return null
  const batchSize = Number(env.RETENTION_SCHEDULER_BATCH_SIZE ?? 100)
  const scheduler = createRetentionScheduler({
    initialDelayMs: Number(env.RETENTION_SCHEDULER_INITIAL_DELAY_MS ?? 300_000),
    intervalMs: Number(env.RETENTION_SCHEDULER_INTERVAL_MS ?? 86_400_000),
    async runCycle() {
      for (const category of RETENTION_CATEGORIES) {
        try { runRetentionCleanup(database, { category, dryRun: false, batchSize }) }
        catch { console.error(`[RETENTION_CLEANUP_FAILED] category=${category}`) }
      }
    },
  })
  scheduler.start()
  return scheduler
}
