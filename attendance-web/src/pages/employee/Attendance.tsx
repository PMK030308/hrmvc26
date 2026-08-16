import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Calendar, MapPin, Wifi, Fingerprint, Globe, QrCode, Clock3 } from 'lucide-react'
import { attendanceApi } from '@/api/attendance'
import { PUNCH_SOURCE_LABEL, ATTENDANCE_STATUS_LABEL } from '@/constants/enums'
import { fmtDate, fmtTime, toVnDate } from '@/lib/date'
import { Card, CardHeader, CardBody, PageHeader, Tabs, StatusBadge, Badge, EmptyState, Spinner } from '@/components/ui'
import { PunchCard, FloatingPunch, Summary30 } from '@/components/attendance/widgets'
import { cn } from '@/lib/cn'
import type { PunchSource } from '@/types'

const sourceIcon: Record<PunchSource, React.ReactNode> = {
  1: <Fingerprint className="h-4 w-4" />,
  2: <MapPin className="h-4 w-4" />,
  3: <Wifi className="h-4 w-4" />,
  4: <QrCode className="h-4 w-4" />,
  5: <Globe className="h-4 w-4" />,
  99: <Clock3 className="h-4 w-4" />,
}

export default function AttendancePage() {
  const [tab, setTab] = useState('today')
  return (
    <div>
      <PageHeader title="Chấm công" subtitle="Theo dõi giờ vào/ra và lượt chấm" />
      <div className="mb-5"><Tabs active={tab} onChange={setTab} tabs={[{ key: 'today', label: 'Hôm nay' }, { key: 'month', label: 'Tháng này' }]} /></div>
      {tab === 'today' ? <TodayView /> : <MonthView />}
      <FloatingPunch />
    </div>
  )
}

