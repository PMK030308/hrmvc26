import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { authApi } from '@/api/auth'
import { Button, Card, CardBody, CardHeader, Input } from '@/components/ui'
import { validateResetPasswordForm } from '@/lib/passwordReset'

export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') ?? ''
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const validationError = validateResetPasswordForm(token, newPassword, confirmPassword)
    if (validationError) return toast.error(validationError)
    setLoading(true)
    try {
      await authApi.resetPassword({ token, newPassword, confirmPassword })
      toast.success('Đặt lại mật khẩu thành công. Vui lòng đăng nhập.')
      navigate('/login', { replace: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Không thể đặt lại mật khẩu.')
    } finally { setLoading(false) }
  }

  return <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
    <Card className="w-full max-w-md">
      <CardHeader title="Đặt lại mật khẩu" subtitle="Đường dẫn chỉ dùng một lần và có thời hạn 15 phút" icon={<KeyRound className="h-4 w-4" />} />
      <CardBody>
        {!token ? <div className="space-y-4 text-sm text-danger-600"><p>Đường dẫn đặt lại mật khẩu không hợp lệ hoặc thiếu token.</p><Link to="/forgot-password" className="inline-flex items-center gap-2 font-medium text-brand-600 hover:underline"><ArrowLeft className="h-4 w-4" />Yêu cầu đường dẫn mới</Link></div> : <form className="space-y-4" onSubmit={submit}>
          <Input id="reset-password" label="Mật khẩu mới" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} hint="Tối thiểu 8 ký tự" />
          <Input id="reset-password-confirm" label="Xác nhận mật khẩu" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
          <Button type="submit" className="w-full" loading={loading}>Cập nhật mật khẩu</Button>
        </form>}
      </CardBody>
    </Card>
  </main>
}
