export function validateResetPasswordForm(token: string, password: string, confirmation: string): string | null {
  if (!token.trim()) return 'Token đặt lại mật khẩu không hợp lệ.'
  if (password.length < 8) return 'Mật khẩu mới phải có ít nhất 8 ký tự.'
  if (password !== confirmation) return 'Xác nhận mật khẩu không khớp.'
  return null
}
