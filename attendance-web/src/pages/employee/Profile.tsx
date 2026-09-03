import { useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, BriefcaseBusiness, Building2, CalendarDays, Camera, CheckCircle2, KeyRound, Mail, MapPin, Pencil, Phone, Save, ShieldCheck, UserRound, X } from 'lucide-react'
import { toast } from 'sonner'
import { authApi } from '@/api/auth'
import { profileApi } from '@/api/config'
import { useAuthStore } from '@/stores/authStore'
import { CONTRACT_LABEL, EMPLOYEE_STATUS_LABEL, GENDER_LABEL, ROLE_LABEL, WORK_NATURE_LABEL } from '@/constants/enums'
import { fmtDate, yearsOfService } from '@/lib/date'
import { Avatar, Badge, Button, Card, CardBody, CardHeader, Input, Select, Skeleton, StatusBadge } from '@/components/ui'
import type { Employee, Gender, MaritalStatus } from '@/types'

type ProfileForm = Pick<Employee, 'firstName' | 'lastName' | 'phone' | 'address' | 'gender' | 'maritalStatus'> & {
  dateOfBirth: string
  avatarData: string | null
}

const maritalOptions: { value: MaritalStatus; label: string }[] = [
  { value: 'Single', label: 'Độc thân' }, { value: 'Married', label: 'Đã kết hôn' },
  { value: 'Divorced', label: 'Ly hôn' }, { value: 'Widowed', label: 'Góa' },
]

