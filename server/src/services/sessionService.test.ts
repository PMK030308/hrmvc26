import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import test from 'node:test'
import {
  createPasswordResetToken,
  hashPasswordResetToken,
  resetPasswordWithToken,
} from './sessionService.js'

function database(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, password_hash TEXT NOT NULL, session_version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE password_reset_tokens (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL, consumed_at TEXT, created_at TEXT NOT NULL
    );
  `)
  db.prepare("INSERT INTO users (id, password_hash) VALUES ('user-1', 'old-hash')").run()
  return db
}

test('password reset token is random, hash-only, one-time and defaults to 15 minutes', () => {
  const db = database()
  const now = new Date('2026-08-31T10:00:00.000Z')
  const issued = createPasswordResetToken(db, 'user-1', { now })
  assert.equal(issued.expiresAt, '2026-08-31T10:15:00.000Z')
  const stored = db.prepare('SELECT token_hash, expires_at FROM password_reset_tokens').get() as any
  assert.equal(stored.token_hash, hashPasswordResetToken(issued.token))
  assert.equal(JSON.stringify(stored).includes(issued.token), false)

  assert.equal(resetPasswordWithToken(db, issued.token, 'new-hash', { now: new Date('2026-08-31T10:14:59.999Z') }), 'user-1')
  assert.equal((db.prepare("SELECT session_version FROM users WHERE id='user-1'").get() as any).session_version, 2)
  assert.throws(() => resetPasswordWithToken(db, issued.token, 'replay-hash', { now }), /invalid|used/i)
  db.close()
})

test('expired reset tokens fail without changing password or session version', () => {
  const db = database()
  const issued = createPasswordResetToken(db, 'user-1', { now: new Date('2026-08-31T10:00:00.000Z') })
  assert.throws(() => resetPasswordWithToken(db, issued.token, 'new-hash', { now: new Date('2026-08-31T10:15:00.001Z') }), /expired|invalid/i)
  assert.deepEqual(db.prepare("SELECT password_hash, session_version FROM users WHERE id='user-1'").get(), {
    password_hash: 'old-hash', session_version: 1,
  })
  db.close()
})
