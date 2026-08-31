import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveJwtSecret, resolveSecurityConfig } from './securityConfig.js'

test('production rejects missing or default JWT secrets and an empty CORS allowlist', () => {
  assert.throws(() => resolveSecurityConfig({ NODE_ENV: 'production', JWT_SECRET: '', CORS_ORIGINS: 'https://hr.example' }), /JWT_SECRET/)
  assert.throws(() => resolveSecurityConfig({ NODE_ENV: 'production', JWT_SECRET: 'hrm-attendance-dev-secret-change-me', CORS_ORIGINS: 'https://hr.example' }), /JWT_SECRET/)
  assert.throws(() => resolveSecurityConfig({ NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(48), CORS_ORIGINS: '' }), /CORS_ORIGINS/)
})

test('security config parses exact origins and trust proxy without making development unusable', () => {
  const production = resolveSecurityConfig({
    NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(48),
    CORS_ORIGINS: 'https://hr.example, https://admin.example', TRUST_PROXY: '1',
  })
  assert.deepEqual(production.corsOrigins, ['https://hr.example', 'https://admin.example'])
  assert.equal(production.trustProxy, 1)

  const development = resolveSecurityConfig({ NODE_ENV: 'development' })
  assert.equal(development.jwtSecret.length > 0, true)
  assert.equal(development.trustProxy, false)
})

test('JWT runtime resolution is independent from startup-only CORS validation', () => {
  assert.equal(resolveJwtSecret({
    NODE_ENV: 'production',
    JWT_SECRET: 'phase-7-production-test-secret-at-least-32-chars',
  }), 'phase-7-production-test-secret-at-least-32-chars')
})

test('production only accepts exact HTTPS origins and an explicitly supported proxy topology', () => {
  const base = { NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(48) }
  assert.throws(() => resolveSecurityConfig({ ...base, CORS_ORIGINS: '*' }), /CORS_ORIGINS|origin/i)
  assert.throws(() => resolveSecurityConfig({ ...base, CORS_ORIGINS: 'http://hr.example' }), /HTTPS/i)
  assert.throws(() => resolveSecurityConfig({ ...base, CORS_ORIGINS: 'https://*.example.com' }), /origin/i)
  assert.throws(() => resolveSecurityConfig({ ...base, CORS_ORIGINS: 'https://hr.example', TRUST_PROXY: 'true' }), /TRUST_PROXY/i)
  assert.throws(() => resolveSecurityConfig({ ...base, CORS_ORIGINS: 'https://hr.example', TRUST_PROXY: '2' }), /TRUST_PROXY/i)
})
