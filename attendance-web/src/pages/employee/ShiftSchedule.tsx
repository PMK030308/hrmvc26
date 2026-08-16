import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react'
import { attendanceApi } from '@/api/attendance'
import { fmtDate } from '@/lib/date'
import { Card, CardHeader, PageHeader, Spinner, EmptyState } from '@/components/ui'
import { cn } from '@/lib/cn'

export default function ShiftSchedulePage() {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() + 1 } })
  const { data, isLoading } = useQuery({
    queryKey: ['attendance', 'shift-schedule', cursor.year, cursor.month],
    queryFn: () => attendanceApi.shiftSchedule({ year: cursor.year, month: cursor.month }),
  })

  function shift(delta: number) {
    const d = new Date(cursor.year, cursor.month - 1 + delta, 1)
    setCursor({ year: d.getFullYear(), month: d.getMonth() + 1 })
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div>
      <PageHeader title="Bảng phân ca" subtitle="Lịch ca làm việc của bạn trong tháng"
        actions={<div className="flex items-center gap-1 rounded-lg bg-white ring-1 ring-slate-200">
          <button onClick={() => shift(-1)} className="grid h-9 w-9 place-items-center text-slate-500 hover:bg-slate-100"><ChevronLeft className="h-4 w-4" /></button>
          <span className="px-2 text-sm font-medium text-slate-700">Tháng {cursor.month}/{cursor.year}</span>
          <button onClick={() => shift(1)} className="grid h-9 w-9 place-items-center text-slate-500 hover:bg-slate-100"><ChevronRight className="h-4 w-4" /></button>
        </div>} />
      {isLoading || !data ? <Card className="p-5"><Spinner /></Card> : (
        <Card>
          <CardHeader title={`Lịch ca · Tháng ${cursor.month}/${cursor.year}`} icon={<CalendarRange className="h-4 w-4" />} />
          {data.length === 0 ? <EmptyState icon={<CalendarRange className="h-6 w-6" />} title="Chưa có phân ca" /> : (
            <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4 lg:grid-cols-7">
              {data.map((d) => {
                const isToday = d.date === today
                const color = d.shift?.color ?? undefined
                return (
                  <div key={d.date} className={cn('rounded-xl border p-3', isToday ? 'border-brand-400 bg-brand-50' : 'border-slate-100')}>
                    <p className={cn('text-xs font-semibold', isToday ? 'text-brand-700' : 'text-slate-500')}>{fmtDate(d.date, 'EEE')}</p>
                    <p className={cn('text-lg font-bold', isToday ? 'text-brand-800' : 'text-slate-800')}>{fmtDate(d.date, 'dd')}</p>
                    {d.shift ? (
                      <p className="mt-1 truncate rounded-md px-1.5 py-0.5 text-[10px] font-medium text-white" style={{ background: color }}>{d.shift.name}</p>
                    ) : <p className="mt-1 text-[10px] text-slate-300">Nghỉ</p>}
                    {d.shift && <p className="mt-1 text-[10px] text-slate-400">{d.shift.startTime.slice(0, 5)}–{d.shift.endTime.slice(0, 5)}</p>}
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}