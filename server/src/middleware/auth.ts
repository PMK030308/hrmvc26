// ============================================================================
// Middleware xác thực JWT + guard role.
// ============================================================================
import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import type { AuthUser, RoleCode } from '../types.js'
import { httpError } from '../types.js'
import { loadAuthorizationActor, type AuthorizationActor } from '../authz/authorizationActor.js'
import { resolveJwtSecret } from '../lib/securityConfig.js'

const ACCESS_TOKEN_TTL = process.env.JWT_ACCESS_TTL?.trim() || '7d'
const REFRESH_TOKEN_TTL = process.env.JWT_REFRESH_TTL?.trim() || '30d'
const jwtSecret = () => resolveJwtSecret(process.env)

export function signToken(user: AuthUser): string {
  if (!Number.isInteger(user.sessionVersion)) throw new Error('Cannot issue a token without a session version.')
  return jwt.sign(
    { id: user.id, session_version: user.sessionVersion, token_type: 'access' },
    jwtSecret(),
    { expiresIn: ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'] },
  )
}

export function signRefreshToken(user: AuthUser): string {
  if (!Number.isInteger(user.sessionVersion)) throw new Error('Cannot issue a refresh token without a session version.')
  return jwt.sign(
    { id: user.id, session_version: user.sessionVersion, token_type: 'refresh' },
    jwtSecret(),
    { expiresIn: REFRESH_TOKEN_TTL as jwt.SignOptions['expiresIn'] },
  )
}

export function verifyRefreshToken(token: string): { id: string; sessionVersion: number } {
  const payload = jwt.verify(token, jwtSecret()) as { id?: unknown; session_version?: unknown; token_type?: unknown }
  if (typeof payload.id !== 'string' || payload.token_type !== 'refresh' || !Number.isInteger(payload.session_version)) {
    throw httpError(401, 'Refresh token is invalid or expired.')
  }
  const actor = loadAuthorizationActor(payload.id)
  if (payload.session_version !== actor.sessionVersion) throw httpError(401, 'Refresh token is invalid or expired.')
  return { id: actor.userId, sessionVersion: actor.sessionVersion }
}

export interface AuthedRequest extends Request {
  user?: AuthUser
  authorizationActor?: AuthorizationActor
}

/** Yêu cầu đăng nhập. Gắn req.user. */
export function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) return next(httpError(401, 'Chưa đăng nhập.'))
  const token = header.slice(7)
  try {
    const payload = jwt.verify(token, jwtSecret()) as { id?: unknown; session_version?: unknown; token_type?: unknown }
    if (typeof payload.id !== 'string' || payload.token_type !== 'access' || !Number.isInteger(payload.session_version)) {
      throw new Error('invalid access token')
    }
    const actor = loadAuthorizationActor(payload.id)
    if (payload.session_version !== actor.sessionVersion) throw new Error('stale session')
    req.authorizationActor = actor
    req.user = {
      id: actor.userId,
      email: actor.email,
      employeeId: actor.employeeId,
      roles: actor.roles,
      permissions: [...actor.permissions],
      departmentScopes: actor.departmentScopes,
      isActive: true,
      authorizationVersion: actor.authorizationVersion,
      sessionVersion: actor.sessionVersion,
    }
    next()
  } catch {
    next(httpError(401, 'Phiên đăng nhập hết hạn.'))
  }
}

/** Yêu cầu có 1 trong các role. Phải dùng sau requireAuth. */
export function requireRole(...roles: RoleCode[]) {
  return (req: AuthedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(httpError(401, 'Chưa đăng nhập.'))
    if (!req.user.roles.some((r) => roles.includes(r as RoleCode))) {
      return next(httpError(403, 'Bạn không có quyền thực hiện thao tác này.'))
    }
    next()
  }
}

/** (Tùy chọn) Cho phép route vừa yêu cầu đăng nhập vừa có guard role chain. */
export function auth(...roles: RoleCode[]) {
  if (roles.length === 0) return [requireAuth]
  return [requireAuth, requireRole(...roles)]
}

/** Actor/quyền luôn được hydrate từ DB bởi requireAuth; frontend/JWT không phải authority. */
export function requireFreshActor(req: AuthedRequest, _res: Response, next: NextFunction): void {
  if (!req.user) return next(httpError(401, 'Chưa đăng nhập.'))
  try {
    req.authorizationActor = loadAuthorizationActor(req.user.id)
    next()
  } catch (error) { next(error) }
}

export function requirePermission(permission: string) {
  return (req: AuthedRequest, _res: Response, next: NextFunction): void => {
    if (!req.authorizationActor) return next(httpError(401, 'Chưa đăng nhập.'))
    if (!req.authorizationActor.permissions.has(permission)) return next(httpError(403, 'Bạn không có quyền thực hiện thao tác này.'))
    next()
  }
}