export default function ProfilePage() {
  const user = useAuthStore((state) => state.user)!
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<ProfileForm | null>(null)
  const [errors, setErrors] = useState<Partial<Record<keyof ProfileForm, string>>>({})
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })

  const { data: employee, isLoading, isError } = useQuery({ queryKey: ['profile'], queryFn: () => profileApi.get() })

  const saveProfile = useMutation({
    mutationFn: (payload: ProfileForm) => profileApi.update({ ...payload, dateOfBirth: payload.dateOfBirth || null }),
    onSuccess: () => {
      toast.success('Đã cập nhật hồ sơ cá nhân.')
      setEditing(false); setForm(null)
      queryClient.invalidateQueries({ queryKey: ['profile'] })
      queryClient.invalidateQueries({ queryKey: ['me-employee'] })
      queryClient.invalidateQueries({ queryKey: ['employee', 'dashboard'] })
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const changePassword = useMutation({
    mutationFn: () => authApi.changePassword(passwords),
    onSuccess: () => {
      toast.success('Đổi mật khẩu thành công. Vui lòng đăng nhập lại.')
      setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' })
      void useAuthStore.getState().logout()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const updateAvatar = useMutation({
    mutationFn: (avatarData: string) => profileApi.update({ avatarData }),
    onSuccess: (updated) => {
      toast.success('Đã cập nhật ảnh đại diện.')
      queryClient.setQueryData(['profile'], updated)
      queryClient.invalidateQueries({ queryKey: ['me-employee'] })
      queryClient.invalidateQueries({ queryKey: ['employee', 'dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['employees'] })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  function beginEditing() {
    if (!employee) return
    setForm({ firstName: employee.firstName, lastName: employee.lastName, phone: employee.phone, address: employee.address,
      gender: employee.gender, maritalStatus: employee.maritalStatus, dateOfBirth: employee.dateOfBirth ?? '', avatarData: employee.avatarData })
    setErrors({}); setEditing(true)
  }
  function cancelEditing() { setEditing(false); setForm(null); setErrors({}) }
  function submitProfile() {
    if (!form) return
    const nextErrors: typeof errors = {}
    if (!form.lastName.trim()) nextErrors.lastName = 'Vui lòng nhập họ.'
    if (!form.firstName.trim()) nextErrors.firstName = 'Vui lòng nhập tên.'
    if (form.phone && !/^[0-9+().\s-]{8,20}$/.test(form.phone)) nextErrors.phone = 'Số điện thoại chưa đúng định dạng.'
    setErrors(nextErrors)
    if (!Object.keys(nextErrors).length) saveProfile.mutate(form)
  }
  function handleAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) return toast.error('Vui lòng chọn một tệp hình ảnh.')
    if (file.size > 2 * 1024 * 1024) return toast.error('Ảnh đại diện không được vượt quá 2 MB.')
    const reader = new FileReader()
    reader.onload = () => {
      const avatarData = String(reader.result)
      setForm((current) => current ? { ...current, avatarData } : current)
      updateAvatar.mutate(avatarData)
    }
    reader.onerror = () => toast.error('Không thể đọc tệp ảnh này.')
    reader.readAsDataURL(file)
  }
  function submitPassword() {
    if (!passwords.currentPassword) return toast.error('Vui lòng nhập mật khẩu hiện tại.')
    if (passwords.newPassword.length < 8) return toast.error('Mật khẩu mới phải có ít nhất 8 ký tự.')
    if (passwords.newPassword !== passwords.confirmPassword) return toast.error('Xác nhận mật khẩu không khớp.')
    changePassword.mutate()
  }

  if (isLoading) return <ProfileSkeleton />
  if (isError || !employee) return <Card><CardBody className="py-12 text-center text-sm text-danger-600">Không thể tải hồ sơ tài khoản. Vui lòng thử lại.</CardBody></Card>

  const shownAvatar = editing ? form?.avatarData : employee.avatarData
  const department = employee.departmentName ?? 'Chưa cập nhật'
  const position = employee.positionName ?? 'Chưa cập nhật'
  const branch = employee.branchName ?? 'Chưa cập nhật'

  return <div className="space-y-5">
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-700 via-brand-600 to-info-600 p-5 text-white shadow-card sm:p-7">
      <div className="absolute -right-16 -top-20 h-52 w-52 rounded-full bg-white/10" /><div className="absolute -bottom-24 right-28 h-44 w-44 rounded-full border-[28px] border-white/5" />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            <Avatar name={employee.fullName} src={shownAvatar} size="lg" className="!h-20 !w-20 !text-2xl ring-4 ring-white/25 sm:!h-24 sm:!w-24" />
            <button type="button" onClick={() => fileInputRef.current?.click()} aria-label="Đổi ảnh đại diện" className="absolute -bottom-1 -right-1 grid h-9 w-9 place-items-center rounded-full bg-white text-brand-700 shadow-lg ring-2 ring-brand-600 transition hover:scale-105"><Camera className="h-4 w-4" /></button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatar} />
          </div>
          <div className="min-w-0"><div className="mb-1 flex flex-wrap items-center gap-2"><h1 className="truncate text-2xl font-bold sm:text-3xl">{employee.fullName}</h1><CheckCircle2 className="h-5 w-5 text-white/90" /></div>
            <p className="text-sm text-white/75">{employee.employeeCode} · {position}</p><div className="mt-3 flex flex-wrap gap-2">{user.roles.map((role) => <span key={role} className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium ring-1 ring-white/20">{ROLE_LABEL[role].label}</span>)}</div></div>
        </div>
        <div className="flex flex-wrap gap-2"><Button type="button" onClick={() => fileInputRef.current?.click()} loading={updateAvatar.isPending} icon={<Camera className="h-4 w-4" />} className="!bg-white/15 !text-white shadow-none ring-1 ring-white/30 backdrop-blur-sm hover:!bg-white/25">Đổi ảnh đại diện</Button>{editing ? <><Button variant="secondary" onClick={cancelEditing} icon={<X className="h-4 w-4" />}>Hủy</Button><Button onClick={submitProfile} loading={saveProfile.isPending} icon={<Save className="h-4 w-4" />} className="!bg-success-500 !text-white ring-1 ring-success-400 hover:!bg-success-600">Lưu thay đổi</Button></> : <Button onClick={beginEditing} icon={<Pencil className="h-4 w-4" />} className="!bg-white/15 !text-white shadow-none ring-1 ring-white/30 backdrop-blur-sm hover:!bg-white/25">Chỉnh sửa hồ sơ</Button>}</div>
      </div>
    </section>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <Card><CardHeader title="Thông tin cá nhân" subtitle="Thông tin liên hệ và nhận diện của bạn" icon={<UserRound className="h-4 w-4" />} /><CardBody>
          {editing && form ? <div className="grid gap-4 sm:grid-cols-2">
            <Input id="lastName" label="Họ" value={form.lastName} error={errors.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} />
            <Input id="firstName" label="Tên" value={form.firstName} error={errors.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} />
            <Input id="phone" label="Số điện thoại" inputMode="tel" value={form.phone} error={errors.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            <Input id="dateOfBirth" label="Ngày sinh" type="date" value={form.dateOfBirth} onChange={(event) => setForm({ ...form, dateOfBirth: event.target.value })} />
            <Select id="gender" label="Giới tính" value={form.gender} onChange={(event) => setForm({ ...form, gender: Number(event.target.value) as Gender })}><option value={0}>Khác</option><option value={1}>Nam</option><option value={2}>Nữ</option></Select>
            <Select id="maritalStatus" label="Tình trạng hôn nhân" value={form.maritalStatus} onChange={(event) => setForm({ ...form, maritalStatus: event.target.value as MaritalStatus })}>{maritalOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select>
            <div className="sm:col-span-2"><Input id="address" label="Địa chỉ hiện tại" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></div><p className="text-xs text-slate-400 sm:col-span-2">Ảnh JPG, PNG hoặc WebP, dung lượng tối đa 2 MB.</p>
          </div> : <div className="grid gap-3 sm:grid-cols-2"><InfoItem icon={<Mail />} label="Email" value={employee.email || user.email} /><InfoItem icon={<Phone />} label="Số điện thoại" value={employee.phone || 'Chưa cập nhật'} /><InfoItem icon={<CalendarDays />} label="Ngày sinh" value={employee.dateOfBirth ? fmtDate(employee.dateOfBirth) : 'Chưa cập nhật'} /><InfoItem icon={<UserRound />} label="Giới tính" value={GENDER_LABEL[employee.gender]} /><InfoItem icon={<BadgeCheck />} label="Tình trạng hôn nhân" value={maritalOptions.find((item) => item.value === employee.maritalStatus)?.label ?? 'Chưa cập nhật'} /><InfoItem icon={<MapPin />} label="Địa chỉ" value={employee.address || 'Chưa cập nhật'} /></div>}
        </CardBody></Card>
        <Card><CardHeader title="Thông tin công việc" subtitle="Dữ liệu do bộ phận nhân sự quản lý" icon={<BriefcaseBusiness className="h-4 w-4" />} /><CardBody className="grid gap-3 sm:grid-cols-2"><InfoItem icon={<Building2 />} label="Phòng ban" value={department} /><InfoItem icon={<BriefcaseBusiness />} label="Chức vụ" value={position} /><InfoItem icon={<MapPin />} label="Chi nhánh" value={branch} /><InfoItem icon={<CalendarDays />} label="Ngày vào làm" value={fmtDate(employee.hireDate)} /><InfoItem icon={<BadgeCheck />} label="Loại hợp đồng" value={CONTRACT_LABEL[employee.contractType]} /><InfoItem icon={<BriefcaseBusiness />} label="Tính chất công việc" value={WORK_NATURE_LABEL[employee.workNature]} /></CardBody></Card>
      </div>
      <aside className="space-y-5">
        <Card><CardHeader title="Tổng quan hồ sơ" icon={<ShieldCheck className="h-4 w-4" />} /><CardBody className="space-y-4"><div className="flex items-center justify-between gap-3"><span className="text-sm text-slate-500">Trạng thái</span><StatusBadge map={EMPLOYEE_STATUS_LABEL} value={employee.status} /></div><div className="flex items-center justify-between gap-3"><span className="text-sm text-slate-500">Mã nhân viên</span><span className="text-sm font-semibold text-slate-800">{employee.employeeCode}</span></div><div className="flex items-center justify-between gap-3"><span className="text-sm text-slate-500">Thâm niên</span><span className="text-sm font-semibold text-slate-800">{yearsOfService(employee.hireDate)} năm</span></div><div className="border-t border-slate-100 pt-4"><Badge tone="success" dot>Hồ sơ đang hoạt động</Badge></div></CardBody></Card>
        <Card><CardHeader title="Bảo mật tài khoản" subtitle="Đổi mật khẩu đăng nhập" icon={<KeyRound className="h-4 w-4" />} /><CardBody className="space-y-4"><Input id="currentPassword" label="Mật khẩu hiện tại" type="password" autoComplete="current-password" value={passwords.currentPassword} onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })} /><Input id="newPassword" label="Mật khẩu mới" type="password" autoComplete="new-password" hint="Tối thiểu 8 ký tự" value={passwords.newPassword} onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })} /><Input id="confirmPassword" label="Xác nhận mật khẩu" type="password" autoComplete="new-password" value={passwords.confirmPassword} onChange={(event) => setPasswords({ ...passwords, confirmPassword: event.target.value })} /><Button className="w-full" variant="secondary" onClick={submitPassword} loading={changePassword.isPending} icon={<KeyRound className="h-4 w-4" />}>Cập nhật mật khẩu</Button></CardBody></Card>
      </aside>
    </div>
  </div>
}

function InfoItem({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="flex min-h-20 items-start gap-3 rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-100"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-brand-600 shadow-sm [&>svg]:h-4 [&>svg]:w-4">{icon}</span><div className="min-w-0 pt-0.5"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 break-words text-sm font-semibold text-slate-800">{value}</p></div></div>
}
function ProfileSkeleton() { return <div className="space-y-5"><Skeleton className="h-48 rounded-2xl" /><div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]"><Skeleton className="h-[520px] rounded-2xl" /><Skeleton className="h-80 rounded-2xl" /></div></div> }
