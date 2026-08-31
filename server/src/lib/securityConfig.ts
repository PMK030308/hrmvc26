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

export function resolveSecurityConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): SecurityConfig {
  const production = env.NODE_ENV === 'production'
  const jwtSecret = env.JWT_SECRET?.trim() || DEVELOPMENT_JWT_SECRET
  if (production && (jwtSecret === DEVELOPMENT_JWT_SECRET || jwtSecret.length < 32)) {
    throw new Error('JWT_SECRET phải được cấu hình bằng secret production dài ít nhất 32 ký tự.')
  }
  const corsOrigins = (env.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean)
  if (production && corsOrigins.length === 0) throw new Error('CORS_ORIGINS phải được cấu hình trong production.')
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
