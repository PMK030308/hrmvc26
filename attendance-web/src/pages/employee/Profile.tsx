import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserCog, Mail, Phone, MapPin, Calendar, Briefcase, Save } from 'lucide-react'
import { toast } from 'sonner'
import { profileApi } from '@/api/config'
import { useAuthStore } from '@/stores/authStore'
import { EMPLOYEE_STATUS_LABEL, WORK_NATURE_LABEL, CONTRACT_LABEL, GENDER_LABEL } from '@/constants/enums'
import { fmtDate, yearsOfService } from '@/lib/date'
import { Card, CardHeader, CardBody, PageHeader, Input, Select, Avatar, StatusBadge, Button } from '@/components/ui'
import type { Gender, MaritalStatus } from '@/types'

const maritalOpts: { value: MaritalStatus; label: string }[] = [
  { value: 'Single', label: 'Độc thân' }, { value: 'Married', label: 'Đã kết hôn' }, { value: 'Divorced', label: 'Ly hôn' }, { value: 'Widowed', label: 'Goá phụ' },
]

export default function ProfilePage() {
  const user = useAuthStore((s) => s.user)!
  const qc = useQueryClient()
  const { data: emp, isLoading } = useQuery({ queryKey: ['profile'], queryFn: () => profileApi.get() })
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', address: '', dateOfBirth: '', maritalStatus: 'Single' as MaritalStatus, gender: 1 as Gender })

  const save = useMutation({
    mutationFn: () => profileApi.update({
      firstName: form.firstName, lastName: form.lastName, phone: form.phone,
      address: form.address, dateOfBirth: form.dateOfBirth || null, maritalStatus: form.maritalStatus, gender: form.gender,
    }),
    onSuccess: () => { toast.success('Đã cập nhật hồ sơ'); setEditing(false); qc.invalidateQueries({ queryKey: ['profile'] }); qc.invalidateQueries({ queryKey: ['me-employee'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  function startEdit() {
    if (emp) setForm({ firstName: emp.firstName, lastName: emp.lastName, phone: emp.phone, address: emp.address, dateOfBirth: emp.dateOfBirth ?? '', maritalStatus: emp.maritalStatus, gender: emp.gender })
    setEditing(true)
  }

  if (isLoading || !emp) return <Card className="p-5"><div className="animate-pulse">Đang tải...</div></Card>

  return (
    <div>
      <PageHeader title="Hồ sơ cá nhân" subtitle="Thông tin nhân viên & cập nhật liên lạc"
        actions={editing ? <Button onClick={() => save.mutate()} loading={save.isPending} icon={<Save className="h-4 w-4" />}>Lưu</Button>
          : <Button variant="secondary" onClick={startEdit}>Chỉnh sửa</Button>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardBody className="flex flex-col items-center text-center">
            <Avatar name={emp.fullName} src={emp.avatarData} size="lg" className="!h-24 !w-24 !text-3xl" />
            <h2 className="mt-3 text-lg font-bold text-slate-800">{emp.fullName}</h2>
            <p className="text-sm text-slate-500">{emp.employeeCode} · {user.email}</p>
            <div className="mt-2"><StatusBadge map={EMPLOYEE_STATUS_LABEL} value={emp.status} /></div>
            <div className="mt-4 grid w-full grid-cols-2 gap-2 text-left text-sm">
              <Info icon={<Briefcase className="h-4 w-4" />} label="Vào làm" value={fmtDate(emp.hireDate)} />
              <Info icon={<Calendar className="h-4 w-4" />} label="Thâm niên" value={`${yearsOfService(emp.hireDate)} năm`} />
              <Info icon={<Briefcase className="h-4 w-4" />} label="Loại HĐ" value={CONTRACT_LABEL[emp.contractType]} />
              <Info icon={<Briefcase className="h-4 w-4" />} label="Tính chất" value={WORK_NATURE_LABEL[emp.workNature]} />
            </div>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title={editing ? 'Chỉnh sửa thông tin' : 'Thông tin chi tiết'} icon={<UserCog className="h-4 w-4" />} />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            {editing ? (
              <>
                <Input label="Họ" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
                <Input label="Tên" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
                <Input label="Điện thoại" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                <Input label="Ngày sinh" type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
                <Select label="Giới tính" value={form.gender} onChange={(e) => setForm({ ...form, gender: Number(e.target.value) as Gender })}>
                  <option value={0}>Khác</option><option value={1}>Nam</option><option value={2}>Nữ</option>
                </Select>
                <Select label="Tình trạng hôn nhân" value={form.maritalStatus} onChange={(e) => setForm({ ...form, maritalStatus: e.target.value as MaritalStatus })}>
                  {maritalOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
                <div className="sm:col-span-2"><Input label="Địa chỉ" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              </>
            ) : (
              <>
                <Info icon={<Mail className="h-4 w-4" />} label="Email" value={emp.email} />
                <Info icon={<Phone className="h-4 w-4" />} label="Điện thoại" value={emp.phone || '—'} />
                <Info icon={<Calendar className="h-4 w-4" />} label="Ngày sinh" value={emp.dateOfBirth ? fmtDate(emp.dateOfBirth) : '—'} />
                <Info icon={<UserCog className="h-4 w-4" />} label="Giới tính" value={GENDER_LABEL[emp.gender]} />
                <Info icon={<UserCog className="h-4 w-4" />} label="Hôn nhân" value={maritalOpts.find((m) => m.value === emp.maritalStatus)?.label ?? '—'} />
                <Info icon={<MapPin className="h-4 w-4" />} label="Địa chỉ" value={emp.address || '—'} />
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-slate-50 p-3">
      <span className="mt-0.5 text-slate-400">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="truncate text-sm font-medium text-slate-800">{value}</p>
      </div>
    </div>
  )
}