import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

export const DEFAULT_PASSWORD_RESET_TTL_MS = 15 * 60 * 1000

export interface PasswordResetTokenOptions {
  now?: Date
  ttlMs?: number
}

export function hashPasswordResetToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function createPasswordResetToken(
  database: Database.Database,
  userId: string,
  options: PasswordResetTokenOptions = {},
): { token: string; expiresAt: string } {
  const now = options.now ?? new Date()
  const ttlMs = options.ttlMs ?? DEFAULT_PASSWORD_RESET_TTL_MS
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('Password reset TTL is invalid.')
  const token = randomBytes(32).toString('base64url')
  const createdAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString()
  database.transaction(() => {
    database.prepare(`UPDATE password_reset_tokens SET consumed_at=?
      WHERE user_id=? AND consumed_at IS NULL`).run(createdAt, userId)
    database.prepare(`INSERT INTO password_reset_tokens
      (id, user_id, token_hash, expires_at, consumed_at, created_at)
      VALUES (?, ?, ?, ?, NULL, ?)`).run(randomUUID(), userId, hashPasswordResetToken(token), expiresAt, createdAt)
  }).immediate()
  return { token, expiresAt }
}

export function changePasswordAndInvalidateSessions(
  database: Database.Database,
  userId: string,
  passwordHash: string,
): number {
  return database.transaction(() => {
    const result = database.prepare(`UPDATE users
      SET password_hash=?, session_version=session_version+1 WHERE id=?`).run(passwordHash, userId)
    if (result.changes !== 1) throw new Error('User not found.')
    return Number((database.prepare('SELECT session_version FROM users WHERE id=?').get(userId) as any).session_version)
  }).immediate()
}

export function resetPasswordWithToken(
  database: Database.Database,
  token: string,
  passwordHash: string,
  options: { now?: Date } = {},
): string {
  const now = options.now ?? new Date()
  const nowIso = now.toISOString()
  return database.transaction(() => {
    const row = database.prepare(`SELECT id, user_id, expires_at, consumed_at
      FROM password_reset_tokens WHERE token_hash=?`).get(hashPasswordResetToken(token)) as any
    if (!row || row.consumed_at) throw new Error('Password reset token is invalid or already used.')
    if (row.expires_at <= nowIso) throw new Error('Password reset token is expired or invalid.')
    const consumed = database.prepare(`UPDATE password_reset_tokens SET consumed_at=?
      WHERE id=? AND consumed_at IS NULL AND expires_at>?`).run(nowIso, row.id, nowIso)
    if (consumed.changes !== 1) throw new Error('Password reset token is invalid or already used.')
    const updated = database.prepare(`UPDATE users SET password_hash=?, session_version=session_version+1
      WHERE id=?`).run(passwordHash, row.user_id)
    if (updated.changes !== 1) throw new Error('Password reset token is invalid.')
    return String(row.user_id)
  }).immediate()
}
