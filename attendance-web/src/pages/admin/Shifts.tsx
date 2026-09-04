import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock, Plus, Pencil, Trash2, Moon } from 'lucide-react'
import { toast } from 'sonner'
import { shiftsApi } from '@/api/shifts'
import { PageHeader, Card, CardHeader, Spinner, EmptyState, Button, Modal, Input, Select, ConfirmDialog, Badge } from '@/components/ui'
import type { Shift } from '@/types'
import { usePermissions } from '@/hooks/usePermissions'

const blank: Partial<Shift> = {
  code: '', name: '', startTime: '08:00', endTime: '17:00', breakStartTime: '', breakEndTime: '',
  checkInWindowFrom: '', checkInWindowTo: '', checkOutWindowFrom: '', checkOutWindowTo: '',
  latePunishmentEnabled: false, latePunishmentTimes: 3, latePunishmentMinutesEach: 30,
  workDays: 1, isOvernight: false, status: 1, holidayCoefficient: 1.5, color: '#3366ff',
}
const toSec = (t: string) => t ? (t.length === 5 ? `${t}:00` : t) : null

export default function AdminShifts() {
  const { hasPermission } = usePermissions()
  const canManage = hasPermission('shifts.catalog.manage')
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Partial<Shift> | null>(null)
  const [errors, setErrors] = useState<Partial<Record<keyof Shift, string>>>({})
  const [del, setDel] = useState<Shift | null>(null)
  const { data: shifts, isLoading } = useQuery({ queryKey: ['shifts', 'list'], queryFn: () => shiftsApi.list() })

  function validate(s: Partial<Shift>): Partial<Record<keyof Shift, string>> {
    const e: Partial<Record<keyof Shift, string>> = {}
    if (!s.code || !s.code.trim()) e.code = 'Vui lòng nhập mã ca.'
    if (!s.name || !s.name.trim()) e.name = 'Vui lòng nhập tên ca.'
    if (!s.startTime) e.startTime = 'Vui lòng nhập giờ bắt đầu.'
    if (!s.endTime) e.endTime = 'Vui lòng nhập giờ kết thúc.'
    if (s.startTime && s.endTime && !s.isOvernight && s.startTime >= s.endTime) {
      e.endTime = 'Giờ kết thúc phải sau giờ bắt đầu (hoặc bật ca qua đêm).'
    }
    return e
  }

  const save = useMutation({
    mutationFn: (s: Partial<Shift>) => {
      const e = validate(s)
      setErrors(e)
      if (Object.keys(e).length) throw new Error(Object.values(e).join(' · '))
      const p: Partial<Shift> = {
        ...s,
        startTime: toSec(s.startTime ?? '') ?? '08:00:00', endTime: toSec(s.endTime ?? '') ?? '17:00:00',
        breakStartTime: toSec(s.breakStartTime ?? ''), breakEndTime: toSec(s.breakEndTime ?? ''),
        checkInWindowFrom: toSec(s.checkInWindowFrom ?? ''), checkInWindowTo: toSec(s.checkInWindowTo ?? ''),
        checkOutWindowFrom: toSec(s.checkOutWindowFrom ?? ''), checkOutWindowTo: toSec(s.checkOutWindowTo ?? ''),
      }
      return editing?.id ? shiftsApi.update(editing.id, p) : shiftsApi.create(p)
    },
    onSuccess: () => { toast.success(editing?.id ? 'Đã cập nhật ca' : 'Đã tạo ca'); setEditing(null); setErrors({}); qc.invalidateQueries({ queryKey: ['shifts'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => shiftsApi.delete(id),
    onSuccess: () => { toast.success('Đã xóa ca'); setDel(null); qc.invalidateQueries({ queryKey: ['shifts'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div>
      <PageHeader title="Ca làm việc" subtitle="Định nghĩa ca & cửa sổ chấm công" actions={canManage ?
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => { setErrors({}); setEditing({ ...blank }) }}>Thêm ca</Button>
      : undefined} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading ? <Card className="p-5 sm:col-span-2 lg:col-span-3"><Spinner /></Card>
          : (shifts ?? []).length === 0 ? <Card className="sm:col-span-2 lg:col-span-3"><EmptyState icon={<Clock className="h-6 w-6" />} title="Chưa có ca nào" /></Card>
          : shifts!.map((s) => (
            <Card key={s.id} className="overflow-hidden">
              <div className="h-1.5" style={{ background: s.color }} />
              <CardHeader title={s.name} subtitle={s.code} icon={<Clock className="h-4 w-4" />} action={canManage ?
                <div className="flex gap-1">
                  <button onClick={() => { setErrors({}); setEditing(s) }} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => setDel(s)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-danger-50 hover:text-danger-600"><Trash2 className="h-4 w-4" /></button>
                </div> : undefined
              } />
              <div className="space-y-2 p-5 text-sm">
                <div className="flex items-center justify-between"><span className="text-slate-500">Giờ làm</span><span className="font-mono font-semibold text-slate-800">{s.startTime.slice(0, 5)} – {s.endTime.slice(0, 5)}</span></div>
                {s.breakStartTime && <div className="flex items-center justify-between"><span className="text-slate-500">Nghỉ trưa</span><span className="font-mono text-slate-700">{s.breakStartTime.slice(0, 5)} – {s.breakEndTime?.slice(0, 5)}</span></div>}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {s.isOvernight && <Badge tone="info" dot><Moon className="h-3 w-3" /> Ca qua đêm</Badge>}
                  {s.latePunishmentEnabled && <Badge tone="warning" dot>Phạt muộn</Badge>}
                  <Badge tone={s.status === 1 ? 'success' : 'muted'}>{s.status === 1 ? 'Đang dùng' : 'Ngưng'}</Badge>
                  <Badge tone="brand">Hệ số lễ: {s.holidayCoefficient}</Badge>
                </div>
              </div>
            </Card>
          ))}
      </div>

      <Modal open={canManage && !!editing} onClose={() => { setEditing(null); setErrors({}) }} size="lg"
        title={editing?.id ? 'Sửa ca' : 'Thêm ca'}
        footer={<><Button variant="secondary" onClick={() => { setEditing(null); setErrors({}) }}>Hủy</Button><Button loading={save.isPending} onClick={() => save.mutate(editing!)}>Lưu</Button></>}>
        {editing && <ShiftForm value={editing} onChange={setEditing} errors={errors} />}
      </Modal>

      <ConfirmDialog open={canManage && !!del} onClose={() => setDel(null)} danger title="Xóa ca"
        message={`Xóa ca "${del?.name}"? Phân ca liên quan cũng sẽ bị xóa.`} confirmText="Xóa"
        onConfirm={() => del && remove.mutate(del.id)} />
    </div>
  )
}

function ShiftForm({ value, onChange, errors }: { value: Partial<Shift>; onChange: (v: Partial<Shift>) => void; errors?: Partial<Record<keyof Shift, string>> }) {
  const set = (k: keyof Shift, v: any) => onChange({ ...value, [k]: v })
  const t = (v: string | null | undefined) => (v ?? '').slice(0, 5)
  return (
    <div className="grid grid-cols-2 gap-4">
      <Input label="Tên ca" value={value.name ?? ''} error={errors?.name} onChange={(e) => set('name', e.target.value)} />
      <Input label="Mã ca" value={value.code ?? ''} error={errors?.code} onChange={(e) => set('code', e.target.value)} />
      <Input label="Giờ bắt đầu" type="time" value={t(value.startTime)} error={errors?.startTime} onChange={(e) => set('startTime', e.target.value)} />
      <Input label="Giờ kết thúc" type="time" value={t(value.endTime)} error={errors?.endTime} onChange={(e) => set('endTime', e.target.value)} />
      <Input label="Nghỉ từ" type="time" value={t(value.breakStartTime)} onChange={(e) => set('breakStartTime', e.target.value)} />
      <Input label="Nghỉ đến" type="time" value={t(value.breakEndTime)} onChange={(e) => set('breakEndTime', e.target.value)} />
      <Input label="Chấm vào từ" type="time" value={t(value.checkInWindowFrom)} onChange={(e) => set('checkInWindowFrom', e.target.value)} />
      <Input label="Chấm vào đến" type="time" value={t(value.checkInWindowTo)} onChange={(e) => set('checkInWindowTo', e.target.value)} />
      <Input label="Chấm ra từ" type="time" value={t(value.checkOutWindowFrom)} onChange={(e) => set('checkOutWindowFrom', e.target.value)} />
      <Input label="Chấm ra đến" type="time" value={t(value.checkOutWindowTo)} onChange={(e) => set('checkOutWindowTo', e.target.value)} />
      <Input label="Hệ số ngày lễ" type="number" step="0.1" value={value.holidayCoefficient ?? 1} onChange={(e) => set('holidayCoefficient', Number(e.target.value))} />
      <Input label="Số công (1=ngày, 0.5=nửa)" type="number" step="0.5" value={value.workDays ?? 1} onChange={(e) => set('workDays', Number(e.target.value))} />
      <Select label="Trạng thái" value={value.status ?? 1} onChange={(e) => set('status', Number(e.target.value))}>
        <option value={1}>Đang dùng</option><option value={0}>Ngưng</option>
      </Select>
      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={!!value.isOvernight} onChange={(e) => set('isOvernight', e.target.checked)} /> Ca qua đêm</label>
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={!!value.latePunishmentEnabled} onChange={(e) => set('latePunishmentEnabled', e.target.checked)} /> Phạt đi muộn</label>
      </div>
      {value.latePunishmentEnabled && (
        <div className="col-span-2 grid grid-cols-2 gap-4">
          <Input label="Số lần cho phép" type="number" value={value.latePunishmentTimes ?? 0} onChange={(e) => set('latePunishmentTimes', Number(e.target.value))} />
          <Input label="Phạt mỗi (phút)" type="number" value={value.latePunishmentMinutesEach ?? 0} onChange={(e) => set('latePunishmentMinutesEach', Number(e.target.value))} />
        </div>
      )}
      <div className="col-span-2 flex items-center gap-3"><label className="text-sm text-slate-700">Màu nhận diện</label><input type="color" value={value.color ?? '#3366ff'} onChange={(e) => set('color', e.target.value)} className="h-9 w-14 rounded border border-slate-300" /></div>
    </div>
  )
}
