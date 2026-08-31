// Auth routes (§14.1)
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { db } from '../db.js'
import { signToken, requireAuth, type AuthedRequest } from '../middleware/auth.js'
import { getUserByEmail, mapUser, getUserById } from '../repo.js'
import { httpError } from '../types.js'
import { pushAudit } from '../helpers.js'
import { validatePasswordChange } from '../lib/profile.js'
import { loadAuthorizationActor } from '../authz/authorizationActor.js'
import { getPermissionMatrixSnapshot } from '../services/permissionService.js'
import { createRateLimitMiddleware } from '../middleware/rateLimit.js'

export const authRouter = Router()

const loginRateLimit = createRateLimitMiddleware({
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  maxAttempts: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 10,
  key: (request) => `${request.ip}:${String(request.body?.email ?? '').trim().toLowerCase()}`,
})
const forgotPasswordRateLimit = createRateLimitMiddleware({
  windowMs: Number(process.env.FORGOT_PASSWORD_RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000,
  maxAttempts: Number(process.env.FORGOT_PASSWORD_RATE_LIMIT_MAX) || 5,
})

authRouter.post('/login', loginRateLimit, (req, res, next) => {
  try {
    const { email, password } = req.body ?? {}
    const row = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get((email ?? '').toLowerCase()) as any
    if (!row || !bcrypt.compareSync(password ?? '', row.password_hash)) {
      throw httpError(401, 'Email hoặc mật khẩu không đúng.')
    }
    const actor = loadAuthorizationActor(row.id)
    const user = {
      ...mapUser(row),
      effectivePermissions: [...actor.permissions],
      effectiveDepartmentScopes: actor.departmentScopes,
      permissionMatrixVersion: getPermissionMatrixSnapshot().version,
    }
    const token = signToken(user)
    pushAudit(user.id, user.email, 4, 'session', null, 'Đăng nhập hệ thống')
    res.json({ token, user })
  } catch (e) { next(e) }
})

authRouter.post('/logout', requireAuth, (req: AuthedRequest, res) => {
  const u = req.user!
  pushAudit(u.id, u.email, 5, 'session', null, 'Đăng xuất')
  res.json({ ok: true })
})

authRouter.get('/me', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const u = getUserById(req.user!.id)
    if (!u) throw httpError(401, 'Phiên hết hạn.')
    const actor = req.authorizationActor ?? loadAuthorizationActor(req.user!.id)
    res.json({
      ...u,
      effectivePermissions: [...actor.permissions],
      effectiveDepartmentScopes: actor.departmentScopes,
      permissionMatrixVersion: getPermissionMatrixSnapshot().version,
    })
  } catch (e) { next(e) }
})

authRouter.post('/forgot-password', forgotPasswordRateLimit, (req, res) => {
  const { email } = req.body ?? {}
  res.json({ ok: true, message: `Đường link đặt lại mật khẩu đã được gửi đến ${email} (demo).` })
})

authRouter.put('/change-password', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const { currentPassword = '', newPassword = '', confirmPassword = '' } = req.body ?? {}
    const validationError = validatePasswordChange(currentPassword, newPassword, confirmPassword)
    if (validationError) throw httpError(400, validationError)

    const row = db.prepare('SELECT * FROM users WHERE id=?').get(req.user!.id) as any
    if (!row || !bcrypt.compareSync(currentPassword, row.password_hash)) {
      throw httpError(400, 'Mật khẩu hiện tại không đúng.')
    }

    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(newPassword, 10), req.user!.id)
    pushAudit(req.user!.id, req.user!.email, 2, 'User', req.user!.id, 'Đổi mật khẩu tài khoản')
    res.json({ ok: true })
  } catch (e) { next(e) }
})
