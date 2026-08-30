import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Users, CheckCircle2, ClipboardCheck, BadgeDollarSign, ArrowRight, TrendingUp } from 'lucide-react'
import { dashboardApi } from '@/api/dashboard'
import { fmtCurrency } from '@/lib/format'
import { REQUEST_TYPE_LABEL, REQUEST_STATUS_LABEL } from '@/constants/enums'
import { fmtDate } from '@/lib/date'
import { PageHeader, StatCard, Card, CardHeader, CardBody, Spinner, EmptyState, StatusBadge, Avatar, ProgressBar } from '@/components/ui'
import { requestSummary } from '@/components/requests/widgets'

export default function DirectorDashboard() {
  const { data: kpi, isLoading } = useQuery({ queryKey: ['dashboard', 'admin'], queryFn: () => dashboardApi.admin() })
  const { data: approvals } = useQuery({ queryKey: ['director', 'approvals'], queryFn: () => dashboardApi.directorApprovals() })
  const { data: payroll } = useQuery({ queryKey: ['director', 'payrolls'], queryFn: () => dashboardApi.directorPayrolls() })

  if (isLoading || !kpi) return <Card className="p-5"><Spinner /></Card>
  const latestPeriod = payroll?.period

  return (
    <div>
      <PageHeader title="Dashboard Giám đốc" subtitle="Tổng quan vận hành & quyết định chờ phê duyệt" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Nhân sự có mặt" value={`${kpi.kpi.employeesCheckedInToday}/${kpi.kpi.totalEmployees}`} icon={<Users className="h-5 w-5" />} tone="brand" />
        <StatCard label="Tỷ lệ đúng giờ" value={`${kpi.kpi.onTimeRate}%`} icon={<CheckCircle2 className="h-5 w-5" />} tone="success" />
        <StatCard label="Đơn chờ GĐ duyệt" value={approvals?.length ?? 0} icon={<ClipboardCheck className="h-5 w-5" />} tone="warning" />
        <StatCard label="Kỳ lương chờ" value={kpi.kpi.pendingPayrolls} icon={<BadgeDollarSign className="h-5 w-5" />} tone="info" />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Đơn chờ Giám đốc phê duyệt" subtitle={`${approvals?.length ?? 0} đơn`} icon={<ClipboardCheck className="h-4 w-4" />} action={
            <Link to="/director/approvals" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline">Tất cả <ArrowRight className="h-4 w-4" /></Link>
          } />
          {(approvals ?? []).length === 0 ? <CardBody><EmptyState icon={<ClipboardCheck className="h-6 w-6" />} title="Không có đơn chờ" description="Các đơn cần cấp Giám đốc sẽ hiện tại đây." /></CardBody> : (
            <ul className="divide-y divide-slate-100">
              {approvals!.slice(0, 6).map((r) => (
                <li key={r.id}>
                  <Link to={`/employee/requests/${r.type}/${r.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                    <Avatar name={r.employeeName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{REQUEST_TYPE_LABEL[r.type].label}</span>
                        <StatusBadge map={REQUEST_STATUS_LABEL} value={r.status} />
                      </div>
                      <p className="mt-0.5 truncate text-sm font-medium text-slate-800">{r.employeeName}</p>
                      <p className="truncate text-xs text-slate-500">{requestSummary(r)}</p>
                    </div>
                    <span className="shrink-0 text-xs text-slate-400">{fmtDate(r.createdAt, 'dd/MM')}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Bảng lương kỳ gần nhất" icon={<BadgeDollarSign className="h-4 w-4" />} action={
            <Link to="/director/payroll" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline">Chi tiết <ArrowRight className="h-4 w-4" /></Link>
          } />
          <CardBody className="space-y-3">
            {latestPeriod ? (
              <>
                <div className="rounded-xl bg-brand-50 p-4">
                  <p className="text-xs text-brand-700">Tổng quỹ lương NET</p>
                  <p className="mt-1 text-2xl font-bold text-brand-700">{fmtCurrency(payroll?.totalNet ?? 0)}</p>
                  <p className="mt-0.5 text-xs text-brand-600/70">Kỳ {latestPeriod} · {payroll?.headcount ?? 0} phiếu</p>
                </div>
                <Link to="/director/payroll"><button className="w-full rounded-lg bg-success-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-success-700">Xem kỳ lương</button></Link>
              </>
            ) : <EmptyState icon={<BadgeDollarSign className="h-6 w-6" />} title="Chưa có kỳ lương" />}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="Tỷ lệ có mặt theo phòng ban" icon={<TrendingUp className="h-4 w-4" />} />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          {kpi.byDepartment.map((d) => {
            const pct = d.total ? Math.round((d.present / d.total) * 100) : 0
            return <div key={d.name}><div className="mb-1 flex justify-between text-sm"><span className="font-medium text-slate-700">{d.name}</span><span className="text-xs text-slate-500">{pct}%</span></div><ProgressBar value={pct} tone={pct >= 80 ? 'success' : 'warning'} /></div>
          })}
        </CardBody>
      </Card>
    </div>
  )
}
