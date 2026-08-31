import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Mail } from 'lucide-react'
import { toast } from 'sonner'
import { authApi } from '@/api/auth'
import { Button, Card, CardBody, CardHeader, Input } from '@/components/ui'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!email.trim()) return toast.error('Vui lòng nhập email tài khoản.')
    setLoading(true)
    try {
      await authApi.forgotPassword(email.trim())
      setSent(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Không thể gửi yêu cầu đặt lại mật khẩu.')
    } finally { setLoading(false) }
  }

  return <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
    <Card className="w-full max-w-md">
      <CardHeader title="Quên mật khẩu" subtitle="Nhập email để nhận đường dẫn đặt lại mật khẩu" icon={<Mail className="h-4 w-4" />} />
      <CardBody>
        {sent ? <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300">
          <p>Nếu tài khoản tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi. Vui lòng kiểm tra hộp thư và thư rác.</p>
          <Link to="/login" className="inline-flex items-center gap-2 font-medium text-brand-600 hover:underline"><ArrowLeft className="h-4 w-4" />Quay lại đăng nhập</Link>
        </div> : <form className="space-y-4" onSubmit={submit}>
          <Input id="reset-email" label="Email tài khoản" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          <Button type="submit" className="w-full" loading={loading}>Gửi đường dẫn đặt lại</Button>
          <Link to="/login" className="flex items-center justify-center gap-2 text-sm font-medium text-brand-600 hover:underline"><ArrowLeft className="h-4 w-4" />Quay lại đăng nhập</Link>
        </form>}
      </CardBody>
    </Card>
  </main>
}
