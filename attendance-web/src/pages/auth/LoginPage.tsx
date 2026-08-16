import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Fingerprint, Mail, Lock, Eye, EyeOff, ArrowRight } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/authStore'
import { homeForRoles } from '@/components/layout/nav'
import { Button } from '@/components/ui'

const schema = z.object({
  email: z.string().email('Email không hợp lệ'),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
})
type FormVals = z.infer<typeof schema>

const demoAccounts = [
  { label: 'Nhân viên', email: 'khoi.pham@technova.vn' },
  { label: 'Quản lý', email: 'yen.tran@technova.vn' },
  { label: 'HR', email: 'anh.dang@technova.vn' },
  { label: 'Kế toán', email: 'hung.bui@technova.vn' },
  { label: 'Giám đốc', email: 'triet.pham@technova.vn' },
  { label: 'Admin', email: 'admin@technova.vn' },
]

export default function LoginPage() {
  const login = useAuthStore((s) => s.login)
  const loading = useAuthStore((s) => s.loading)
  const navigate = useNavigate()
  const location = useLocation()
  const [showPw, setShowPw] = useState(false)
  const { register, handleSubmit, setValue, formState: { errors } } = useForm<FormVals>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  })

  const from = (location.state as { from?: string } | null)?.from

  async function onSubmit(vals: FormVals) {
    try {
      const user = await login(vals.email, vals.password)
      toast.success(`Xin chào, ${user.email}`)
      navigate(from ?? homeForRoles(user.roles), { replace: true })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  function quickFill(email: string) {
    setValue('email', email)
    setValue('password', '123456')
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-brand-700 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-500/30 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-brand-400/20 blur-3xl" />
        <div className="relative flex items-center gap-3 text-white">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-white/15 backdrop-blur"><Fingerprint className="h-6 w-6" /></div>
          <div>
            <p className="text-lg font-bold">HRM Chấm công</p>
            <p className="text-xs text-brand-200">TechNova JSC</p>
          </div>
        </div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="relative max-w-md text-white">
          <h1 className="text-3xl font-bold leading-tight">Quản lý chấm công &amp; đơn từ, chuyên nghiệp.</h1>
          <p className="mt-4 text-brand-100">Chấm công đa phương thức (khuôn mặt, GPS, Wi-Fi, IP, QR), đơn từ 6 loại với quy trình duyệt nhiều cấp, bảng công liên kết lương — tất cả trong một.</p>
          <ul className="mt-6 space-y-2 text-sm text-brand-100">
            {['Ghép cặp chấm công thông minh, chống trùng', 'Quỹ phép &amp; duyệt nhiều cấp có điều kiện', 'Dashboard realtime &amp; thông báo tức thời'].map((f) => (
              <li key={f} className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-brand-200" /><span dangerouslySetInnerHTML={{ __html: f }} /></li>
            ))}
          </ul>
        </motion.div>
        <p className="relative text-xs text-brand-200">© 2026 TechNova · Đồ án tốt nghiệp</p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-slate-50 p-6 sm:p-12">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-600 text-white"><Fingerprint className="h-6 w-6" /></div>
              <div><p className="text-lg font-bold text-slate-800">HRM Chấm công</p><p className="text-xs text-slate-500">TechNova JSC</p></div>
            </div>
          </div>
          <h2 className="text-2xl font-bold text-slate-800">Đăng nhập</h2>
          <p className="mt-1 text-sm text-slate-500">Chào mừng trở lại! Vui lòng nhập thông tin đăng nhập.</p>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input type="email" autoComplete="email" placeholder="ban@congty.vn" {...register('email')}
                  className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" />
              </div>
              {errors.email && <p className="mt-1 text-xs text-danger-600">{errors.email.message}</p>}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Mật khẩu</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input type={showPw ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••" {...register('password')}
                  className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-10 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" />
                <button type="button" onClick={() => setShowPw((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && <p className="mt-1 text-xs text-danger-600">{errors.password.message}</p>}
            </div>
            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 text-slate-600"><input type="checkbox" className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" defaultChecked /> Ghi nhớ</label>
              <button type="button" onClick={() => toast.info('Liên hệ HR để đặt lại mật khẩu (demo).')} className="font-medium text-brand-600 hover:underline">Quên mật khẩu?</button>
            </div>
            <Button type="submit" loading={loading} className="w-full" size="lg" icon={<ArrowRight className="h-4 w-4" />}>
              Đăng nhập
            </Button>
          </form>

          {/* Demo accounts */}
          <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Tài khoản demo · mật khẩu <span className="font-mono text-brand-600">123456</span></p>
            <div className="flex flex-wrap gap-1.5">
              {demoAccounts.map((a) => (
                <button key={a.email} onClick={() => quickFill(a.email)} type="button"
                  className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-brand-50 hover:text-brand-700">
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}