const DEVELOPMENT_JWT_SECRET = 'hrm-attendance-dev-secret-change-me'

export interface SecurityConfig {
  jwtSecret: string
  corsOrigins: string[] | null
  trustProxy: boolean | number | string
}

function parseTrustProxy(value: string | undefined): boolean | number | string {
  const normalized = value?.trim()
  if (!normalized || normalized.toLowerCase() === 'false') return false
  if (normalized.toLowerCase() === 'true') return true
  if (/^\d+$/.test(normalized)) return Number(normalized)
  return normalized
}

export function resolveJwtSecret(env: NodeJS.ProcessEnv | Record<string, string | undefined>): string {
  return env.JWT_SECRET?.trim() || DEVELOPMENT_JWT_SECRET
}

export function resolveSecurityConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): SecurityConfig {
  const production = env.NODE_ENV === 'production'
  const jwtSecret = resolveJwtSecret(env)
  if (production && (jwtSecret === DEVELOPMENT_JWT_SECRET || jwtSecret.length < 32)) {
    throw new Error('JWT_SECRET phải được cấu hình bằng secret production dài ít nhất 32 ký tự.')
  }
  const corsOrigins = (env.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean)
  if (production && corsOrigins.length === 0) throw new Error('CORS_ORIGINS phải được cấu hình trong production.')
  if (production) {
    for (const origin of corsOrigins) {
      let parsed: URL
      try { parsed = new URL(origin) } catch { throw new Error(`CORS_ORIGINS chứa origin không hợp lệ: ${origin}`) }
      if (parsed.protocol !== 'https:') throw new Error(`CORS_ORIGINS production chỉ chấp nhận HTTPS: ${origin}`)
      if (origin.includes('*') || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
        throw new Error(`CORS_ORIGINS phải là exact origin: ${origin}`)
      }
    }
    const trustProxy = parseTrustProxy(env.TRUST_PROXY)
    if (trustProxy !== false && trustProxy !== 1) {
      throw new Error('TRUST_PROXY production chỉ được là false hoặc 1 cho đúng một reverse proxy được kiểm soát.')
    }
  }
  return {
    jwtSecret,
    corsOrigins: corsOrigins.length > 0 ? corsOrigins : null,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
  }
}

export function isCorsOriginAllowed(config: SecurityConfig, origin: string | undefined): boolean {
  if (!origin) return true
  return config.corsOrigins === null || config.corsOrigins.includes(origin)
}
