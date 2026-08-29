import assert from 'node:assert/strict'
import test from 'node:test'
import { validatePasswordChange } from './profile.js'

test('validatePasswordChange accepts a valid password update', () => {
  assert.equal(validatePasswordChange('123456', 'MatKhauMoi1', 'MatKhauMoi1'), null)
})

test('validatePasswordChange requires the current password', () => {
  assert.equal(validatePasswordChange('', 'MatKhauMoi1', 'MatKhauMoi1'), 'Vui lòng nhập mật khẩu hiện tại.')
})

test('validatePasswordChange enforces a secure minimum length', () => {
  assert.equal(validatePasswordChange('123456', '12345', '12345'), 'Mật khẩu mới phải có ít nhất 8 ký tự.')
})

test('validatePasswordChange rejects a mismatched confirmation', () => {
  assert.equal(validatePasswordChange('123456', 'MatKhauMoi1', 'MatKhauKhac1'), 'Xác nhận mật khẩu không khớp.')
})
