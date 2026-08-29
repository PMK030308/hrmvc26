// Auth routes (§14.1)
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { db } from '../db.js'
import { signToken, requireAuth, type AuthedRequest } from '../middleware/auth.js'
import { getUserByEmail, mapUser, getUserById } from '../repo.js'
import { httpError } from '../types.js'
import { pushAudit } from '../helpers.js'
import { validatePasswordChange } from '../lib/profile.js'

export const authRouter = Router()

authRouter.post('/login', (req, res, next) => {
  try {
    const { email, password } = req.body ?? {}
    const row = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get((email ?? '').toLowerCase()) as any
    if (!row || !bcrypt.compareSync(password ?? '', row.password_hash)) {
      throw httpError(401, 'Email hoặc mật khẩu không đúng.')
    }
    const user = mapUser(row)
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
    res.json(u)
  } catch (e) { next(e) }
})

authRouter.post('/forgot-password', (req, res) => {
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
