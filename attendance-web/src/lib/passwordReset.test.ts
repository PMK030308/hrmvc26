import assert from 'node:assert/strict'
import test from 'node:test'
import { validateResetPasswordForm } from './passwordReset'

test('reset password form requires a valid token and matching secure password', () => {
  assert.match(validateResetPasswordForm('', 'password123', 'password123') ?? '', /token/i)
  assert.match(validateResetPasswordForm('token', 'short', 'short') ?? '', /8/)
  assert.match(validateResetPasswordForm('token', 'password123', 'password456') ?? '', /không khớp/i)
  assert.equal(validateResetPasswordForm('token', 'password123', 'password123'), null)
})
