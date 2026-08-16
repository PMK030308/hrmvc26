import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Table2 } from 'lucide-react'
import { timesheetApi } from '@/api/timesheet'
import { orgApi } from '@/api/org'
import { ATTENDANCE_STATUS_LABEL } from '@/constants/enums'
import { PageHeader, Card, CardHeader, Spinner, EmptyState, Badge } from '@/components/ui'
import { PeriodPicker } from '@/components/admin/widgets'
import type { AttendanceRecord } from '@/types'
import { cn } from '@/lib/cn'

const cellTone: Record<number, string> = {
  1: 'bg-success-100 text-success-700', 2: 'bg-warning-100 text-warning-700', 3: 'bg-warning-100 text-warning-700',
  4: 'bg-danger-100 text-danger-700', 5: 'bg-brand-100 text-brand-700', 6: 'bg-info-100 text-info-700',
}

export default function AdminTimesheet() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [half, setHalf] = useState<1 | 2>((now.getDate() <= 15 ? 1 : 2))
  const [dept, setDept] = useState('')

  const { data: departments } = useQuery({ queryKey: ['org', 'departments'], queryFn: () => orgApi.departments() })
  const { data, isLoading } = useQuery({
    queryKey: ['timesheet', 'detailed', year, month, half, dept],
    queryFn: () => timesheetApi.detailed({ year, month, half, departmentId: dept || undefined }),
  })

  const days = data?.days ?? []
  const employees = data?.employees ?? []

  return (
    <div>
      <PageHeader title="Bảng công chi tiết" subtitle="Chấm công nhân viên theo ngày (nửa tháng)" />
      <Card className="mb-5 p-4">
        <PeriodPicker year={year} month={month} half={half} onYear={setYear} onMonth={setMonth} onHalf={setHalf}
          departments={departments} departmentId={dept} onDepartment={setDept} />
      </Card>

      <Card>
        <CardHeader title={`${days.length} ngày · ${employees.length} nhân viên`} icon={<Table2 className="h-4 w-4" />} action={<Legend />} />
        {isLoading ? <div className="p-5"><Spinner /></div> : employees.length === 0 ? <EmptyState icon={<Table2 className="h-6 w-6" />} title="Không có dữ liệu" /> : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50">
                  <th className="sticky left-0 z-10 bg-slate-50 px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">Nhân viên</th>
                  {days.map((d) => { const day = Number(d.slice(8, 10)); const wk = [0, 6].includes(new Date(d).getDay()); return <th key={d} className={cn('px-1 py-2 text-center text-xs font-medium', wk ? 'text-danger-500' : 'text-slate-400')}>{day}</th> })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {employees.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2 whitespace-nowrap">
                      <p className="font-medium text-slate-800">{e.fullName}</p><p className="text-xs text-slate-400">{e.employeeCode}</p>
                    </td>
                    {days.map((d) => {
                      const rec = data?.rows[e.id]?.[d] ?? null
                      return <td key={d} className="px-1 py-1.5 text-center">{renderCell(rec)}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function renderCell(rec: AttendanceRecord | null) {
  if (!rec) return <span className="text-slate-300">·</span>
  if (rec.status === 4) return <span className={cn('inline-block rounded px-1.5 py-0.5 text-[10px] font-bold', cellTone[4])} title="Vắng mặt">V</span>
  return (
    <span className={cn('inline-flex flex-col items-center rounded px-1 py-0.5 text-[9px] leading-tight', cellTone[rec.status] ?? 'bg-slate-100 text-slate-500')}
      title={`${ATTENDANCE_STATUS_LABEL[rec.status]?.label ?? ''}\nVào ${rec.checkInTime ?? '—'} · Ra ${rec.checkOutTime ?? '—'}`}>
      <span className="font-semibold">{rec.checkInTime?.slice(0, 5) ?? '—'}</span>
      <span className="opacity-70">{rec.checkOutTime?.slice(0, 5) ?? ''}</span>
    </span>
  )
}

function Legend() {
  const items: [number, string][] = [[1, 'Đúng giờ'], [2, 'Muộn'], [4, 'Vắng'], [6, 'Nửa ngày']]
  return <div className="hidden flex-wrap gap-2 sm:flex">{items.map(([v, l]) => <Badge key={v} tone={ATTENDANCE_STATUS_LABEL[v as 1 | 2 | 4 | 6].tone as any}>{l}</Badge>)}</div>
}