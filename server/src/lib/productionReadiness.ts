import { isAbsolute, posix } from 'node:path'
import { resolveSecurityConfig } from './securityConfig.js'
import { resolvePasswordResetDeliveryConfig } from '../services/passwordResetDelivery.js'

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

function absolutePath(value: string | undefined): boolean {
  return !!value && (isAbsolute(value) || posix.isAbsolute(value))
}

export function assertProductionReadiness(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): void {
  if (env.NODE_ENV !== 'production') return
  resolveSecurityConfig(env)
  resolvePasswordResetDeliveryConfig(env)
  if (!absolutePath(env.HRM_DB_PATH?.trim())) throw new Error('HRM_DB_PATH must be an absolute production path.')
  if (!enabled(env.DATABASE_PERSISTENT_VOLUME)) throw new Error('Production database requires a persistent volume.')
  if (!enabled(env.DATABASE_BACKUP_CONFIRMED)) throw new Error('Production database requires confirmed backup and restore procedures.')
  if (!enabled(env.RETENTION_SCHEDULER_ENABLED)) throw new Error('RETENTION_SCHEDULER_ENABLED must be true in production.')
  const intervalMs = Number(env.RETENTION_SCHEDULER_INTERVAL_MS ?? 86_400_000)
  const initialDelayMs = Number(env.RETENTION_SCHEDULER_INITIAL_DELAY_MS ?? 300_000)
  if (!Number.isInteger(intervalMs) || intervalMs < 3_600_000 || intervalMs > 7 * 86_400_000) {
    throw new Error('Retention scheduler interval must be between one hour and seven days.')
  }
  if (!Number.isInteger(initialDelayMs) || initialDelayMs < 60_000 || initialDelayMs > intervalMs) {
    throw new Error('Retention scheduler initial delay must be between one minute and the configured interval.')
  }
}
