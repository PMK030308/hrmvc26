// ============================================================================
// Middleware xác thực JWT + guard role.
// ============================================================================
import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import type { AuthUser, RoleCode } from '../types.js'
import { httpError } from '../types.js'
import { loadAuthorizationActor, type AuthorizationActor } from '../authz/authorizationActor.js'
import { resolveJwtSecret } from '../lib/securityConfig.js'

const JWT_TTL = '7d'
const jwtSecret = () => resolveJwtSecret(process.env)

export function signToken(user: AuthUser): string {
  return jwt.sign({ id: user.id }, jwtSecret(), { expiresIn: JWT_TTL })
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
    const payload = jwt.verify(token, jwtSecret()) as { id?: unknown }
    if (typeof payload.id !== 'string') throw new Error('invalid subject')
    const actor = loadAuthorizationActor(payload.id)
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
