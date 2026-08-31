import assert from 'node:assert/strict'
import test from 'node:test'
import { deliverPasswordReset, resolvePasswordResetDeliveryConfig } from './passwordResetDelivery.js'

test('webhook delivery uses HTTPS, bearer auth and puts the token only in the reset URL body', async () => {
  const config = resolvePasswordResetDeliveryConfig({
    NODE_ENV: 'production', PASSWORD_RESET_DELIVERY_PROVIDER: 'webhook',
    PASSWORD_RESET_WEBHOOK_URL: 'https://mailer.example.test/reset',
    PASSWORD_RESET_WEBHOOK_BEARER_TOKEN: 's'.repeat(48),
    PASSWORD_RESET_PUBLIC_URL: 'https://hr.example.test/reset-password',
  })
  let request: { url: string; init?: RequestInit } | undefined
  await deliverPasswordReset(config, {
    email: 'employee@example.test', token: 'raw-secret-token', expiresAt: '2026-08-31T12:15:00.000Z',
  }, async (url: string | URL | Request, init?: RequestInit) => {
    request = { url: String(url), init }
    return new Response(null, { status: 202 })
  })
  assert.equal(request?.url, 'https://mailer.example.test/reset')
  assert.equal((request?.init?.headers as Record<string, string>).Authorization, `Bearer ${'s'.repeat(48)}`)
  const body = JSON.parse(String(request?.init?.body))
  assert.equal(body.email, 'employee@example.test')
  assert.equal(body.resetUrl, 'https://hr.example.test/reset-password?token=raw-secret-token')
  assert.equal(Object.hasOwn(body, 'token'), false)
})

test('production reset delivery fails closed for missing, insecure or placeholder configuration', () => {
  assert.throws(() => resolvePasswordResetDeliveryConfig({ NODE_ENV: 'production' }), /provider/i)
  assert.throws(() => resolvePasswordResetDeliveryConfig({
    NODE_ENV: 'production', PASSWORD_RESET_DELIVERY_PROVIDER: 'webhook',
    PASSWORD_RESET_WEBHOOK_URL: 'http://mailer/reset', PASSWORD_RESET_WEBHOOK_BEARER_TOKEN: 'short',
    PASSWORD_RESET_PUBLIC_URL: 'https://hr.example.test/reset-password',
  }), /HTTPS|token/i)
})