function TodayView() {
  const { data, isLoading } = useQuery({ queryKey: ['attendance', 'today'], queryFn: () => attendanceApi.today() })
  if (isLoading) return <Card className="p-5"><Spinner /></Card>
  const { record, punches, shift } = data!
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="lg:col-span-1"><PunchCard /></div>
      <div className="lg:col-span-2 space-y-5">
        <Card>
          <CardHeader title="Ca làm việc hôm nay" icon={<Calendar className="h-4 w-4" />} />
          <CardBody>
            {shift ? (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <Info label="Ca" value={shift.name} />
                <Info label="Giờ làm" value={`${shift.startTime.slice(0, 5)} – ${shift.endTime.slice(0, 5)}`} />
                <Info label="Giờ vào sớm nhất" value={shift.checkInWindowFrom?.slice(0, 5) ?? '—'} />
                <Info label="Hạn check-in" value={shift.checkInWindowTo?.slice(0, 5) ?? '—'} />
                <Info label="Bắt đầu check-out" value={shift.checkOutWindowFrom?.slice(0, 5) ?? '—'} />
                <Info label="Hạn check-out" value={shift.checkOutWindowTo?.slice(0, 5) ?? '—'} />
              </div>
            ) : <EmptyState icon={<Calendar className="h-6 w-6" />} title="Hôm nay không có ca" description="Bạn không cần chấm công ngày hôm nay." />}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Tổng hợp hôm nay" icon={<Clock3 className="h-4 w-4" />} />
          <CardBody className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Info label="Giờ vào" value={record?.checkInTime ?? '—'} />
            <Info label="Giờ ra" value={record?.checkOutTime ?? '—'} />
            <Info label="Giờ làm thực" value={`${record?.actualWorkHours ?? 0}h`} />
            <Info label="OT" value={`${record?.overtimeHours ?? 0}h`} />
            <Info label="Đi muộn" value={record?.lateMinutes ? `${record.lateMinutes}m` : '0m'} />
            <Info label="Về sớm" value={record?.earlyLeaveMinutes ? `${record.earlyLeaveMinutes}m` : '0m'} />
            <div className="col-span-2"><Info label="Trạng thái" value={record ? <StatusBadge map={ATTENDANCE_STATUS_LABEL} value={record.status} /> : '—'} /></div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Lượt chấm công hôm nay" subtitle={`${punches.length} lượt`} icon={<Fingerprint className="h-4 w-4" />} />
          {punches.length === 0 ? <EmptyState icon={<Fingerprint className="h-6 w-6" />} title="Chưa chấm công" description="Bấm nút chấm để bắt đầu." /> : (
            <ol className="relative divide-y divide-slate-100">
              {punches.map((p, i) => {
                const meta = PUNCH_SOURCE_LABEL[p.source]
                return (
                  <li key={p.id} className="flex items-center gap-4 px-5 py-3.5">
                    <div className="flex flex-col items-center">
                      <span className={cn('grid h-9 w-9 place-items-center rounded-full',
                        p.isCheckIn ? 'bg-brand-50 text-brand-600' : 'bg-warning-50 text-warning-600')}>{sourceIcon[p.source]}</span>
                      {i < punches.length - 1 && <span className="mt-1 h-6 w-px bg-slate-200" />}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-800">{p.isCheckIn ? 'Chấm VÀO' : 'Chấm RA'}</p>
                      <p className="text-xs text-slate-500"><Badge tone={meta.tone}>{meta.label}</Badge> {p.wifiSsid && `· ${p.wifiSsid}`} {(p.latitude != null) && '· GPS'}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm font-semibold text-slate-800">{fmtTime(toVnDate(p.punchedAt))}</p>
                      <p className="text-[10px] text-slate-400">{fmtDate(p.punchedAt, 'dd/MM/yyyy')}</p>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </Card>
      </div>
    </div>
  )
}

function MonthView() {
  const now = new Date()
  const { data, isLoading } = useQuery({
    queryKey: ['attendance', 'timesheet', now.getFullYear(), now.getMonth() + 1, 'month'],
    queryFn: () => attendanceApi.timesheet({ year: now.getFullYear(), month: now.getMonth() + 1, mode: 'month' }),
  })
  if (isLoading || !data) return <Card className="p-5"><Spinner /></Card>
  const s = data.summary
  return (
    <div className="space-y-5">
      <Summary30 />
      <Card>
        <CardHeader title="Bảng chấm công tháng này" subtitle={`Tháng ${now.getMonth() + 1}/${now.getFullYear()}`} icon={<Calendar className="h-4 w-4" />} />
        <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
          <Info label="Tổng công" value={`${s.totalPaidUnits}`} />
          <Info label="Giờ làm" value={`${Math.round(s.workHours * 10) / 10}h`} />
          <Info label="OT" value={`${Math.round(s.totalOtHours * 10) / 10}h`} />
          <Info label="Muộn/sớm" value={`${s.lateEarlyCount}`} />
        </div>
        <div className="overflow-x-auto border-t border-slate-100">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 text-left text-xs uppercase text-slate-500"><th className="px-4 py-2 font-semibold">Ngày</th><th className="px-4 py-2 font-semibold">Ca</th><th className="px-4 py-2 font-semibold">Vào</th><th className="px-4 py-2 font-semibold">Ra</th><th className="px-4 py-2 font-semibold">Giờ</th><th className="px-4 py-2 font-semibold">Trạng thái</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.days.map((d) => (
                <tr key={d.date} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{fmtDate(d.date, 'EEE dd/MM')}</td>
                  <td className="px-4 py-2.5 text-slate-600">{d.shift?.name ?? '—'}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-slate-700">{d.record?.checkInTime ?? '—'}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-slate-700">{d.record?.checkOutTime ?? '—'}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{d.record ? `${d.record.actualWorkHours}h` : '—'}</td>
                  <td className="px-4 py-2.5">{d.record ? <StatusBadge map={ATTENDANCE_STATUS_LABEL} value={d.record.status} /> : <span className="text-xs text-slate-400">Nghỉ</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-800">{value}</p>
    </div>
  )
}