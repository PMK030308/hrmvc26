// Auth routes (§14.1)
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { db } from '../db.js'
import { signToken, signRefreshToken, verifyRefreshToken, requireAuth, type AuthedRequest } from '../middleware/auth.js'
import { getUserByEmail, mapUser, getUserById } from '../repo.js'
import { httpError } from '../types.js'
import { pushAudit } from '../helpers.js'
import { validatePasswordChange } from '../lib/profile.js'
import { loadAuthorizationActor } from '../authz/authorizationActor.js'
import { getPermissionMatrixSnapshot } from '../services/permissionService.js'
import { createRateLimitMiddleware } from '../middleware/rateLimit.js'
import { changePasswordAndInvalidateSessions, createPasswordResetToken, resetPasswordWithToken } from '../services/sessionService.js'

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
const refreshTokenRateLimit = createRateLimitMiddleware({
  windowMs: Number(process.env.REFRESH_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  maxAttempts: Number(process.env.REFRESH_RATE_LIMIT_MAX) || 30,
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
    const refreshToken = signRefreshToken(user)
    pushAudit(user.id, user.email, 4, 'session', null, 'Đăng nhập hệ thống')
    res.json({ token, refreshToken, user })
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
  const email = String(req.body?.email ?? '').trim()
  const row = email ? db.prepare('SELECT id FROM users WHERE LOWER(email)=LOWER(?) AND is_active=1').get(email) as any : null
  let developmentResetToken: string | undefined
  if (row) {
    const issued = createPasswordResetToken(db, row.id)
    if (process.env.NODE_ENV !== 'production' && process.env.PASSWORD_RESET_EXPOSE_TOKEN === 'true') {
      developmentResetToken = issued.token
    }
  }
  res.json({
    ok: true,
    message: 'Nếu tài khoản tồn tại, hướng dẫn đặt lại mật khẩu sẽ được gửi.',
    ...(developmentResetToken ? { developmentResetToken } : {}),
  })
})

authRouter.post('/refresh', refreshTokenRateLimit, (req, res, next) => {
  try {
    const verified = verifyRefreshToken(String(req.body?.refreshToken ?? ''))
    const user = getUserById(verified.id)
    if (!user) throw httpError(401, 'Refresh token không hợp lệ hoặc đã hết hạn.')
    res.json({ token: signToken(user), refreshToken: signRefreshToken(user) })
  } catch { next(httpError(401, 'Refresh token không hợp lệ hoặc đã hết hạn.')) }
})

authRouter.post('/reset-password', forgotPasswordRateLimit, (req, res, next) => {
  try {
    const token = String(req.body?.token ?? '')
    const newPassword = String(req.body?.newPassword ?? '')
    const confirmPassword = String(req.body?.confirmPassword ?? '')
    if (!token) throw httpError(400, 'Token đặt lại mật khẩu không hợp lệ.')
    if (newPassword.length < 8) throw httpError(400, 'Mật khẩu mới phải có ít nhất 8 ký tự.')
    if (newPassword !== confirmPassword) throw httpError(400, 'Xác nhận mật khẩu không khớp.')
    let userId: string
    try {
      userId = resetPasswordWithToken(db, token, bcrypt.hashSync(newPassword, 10))
    } catch {
      throw httpError(400, 'Token đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.')
    }
    const user = getUserById(userId)
    if (user) pushAudit(user.id, user.email, 2, 'User', user.id, 'Đặt lại mật khẩu tài khoản', '127.0.0.1', 'security')
    res.json({ ok: true })
  } catch (e) { next(e) }
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

    changePasswordAndInvalidateSessions(db, req.user!.id, bcrypt.hashSync(newPassword, 10))
    pushAudit(req.user!.id, req.user!.email, 2, 'User', req.user!.id, 'Đổi mật khẩu tài khoản', '127.0.0.1', 'security')
    res.json({ ok: true })
  } catch (e) { next(e) }
})
