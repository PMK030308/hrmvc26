// ============================================================================
// Middleware xác thực JWT + guard role.
// ============================================================================
import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import type { AuthUser, RoleCode } from '../types.js'
import { httpError } from '../types.js'

const JWT_SECRET = process.env.JWT_SECRET || 'hrm-attendance-dev-secret-change-me'
const JWT_TTL = '7d'

export function signToken(user: AuthUser): string {
  return jwt.sign(
    { id: user.id, email: user.email, employeeId: user.employeeId, roles: user.roles, permissions: user.permissions, departmentScopes: user.departmentScopes },
    JWT_SECRET,
    { expiresIn: JWT_TTL },
  )
}

export interface AuthedRequest extends Request {
  user?: AuthUser
}

/** Yêu cầu đăng nhập. Gắn req.user. */
export function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) return next(httpError(401, 'Chưa đăng nhập.'))
  const token = header.slice(7)
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser
    req.user = payload
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