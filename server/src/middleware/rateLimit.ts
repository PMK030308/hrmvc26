import type { NextFunction, Request, Response } from 'express'

export interface RateLimitOptions {
  windowMs: number
  maxAttempts: number
  key?: (request: Request) => string | undefined
  now?: () => number
}

interface Bucket { count: number; resetAt: number }

export function createRateLimitMiddleware(options: RateLimitOptions) {
  if (!Number.isSafeInteger(options.windowMs) || options.windowMs <= 0) throw new Error('windowMs không hợp lệ.')
  if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts <= 0) throw new Error('maxAttempts không hợp lệ.')
  const buckets = new Map<string, Bucket>()
  const now = options.now ?? Date.now
  const keyFor = options.key ?? ((request: Request) => request.ip)

  return (request: Request, response: Response, next: NextFunction): void => {
    const timestamp = now()
    const key = keyFor(request)?.trim() || 'unknown'
    let bucket = buckets.get(key)
    if (!bucket || timestamp >= bucket.resetAt) {
      bucket = { count: 0, resetAt: timestamp + options.windowMs }
      buckets.set(key, bucket)
    }
    bucket.count += 1
    response.setHeader?.('X-RateLimit-Limit', String(options.maxAttempts))
    response.setHeader?.('X-RateLimit-Remaining', String(Math.max(0, options.maxAttempts - bucket.count)))
    if (bucket.count > options.maxAttempts) {
      response.setHeader?.('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1000))))
      response.status(429).json({ status: 429, message: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.' })
      return
    }
    if (buckets.size > 10_000) {
      for (const [bucketKey, value] of buckets) if (timestamp >= value.resetAt) buckets.delete(bucketKey)
    }
    next()
  }
}
