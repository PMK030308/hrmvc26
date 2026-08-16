import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import { attendanceApi } from '@/api/attendance'
import { ATTENDANCE_STATUS_LABEL } from '@/constants/enums'
import { fmtDate } from '@/lib/date'
import { Card, CardHeader, PageHeader, Tabs, StatusBadge, Spinner, EmptyState } from '@/components/ui'

export default function TimesheetPage() {
  const [mode, setMode] = useState<'week' | 'month'>('month')
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() + 1 } })

  const { data, isLoading } = useQuery({
    queryKey: ['attendance', 'timesheet', cursor.year, cursor.month, mode],
    queryFn: () => attendanceApi.timesheet({ year: cursor.year, month: cursor.month, mode }),
  })

  function shift(delta: number) {
    if (mode === 'month') {
      const d = new Date(cursor.year, cursor.month - 1 + delta, 1)
      setCursor({ year: d.getFullYear(), month: d.getMonth() + 1 })
    } else {
      setCursor((c) => ({ ...c, month: Math.min(12, Math.max(1, c.month + delta)) }))
    }
  }

  return (
    <div>
      <PageHeader title="Bảng chấm công" subtitle="Chi tiết ngày × ca và tổng hợp"
        actions={<div className="flex items-center gap-1 rounded-lg bg-white ring-1 ring-slate-200">
          <button onClick={() => shift(-1)} className="grid h-9 w-9 place-items-center text-slate-500 hover:bg-slate-100"><ChevronLeft className="h-4 w-4" /></button>
          <span className="px-2 text-sm font-medium text-slate-700">{cursor.month}/{cursor.year}</span>
          <button onClick={() => shift(1)} className="grid h-9 w-9 place-items-center text-slate-500 hover:bg-slate-100"><ChevronRight className="h-4 w-4" /></button>
        </div>} />
      <div className="mb-5"><Tabs active={mode} onChange={(k) => setMode(k as 'week' | 'month')} tabs={[{ key: 'month', label: 'Cả tháng' }, { key: 'week', label: 'Theo tuần' }]} /></div>

      {isLoading || !data ? <Card className="p-5"><Spinner /></Card> : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <MiniStat label="Tổng công" value={data.summary.totalPaidUnits} />
            <MiniStat label="Giờ làm" value={`${Math.round(data.summary.workHours * 10) / 10}h`} />
            <MiniStat label="OT" value={`${Math.round(data.summary.totalOtHours * 10) / 10}h`} />
            <MiniStat label="Vắng/Nghỉ" value={data.summary.totalOffOrAbsent} />
          </div>
          <Card>
            <CardHeader title="Chi tiết ngày" subtitle={`${data.days.length} ngày`} icon={<Calendar className="h-4 w-4" />} />
            {data.days.every((d) => !d.record) ? <EmptyState icon={<Calendar className="h-6 w-6" />} title="Chưa có dữ liệu" /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500"><th className="px-4 py-3 font-semibold">Ngày</th><th className="px-4 py-3 font-semibold">Ca</th><th className="px-4 py-3 font-semibold">Vào</th><th className="px-4 py-3 font-semibold">Ra</th><th className="px-4 py-3 font-semibold">Giờ</th><th className="px-4 py-3 font-semibold">Muộn</th><th className="px-4 py-3 font-semibold">Sớm</th><th className="px-4 py-3 font-semibold">Trạng thái</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.days.map((d) => (
                      <tr key={d.date} className="hover:bg-slate-50">
                        <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{fmtDate(d.date, 'EEE dd/MM')}</td>
                        <td className="px-4 py-2.5 text-slate-600">{d.shift?.name ?? '—'}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-slate-700">{d.record?.checkInTime ?? '—'}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-slate-700">{d.record?.checkOutTime ?? '—'}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{d.record ? `${d.record.actualWorkHours}h` : '—'}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{d.record?.lateMinutes ? `${d.record.lateMinutes}m` : '—'}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{d.record?.earlyLeaveMinutes ? `${d.record.earlyLeaveMinutes}m` : '—'}</td>
                        <td className="px-4 py-2.5">{d.record ? <StatusBadge map={ATTENDANCE_STATUS_LABEL} value={d.record.status} /> : <span className="text-xs text-slate-400">Nghỉ</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-800">{value}</p>
    </Card>
  )
}