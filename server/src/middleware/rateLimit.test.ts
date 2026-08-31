import assert from 'node:assert/strict'
import test from 'node:test'
import { createRateLimitMiddleware } from './rateLimit.js'

test('rate limiter isolates keys and returns 429 after the configured limit', () => {
  let now = 1_000
  const middleware = createRateLimitMiddleware({ windowMs: 60_000, maxAttempts: 2, now: () => now, key: (req) => req.ip })
  const statuses: number[] = []
  const response = { status(code: number) { statuses.push(code); return this }, json() { return this } } as any
  const next = () => statuses.push(200)
  const request = { ip: '10.0.0.1' } as any
  middleware(request, response, next)
  middleware(request, response, next)
  middleware(request, response, next)
  middleware({ ip: '10.0.0.2' } as any, response, next)
  assert.deepEqual(statuses, [200, 200, 429, 200])

  now += 60_001
  middleware(request, response, next)
  assert.equal(statuses.at(-1), 200)
})
