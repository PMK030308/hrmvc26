import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { Settings, CalendarDays, Save, Wifi, MapPin, Network, ShieldCheck, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { regulationsApi } from '@/api/config'
import { LIVENESS_LABEL, LEAVE_CATEGORY_LABEL, LEAVE_FUND_LABEL, DAY_CALC_LABEL, PUNCH_SOURCE_LABEL } from '@/constants/enums'
import { PageHeader, Card, CardHeader, CardBody, Spinner, EmptyState, Tabs, Button, Select, Input, Badge, Modal } from '@/components/ui'
import type { AttendanceRegulation, LeaveType, PunchSource } from '@/types'

export default function AdminRegulations() {
  const { tab = 'attendance' } = useParams<{ tab?: string }>()
  const [active, setActive] = useState(tab === 'leave' ? 'leave' : 'attendance')
  return (
    <div>
      <PageHeader title="Quy định" subtitle="Cấu hình quy chế chấm công & loại nghỉ phép" />
      <Tabs active={active} onChange={setActive} tabs={[{ key: 'attendance', label: 'Chấm công' }, { key: 'leave', label: 'Loại nghỉ phép' }]} />
      <div className="mt-5">{active === 'attendance' ? <AttendanceReg /> : <LeaveTypesReg />}</div>
    </div>
  )
}

function AttendanceReg() {
  const qc = useQueryClient()
  const { data: reg, isLoading } = useQuery({ queryKey: ['regulation', 'attendance'], queryFn: () => regulationsApi.attendance() })
  const [draft, setDraft] = useState<AttendanceRegulation | null>(null)
  const cur = draft ?? reg ?? null

  const save = useMutation({
    mutationFn: (p: Partial<AttendanceRegulation>) => regulationsApi.updateAttendance(p),
    onSuccess: () => { toast.success('Đã lưu quy định'); setDraft(null); qc.invalidateQueries({ queryKey: ['regulation', 'attendance'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  if (isLoading) return <Card className="p-5"><Spinner /></Card>
  if (!cur) return <Card><EmptyState icon={<Settings className="h-6 w-6" />} title="Không tải được quy định" /></Card>

  const set = (k: keyof AttendanceRegulation, v: any) => setDraft({ ...(draft ?? reg!), [k]: v })
  const toggle = (k: keyof AttendanceRegulation) => set(k, !(draft ?? reg!)[k])

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Card>
          <CardHeader title="Phương thức chấm công" subtitle="Bật/tắt các nguồn chấm" icon={<Settings className="h-4 w-4" />} />
          <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Toggle label="Khuôn mặt" checked={cur.enablePunchFace} onChange={() => toggle('enablePunchFace')} />
            <Toggle label="GPS" checked={cur.enablePunchGps} onChange={() => toggle('enablePunchGps')} />
            <Toggle label="Wi-Fi" checked={cur.enablePunchWifi} onChange={() => toggle('enablePunchWifi')} />
            <Toggle label="IP" checked={cur.enablePunchIp} onChange={() => toggle('enablePunchIp')} />
            <Toggle label="QR Code" checked={cur.enablePunchQr} onChange={() => toggle('enablePunchQr')} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Liveness & dự phòng" icon={<ShieldCheck className="h-4 w-4" />} />
          <CardBody className="space-y-4">
            <Toggle label="Yêu cầu kiểm tra sống (liveness)" checked={cur.requireLivenessCheck} onChange={() => toggle('requireLivenessCheck')} />
            <Select label="Mức độ nghiêm ngặt liveness" value={cur.livenessStrictness} onChange={(e) => set('livenessStrictness', Number(e.target.value))}>
              {Object.entries(LIVENESS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select label="Phương thức dự phòng khi liveness thất bại" value={cur.alternativePunchMethod ?? ''} onChange={(e) => set('alternativePunchMethod', e.target.value ? (Number(e.target.value) as PunchSource) : null)}>
              <option value="">— Không —</option>
              {Object.entries(PUNCH_SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Quyền nhân viên" icon={<Settings className="h-4 w-4" />} />
          <CardBody className="space-y-3">
            <Toggle label="Cho phép NV tự theo dõi giờ làm" checked={cur.canEmployeeTrackWorkHours} onChange={() => toggle('canEmployeeTrackWorkHours')} />
            <Toggle label="Cho phép NV tự đăng ký ca" checked={cur.allowEmployeeShiftRegistration} onChange={() => toggle('allowEmployeeShiftRegistration')} />
            <Toggle label="Cho phép NV xem bảng công ngày" checked={cur.allowEmployeeViewDetailTimesheetDaily} onChange={() => toggle('allowEmployeeViewDetailTimesheetDaily')} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Tăng ca & chống trùng" subtitle="Theo Bộ luật Lao động 2019 (Điều 98, 107, 55)" icon={<Clock className="h-4 w-4" />} />
          <CardBody className="grid grid-cols-2 gap-3">
            <Input label="Cửa sổ chống trùng (giây)" type="number" value={cur.duplicateWindowSeconds} onChange={(e) => set('duplicateWindowSeconds', Number(e.target.value))} />
            <Input label="Số giờ chuẩn / tháng" type="number" value={cur.standardMonthlyHours} onChange={(e) => set('standardMonthlyHours', Number(e.target.value))} />
            <Input label="Giới hạn OT / tháng (h)" type="number" value={cur.otMonthlyCapHours} onChange={(e) => set('otMonthlyCapHours', Number(e.target.value))} />
            <Input label="Giới hạn OT / năm (h)" type="number" value={cur.otYearlyCapHours} onChange={(e) => set('otYearlyCapHours', Number(e.target.value))} />
            <Input label="Hệ số OT ngày thường (×)" type="number" step="0.1" value={cur.weekdayOtCoeff} onChange={(e) => set('weekdayOtCoeff', Number(e.target.value))} />
            <Input label="Hệ số OT cuối tuần (×)" type="number" step="0.1" value={cur.weekendOtCoeff} onChange={(e) => set('weekendOtCoeff', Number(e.target.value))} />
            <Input label="Hệ số OT lễ tết (×)" type="number" step="0.1" value={cur.holidayOtCoeff} onChange={(e) => set('holidayOtCoeff', Number(e.target.value))} />
            <Input label="Hệ số giờ đêm (×)" type="number" step="0.1" value={cur.nightCoeff} onChange={(e) => set('nightCoeff', Number(e.target.value))} />
            <Input label="Phụ cấp OT đêm thêm (×)" type="number" step="0.1" value={cur.nightOtExtra} onChange={(e) => set('nightOtExtra', Number(e.target.value))} />
            <p className="col-span-2 text-xs text-slate-400">Mặc định: 1.5x (ngày thường) · 2x (T7/CN) · 3x (lễ tết) · phụ cấp đêm +30% · OT đêm +20%. Cap 40h/tháng, 200h/năm.</p>
          </CardBody>
        </Card>

        <Button icon={<Save className="h-4 w-4" />} loading={save.isPending} onClick={() => save.mutate(draft ?? {})}>Lưu quy định</Button>
      </div>

      <div className="space-y-5">
        <CatalogCard title="Danh bạ GPS" icon={<MapPin className="h-4 w-4" />} items={cur.gpsCatalog.map((g) => `${g.name} · bán kính ${g.radiusMeters}m`)} />
        <CatalogCard title="Danh bạ Wi-Fi" icon={<Wifi className="h-4 w-4" />} items={cur.wifiCatalog.map((w) => w.ssid)} />
        <CatalogCard title="Danh bạ IP" icon={<Network className="h-4 w-4" />} items={cur.ipCatalog.map((i) => `${i.ipAddress}/${i.subnetBits}`)} />
      </div>
    </div>
  )
}

function CatalogCard({ title, icon, items }: { title: string; icon: React.ReactNode; items: string[] }) {
  return (
    <Card>
      <CardHeader title={title} icon={icon} action={<Badge tone="muted">{items.length}</Badge>} />
      {items.length === 0 ? <CardBody><p className="text-sm text-slate-400">Chưa có mục.</p></CardBody> : (
        <ul className="divide-y divide-slate-100">{items.map((it, i) => <li key={i} className="px-5 py-2.5 text-sm text-slate-700">{it}</li>)}</ul>
      )}
    </Card>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
      <span>{label}</span>
      <button type="button" onClick={onChange} className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-brand-600' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </label>
  )
}

function LeaveTypesReg() {
  const qc = useQueryClient()
  const { data: types, isLoading } = useQuery({ queryKey: ['regulation', 'leaveTypes'], queryFn: () => regulationsApi.leaveTypes() })
  const [edit, setEdit] = useState<LeaveType | null>(null)
  const save = useMutation({
    mutationFn: (p: Partial<LeaveType>) => regulationsApi.updateLeaveType(edit!.id, p),
    onSuccess: () => { toast.success('Đã cập nhật loại nghỉ'); setEdit(null); qc.invalidateQueries({ queryKey: ['regulation', 'leaveTypes'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  if (isLoading) return <Card className="p-5"><Spinner /></Card>
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {(types ?? []).map((t) => (
        <Card key={t.id}>
          <CardHeader title={t.name} subtitle={LEAVE_CATEGORY_LABEL[t.category].label} icon={<CalendarDays className="h-4 w-4" />} action={
            <Button size="sm" variant="secondary" onClick={() => setEdit(t)}>Sửa</Button>
          } />
          <CardBody className="space-y-1.5 text-sm">
            <Row k="Quỹ phép" v={LEAVE_FUND_LABEL[t.fundType]} />
            <Row k="Cách tính" v={DAY_CALC_LABEL[t.dayCalculationType]} />
            <Row k="Tối đa" v={t.maxDays != null ? `${t.maxDays} ngày` : 'Không giới hạn'} />
            <Row k="Minh chứng" v={t.requireAttachment ? 'Bắt buộc' : 'Không'} />
            <Row k="Lý do" v={t.requireReason ? 'Bắt buộc' : 'Không'} />
          </CardBody>
        </Card>
      ))}

      <Modal open={!!edit} onClose={() => setEdit(null)} size="lg" title={edit ? `Sửa: ${edit.name}` : ''}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Hủy</Button><Button loading={save.isPending} onClick={() => edit && save.mutate(edit)}>Lưu</Button></>}>
        {edit && (
          <div className="grid grid-cols-2 gap-4">
            <Input label="Tên loại nghỉ" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <Select label="Nhóm" value={edit.category} onChange={(e) => setEdit({ ...edit, category: Number(e.target.value) as any })}>
              {Object.entries(LEAVE_CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
            <Select label="Quỹ phép" value={edit.fundType} onChange={(e) => setEdit({ ...edit, fundType: Number(e.target.value) as any })}>
              {Object.entries(LEAVE_FUND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select label="Cách tính ngày" value={edit.dayCalculationType} onChange={(e) => setEdit({ ...edit, dayCalculationType: Number(e.target.value) as any })}>
              {Object.entries(DAY_CALC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Input label="Số ngày tối đa (để trống = không giới hạn)" type="number" value={edit.maxDays ?? ''} onChange={(e) => setEdit({ ...edit, maxDays: e.target.value === '' ? null : Number(e.target.value) })} />
            <div className="flex items-center gap-6 self-end pb-2">
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={edit.requireAttachment} onChange={(e) => setEdit({ ...edit, requireAttachment: e.target.checked })} /> Cần minh chứng</label>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={edit.requireReason} onChange={(e) => setEdit({ ...edit, requireReason: e.target.checked })} /> Cần lý do</label>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between"><span className="text-slate-500">{k}</span><span className="font-medium text-slate-700">{v}</span></div>
}