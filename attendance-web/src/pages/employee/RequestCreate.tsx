import { useMemo, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Send, CalendarDays, Clock3, Plane, RefreshCw, FileEdit } from 'lucide-react'
import { toast } from 'sonner'
import { requestsApi } from '@/api/requests'
import { REQUEST_TYPE_LABEL, DAY_CALC_LABEL, LEAVE_CATEGORY_LABEL } from '@/constants/enums'
import { workingDays, calendarDays, parseISO } from '@/lib/date'
import { PageHeader, Card, CardHeader, CardBody, Input, Select, Textarea, Button, Spinner, ProgressBar } from '@/components/ui'
import type { RequestType, LateEarlyType, AttendanceUpdateType, OvertimeCompensationType, ShiftSwapMode, LeaveType } from '@/types'

const types: RequestType[] = ['leaves', 'late-earlies', 'overtimes', 'business-trips', 'shift-swaps', 'attendance-updates']

export default function RequestCreatePage() {
  const { type = 'leaves' } = useParams<{ type: RequestType }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: catalog, isLoading } = useQuery({ queryKey: ['request', 'catalog'], queryFn: () => requestsApi.catalog() })

  const create = useMutation({
    mutationFn: (payload: any) => requestsApi.create(type, payload),
    onSuccess: (req) => {
      toast.success('Đã gửi đơn thành công')
      qc.invalidateQueries({ queryKey: ['requests', 'mine'] })
      navigate(`/employee/requests/${req.type}/${req.id}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={`Tạo đơn · ${REQUEST_TYPE_LABEL[type].label}`} subtitle="Điền thông tin và gửi để chờ duyệt" back={() => navigate(-1)} />
      {/* Type switcher */}
      <div className="mb-5 flex flex-wrap gap-2">
        {types.map((t) => (
          <Link key={t} to={`/employee/requests/${t}/new`}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${t === type ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>
            {REQUEST_TYPE_LABEL[t].label}
          </Link>
        ))}
      </div>

      {isLoading || !catalog ? <Card className="p-5"><Spinner /></Card> : (
        <FormByType type={type} catalog={catalog} submitting={create.isPending} onSubmit={(p) => create.mutate(p)} />
      )}
    </div>
  )
}

function FormByType({ type, catalog, submitting, onSubmit }: { type: RequestType; catalog: any; submitting: boolean; onSubmit: (p: any) => void }) {
  switch (type) {
    case 'leaves': return <LeaveForm catalog={catalog} submitting={submitting} onSubmit={onSubmit} />
    case 'late-earlies': return <LateEarlyForm catalog={catalog} submitting={submitting} onSubmit={onSubmit} />
    case 'overtimes': return <OvertimeForm catalog={catalog} submitting={submitting} onSubmit={onSubmit} />
    case 'business-trips': return <BusinessTripForm submitting={submitting} onSubmit={onSubmit} />
    case 'shift-swaps': return <ShiftSwapForm catalog={catalog} submitting={submitting} onSubmit={onSubmit} />
    case 'attendance-updates': return <AttendanceUpdateForm catalog={catalog} submitting={submitting} onSubmit={onSubmit} />
  }
}

/* ------------------------------- Nghỉ phép ------------------------------- */
function LeaveForm({ catalog, submitting, onSubmit }: { catalog: any; submitting: boolean; onSubmit: (p: any) => void }) {
  const [leaveTypeId, setLeaveTypeId] = useState(catalog.leaveTypes[0]?.id ?? '')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const lt: LeaveType | undefined = catalog.leaveTypes.find((l: LeaveType) => l.id === leaveTypeId)
  const days = useMemo(() => {
    if (!startDate || !endDate) return 0
    if (!lt) return 0
    if (lt.dayCalculationType === 2) return calendarDays(parseISO(startDate), parseISO(endDate))
    if (lt.dayCalculationType === 3) return 1
    return workingDays(parseISO(startDate), parseISO(endDate))
  }, [startDate, endDate, lt])

  return (
    <Card>
      <CardHeader title="Thông tin nghỉ phép" icon={<CalendarDays className="h-4 w-4" />} />
      <CardBody className="space-y-4">
        <Select label="Loại nghỉ" value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)}>
          {catalog.leaveTypes.map((l: LeaveType) => <option key={l.id} value={l.id}>{l.name} — {LEAVE_CATEGORY_LABEL[l.category].label}</option>)}
        </Select>
        {lt && (
          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            <p>Cách tính: <b>{DAY_CALC_LABEL[lt.dayCalculationType]}</b>{lt.maxDays != null && ` · Tối đa ${lt.maxDays} ngày`}</p>
            <p>Yêu cầu minh chứng: <b>{lt.requireAttachment ? 'Có' : 'Không'}</b> · Yêu cầu lý do: <b>{lt.requireReason ? 'Có' : 'Không'}</b></p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Input label="Từ ngày" type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); if (!endDate || e.target.value > endDate) setEndDate(e.target.value) }} />
          <Input label="Đến ngày" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        {startDate && endDate && <p className="text-sm text-slate-600">Số ngày nghỉ: <b className="text-brand-700">{days} ngày</b></p>}
        <Textarea label="Lý do" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Nêu lý do nghỉ phép..." />
        <Button onClick={() => onSubmit({ leaveTypeId, startDate, endDate, totalDays: days, reason })} loading={submitting} className="w-full" icon={<Send className="h-4 w-4" />}>
          Gửi đơn nghỉ ({days} ngày)
        </Button>
      </CardBody>
    </Card>
  )
}

/* ----------------------------- Muộn / Về sớm ----------------------------- */
function LateEarlyForm({ catalog, submitting, onSubmit }: { catalog: any; submitting: boolean; onSubmit: (p: any) => void }) {
  const [requestDate, setRequestDate] = useState('')
  const [lateEarlyType, setLateEarlyType] = useState<LateEarlyType>(1)
  const [requestedTime, setRequestedTime] = useState('08:30')
  const [minutes, setMinutes] = useState(30)
  const [reason, setReason] = useState('')
  return (
    <Card>
      <CardHeader title="Đăng ký đi muộn / về sớm" icon={<Clock3 className="h-4 w-4" />} />
      <CardBody className="space-y-4">
        <Input label="Ngày" type="date" value={requestDate} onChange={(e) => setRequestDate(e.target.value)} />
        <Select label="Loại" value={lateEarlyType} onChange={(e) => setLateEarlyType(Number(e.target.value) as LateEarlyType)}>
          {catalog.lateEarlyTypes.map((t: any) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Giờ mong muốn" type="time" value={requestedTime} onChange={(e) => setRequestedTime(e.target.value)} />
          <Input label="Số phút" type="number" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
        </div>
        <Textarea label="Lý do" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button onClick={() => onSubmit({ requestDate, lateEarlyType, requestedTime, minutes, reason })} loading={submitting} className="w-full" icon={<Send className="h-4 w-4" />}>Gửi đơn</Button>
      </CardBody>
    </Card>
  )
}

/* -------------------------------- Làm thêm ------------------------------- */
function OvertimeForm({ catalog, submitting, onSubmit }: { catalog: any; submitting: boolean; onSubmit: (p: any) => void }) {
  const [otDate, setOtDate] = useState('')
  const [startTime, setStartTime] = useState('18:00')
  const [endTime, setEndTime] = useState('20:00')
  const [compensationType, setCompensationType] = useState<OvertimeCompensationType>(1)
  const [reason, setReason] = useState('')
  const hours = useMemo(() => {
    const [sh, sm] = startTime.split(':').map(Number)
    const [eh, em] = endTime.split(':').map(Number)
    let m = (eh * 60 + em) - (sh * 60 + sm); if (m < 0) m += 1440
    return Math.round((m / 60) * 100) / 100
  }, [startTime, endTime])
  const { data: usage } = useQuery({
    queryKey: ['request', 'ot-usage', otDate],
    queryFn: () => requestsApi.otUsage(otDate),
    enabled: !!otDate,
  })
  const monthProj = Math.round(((usage?.monthUsed ?? 0) + hours) * 100) / 100
  const yearProj = Math.round(((usage?.yearUsed ?? 0) + hours) * 100) / 100
  const overMonth = !!usage && monthProj > usage.monthCap
  const overYear = !!usage && yearProj > usage.yearCap
  const overCap = overMonth || overYear
  return (
    <Card>
      <CardHeader title="Đăng ký làm thêm (OT)" icon={<Clock3 className="h-4 w-4" />} />
      <CardBody className="space-y-4">
        <Input label="Ngày" type="date" value={otDate} onChange={(e) => setOtDate(e.target.value)} />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Giờ bắt đầu" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          <Input label="Giờ kết thúc" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </div>
        <p className="text-sm text-slate-600">Tổng giờ OT: <b className="text-brand-700">{hours}h</b>{hours > 4 && <span className="ml-2 text-xs text-warning-600">→ cần duyệt thêm HR</span>}</p>
        {usage && (
          <div className="space-y-3 rounded-lg bg-slate-50 p-3 text-xs">
            <div>
              <div className="mb-1 flex items-center justify-between text-slate-600">
                <span>OT tháng (theo luật: tối đa {usage.monthCap}h)</span>
                <span className={overMonth ? 'font-semibold text-danger-600' : 'text-slate-700'}>{usage.monthUsed}h + {hours}h = {monthProj}h</span>
              </div>
              <ProgressBar value={Math.min(100, (monthProj / usage.monthCap) * 100)} tone={overMonth ? 'danger' : monthProj / usage.monthCap > 0.8 ? 'warning' : 'success'} />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-slate-600">
                <span>OT năm (tối đa {usage.yearCap}h)</span>
                <span className={overYear ? 'font-semibold text-danger-600' : 'text-slate-700'}>{usage.yearUsed}h + {hours}h = {yearProj}h</span>
              </div>
              <ProgressBar value={Math.min(100, (yearProj / usage.yearCap) * 100)} tone={overYear ? 'danger' : 'success'} />
            </div>
            {overCap && <p className="font-medium text-danger-600">Vượt hạn mức OT theo luật — không thể gửi đơn. Vui lòng giảm giờ hoặc chọn ngày khác.</p>}
          </div>
        )}
        <Select label="Hình thức bồi thường" value={compensationType} onChange={(e) => setCompensationType(Number(e.target.value) as OvertimeCompensationType)}>
          {catalog.compensationTypes.map((t: any) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
        <Textarea label="Lý do" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button onClick={() => onSubmit({ otDate, startTime, endTime, totalHours: hours, compensationType, reason })}
          loading={submitting} disabled={!otDate || overCap} className="w-full" icon={<Send className="h-4 w-4" />}>Gửi đơn OT ({hours}h)</Button>
      </CardBody>
    </Card>
  )
}

/* -------------------------------- Công tác -------------------------------- */
function BusinessTripForm({ submitting, onSubmit }: { submitting: boolean; onSubmit: (p: any) => void }) {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [location, setLocation] = useState('')
  const [purpose, setPurpose] = useState('')
  const days = useMemo(() => startDate && endDate ? workingDays(parseISO(startDate), parseISO(endDate)) : 0, [startDate, endDate])
  return (
    <Card>
      <CardHeader title="Đăng ký công tác" icon={<Plane className="h-4 w-4" />} />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Input label="Từ ngày" type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); if (!endDate || e.target.value > endDate) setEndDate(e.target.value) }} />
          <Input label="Đến ngày" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <Input label="Địa điểm" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="VD: Hà Nội" />
        <Textarea label="Mục đích" rows={3} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        <p className="text-sm text-slate-600">Số ngày công tác (ngày làm việc): <b className="text-brand-700">{days}</b>{days > 2 && <span className="ml-2 text-xs text-warning-600">→ cần duyệt thêm Trưởng phòng</span>}</p>
        <Button onClick={() => onSubmit({ startDate, endDate, totalDays: days, location, purpose })} loading={submitting} className="w-full" icon={<Send className="h-4 w-4" />}>Gửi đơn công tác</Button>
      </CardBody>
    </Card>
  )
}

/* ------------------------------- Đổi ca ------------------------------- */
function ShiftSwapForm({ catalog, submitting, onSubmit }: { catalog: any; submitting: boolean; onSubmit: (p: any) => void }) {
  const [requestedDate, setRequestedDate] = useState('')
  const [shiftSwapMode, setShiftSwapMode] = useState<ShiftSwapMode>(1)
  const [partnerId, setPartnerId] = useState('')
  const [reason, setReason] = useState('')
  return (
    <Card>
      <CardHeader title="Đổi ca làm việc" icon={<RefreshCw className="h-4 w-4" />} />
      <CardBody className="space-y-4">
        <Input label="Ngày muốn đổi ca" type="date" value={requestedDate} onChange={(e) => setRequestedDate(e.target.value)} />
        <Select label="Hình thức" value={shiftSwapMode} onChange={(e) => setShiftSwapMode(Number(e.target.value) as ShiftSwapMode)}>
          {catalog.shiftSwapModes.map((m: any) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </Select>
        {shiftSwapMode === 2 && (
          <Select label="Đồng nghiệp đổi cùng" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
            <option value="">-- Chọn --</option>
            {catalog.swapPartners.map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
          </Select>
        )}
        {shiftSwapMode === 2 && <p className="rounded-lg bg-info-50 px-3 py-2 text-xs text-info-700">Đồng nghiệp sẽ cần xác nhận đồng ý trước khi đơn vào quy trình duyệt.</p>}
        <Textarea label="Lý do" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button onClick={() => onSubmit({ requestedDate, shiftSwapMode, suggestedSwapPartnerId: shiftSwapMode === 2 ? partnerId || null : null, reason })}
          loading={submitting} disabled={shiftSwapMode === 2 && !partnerId} className="w-full" icon={<Send className="h-4 w-4" />}>Gửi đơn đổi ca</Button>
      </CardBody>
    </Card>
  )
}

/* --------------------------- Cập nhật công --------------------------- */
function AttendanceUpdateForm({ catalog, submitting, onSubmit }: { catalog: any; submitting: boolean; onSubmit: (p: any) => void }) {
  const [requestDate, setRequestDate] = useState('')
  const [updateType, setUpdateType] = useState<AttendanceUpdateType>(1)
  const [newCheckInTime, setNewCheckInTime] = useState('')
  const [newCheckOutTime, setNewCheckOutTime] = useState('')
  const [newWorkHours, setNewWorkHours] = useState<number | ''>('')
  const [reason, setReason] = useState('')
  return (
    <Card>
      <CardHeader title="Yêu cầu cập nhật công" icon={<FileEdit className="h-4 w-4" />} />
      <CardBody className="space-y-4">
        <Input label="Ngày" type="date" value={requestDate} onChange={(e) => setRequestDate(e.target.value)} />
        <Select label="Loại cập nhật" value={updateType} onChange={(e) => setUpdateType(Number(e.target.value) as AttendanceUpdateType)}>
          {catalog.attendanceUpdateTypes.map((t: any) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
        {updateType !== 3 && (
          <div className="grid grid-cols-2 gap-4">
            {updateType !== 2 && <Input label="Giờ vào mới" type="time" value={newCheckInTime} onChange={(e) => setNewCheckInTime(e.target.value)} />}
            {updateType !== 2 && <Input label="Giờ ra mới" type="time" value={newCheckOutTime} onChange={(e) => setNewCheckOutTime(e.target.value)} />}
            {updateType === 2 && (
              <>
                <Input label="Giờ vào mới" type="time" value={newCheckInTime} onChange={(e) => setNewCheckInTime(e.target.value)} />
                <Input label="Giờ ra mới" type="time" value={newCheckOutTime} onChange={(e) => setNewCheckOutTime(e.target.value)} />
              </>
            )}
          </div>
        )}
        {updateType === 1 && <Input label="Giờ làm (tùy chọn)" type="number" value={newWorkHours} onChange={(e) => setNewWorkHours(e.target.value === '' ? '' : Number(e.target.value))} />}
        <Textarea label="Lý do" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button onClick={() => onSubmit({ requestDate, updateType, newCheckInTime: newCheckInTime || null, newCheckOutTime: newCheckOutTime || null, newWorkHours: newWorkHours === '' ? null : newWorkHours, reason })}
          loading={submitting} className="w-full" icon={<Send className="h-4 w-4" />}>Gửi đơn cập nhật</Button>
      </CardBody>
    </Card>
  )
}