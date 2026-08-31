import assert from 'node:assert/strict'
import test from 'node:test'
import { assertProductionReadiness } from './productionReadiness.js'

const valid = {
  NODE_ENV: 'production',
  JWT_SECRET: 'x'.repeat(48),
  CORS_ORIGINS: 'https://hr.example.test',
  TRUST_PROXY: '1',
  HRM_DB_PATH: '/var/data/hrm.db',
  DATABASE_PERSISTENT_VOLUME: 'true',
  DATABASE_BACKUP_CONFIRMED: 'true',
  ATTACHMENT_STORAGE_PROVIDER: 'local',
  ATTACHMENT_STORAGE_ROOT: '/var/data/attachments',
  ATTACHMENT_STORAGE_PERSISTENT_VOLUME: 'true',
  ATTACHMENT_STORAGE_BACKUP_CONFIRMED: 'true',
  PASSWORD_RESET_DELIVERY_PROVIDER: 'webhook',
  PASSWORD_RESET_WEBHOOK_URL: 'https://mailer.example.test/reset',
  PASSWORD_RESET_WEBHOOK_BEARER_TOKEN: 's'.repeat(48),
  PASSWORD_RESET_PUBLIC_URL: 'https://hr.example.test/reset-password',
  RETENTION_SCHEDULER_ENABLED: 'true',
  RETENTION_SCHEDULER_INTERVAL_MS: '86400000',
  RETENTION_SCHEDULER_INITIAL_DELAY_MS: '300000',
}

test('production readiness requires persistent DB, reset delivery and a bounded retention schedule', () => {
  assert.doesNotThrow(() => assertProductionReadiness(valid))
  assert.throws(() => assertProductionReadiness({ ...valid, HRM_DB_PATH: 'data/hrm.db' }), /HRM_DB_PATH/i)
  assert.throws(() => assertProductionReadiness({ ...valid, DATABASE_BACKUP_CONFIRMED: 'false' }), /backup/i)
  assert.throws(() => assertProductionReadiness({ ...valid, PASSWORD_RESET_WEBHOOK_URL: 'http://mailer/reset' }), /HTTPS/i)
  assert.throws(() => assertProductionReadiness({ ...valid, RETENTION_SCHEDULER_ENABLED: 'false' }), /RETENTION_SCHEDULER/i)
  assert.throws(() => assertProductionReadiness({ ...valid, RETENTION_SCHEDULER_INTERVAL_MS: '1000' }), /interval/i)
})

test('development is not forced to provide production infrastructure', () => {
  assert.doesNotThrow(() => assertProductionReadiness({ NODE_ENV: 'development' }))
})
