import assert from 'node:assert/strict'
import test from 'node:test'
import { getClientIp } from './clientIp.js'

test('client IP uses the value resolved by Express trust proxy and ignores raw forwarded headers', () => {
  const request = {
    ip: '203.0.113.10',
    header(name: string) { return name.toLowerCase() === 'x-forwarded-for' ? '198.51.100.99' : undefined },
  }
  assert.equal(getClientIp(request), '203.0.113.10')
  assert.equal(getClientIp({ ip: undefined }), '')
})
