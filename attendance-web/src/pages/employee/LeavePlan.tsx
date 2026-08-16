import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Plane, Clock3 } from 'lucide-react'
import { attendanceApi } from '@/api/attendance'
import { fmtDate } from '@/lib/date'
import { Card, CardHeader, CardBody, PageHeader, Spinner, EmptyState, Badge, ProgressBar } from '@/components/ui'
import { LEAVE_CATEGORY_LABEL } from '@/constants/enums'
import type { LeaveBalance } from '@/types'

export default function LeavePlanPage() {
  const { data, isLoading } = useQuery({ queryKey: ['attendance', 'leave-plan'], queryFn: () => attendanceApi.leavePlan() })
  if (isLoading || !data) return <Card className="p-5"><Spinner /></Card>
  return (
    <div>
      <PageHeader title="Kế hoạch nghỉ phép" subtitle="Quỹ phép năm & lịch nghỉ sắp tới" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Quỹ phép" subtitle={`Năm ${new Date().getFullYear()}`} icon={<CalendarDays className="h-4 w-4" />} />
          {data.balances.length === 0 ? <EmptyState icon={<CalendarDays className="h-6 w-6" />} title="Chưa có quỹ phép" /> : (
            <CardBody className="space-y-4">
              {data.balances.map((b) => <BalanceRow key={b.id} b={b} />)}
            </CardBody>
          )}
        </Card>
        <Card>
          <CardHeader title="Lịch nghỉ sắp tới" subtitle="Đơn nghỉ đã duyệt trong tương lai" icon={<Plane className="h-4 w-4" />} />
          {data.upcoming.length === 0 ? <EmptyState icon={<Clock3 className="h-6 w-6" />} title="Không có lịch nghỉ" description="Đơn nghỉ được duyệt sẽ hiện tại đây." /> : (
            <div className="divide-y divide-slate-100">
              {data.upcoming.map((u, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600"><Plane className="h-5 w-5" /></div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-800">{fmtDate(u.date, 'EEEE dd/MM/yyyy')}</p>
                    <p className="text-xs text-slate-500">{u.label}</p>
                  </div>
                  <Badge tone="success">Đã duyệt</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function BalanceRow({ b }: { b: LeaveBalance }) {
  const remaining = b.allocatedDays - b.usedDays - b.pendingDays
  const pct = b.allocatedDays > 0 ? Math.min(100, Math.round(((b.usedDays + b.pendingDays) / b.allocatedDays) * 100)) : 0
  const meta = LEAVE_CATEGORY_LABEL[b.leaveTypeCategory]
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700">{b.leaveTypeName}</p>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>Cấp: {b.allocatedDays} ngày</span>
        <span>Đã dùng: {b.usedDays} · Chờ: {b.pendingDays}</span>
      </div>
      <div className="mt-1.5"><ProgressBar value={pct} /></div>
      <p className="mt-1 text-right text-xs font-semibold text-slate-700">Còn {Math.max(0, remaining)} ngày</p>
    </div>
  )
}