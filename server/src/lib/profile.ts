export function validatePasswordChange(currentPassword: string, newPassword: string, confirmPassword: string): string | null {
  if (!currentPassword) return 'Vui lòng nhập mật khẩu hiện tại.'
  if (newPassword.length < 8) return 'Mật khẩu mới phải có ít nhất 8 ký tự.'
  if (newPassword !== confirmPassword) return 'Xác nhận mật khẩu không khớp.'
  if (newPassword === currentPassword) return 'Mật khẩu mới phải khác mật khẩu hiện tại.'
  return null
}
