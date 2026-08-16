import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Users, CheckCircle2, Clock3, XCircle, Percent, Radio, Wallet, ClipboardCheck, Activity, BadgeDollarSign, TrendingUp, Hourglass } from 'lucide-react'
import { dashboardApi } from '@/api/dashboard'
import { fmtDate } from '@/lib/date'
import { fmtCurrency, fmtNum } from '@/lib/format'
import { PageHeader, StatCard, Card, CardHeader, CardBody, Spinner, EmptyState, ProgressBar, Avatar } from '@/components/ui'
import { BarChart, GroupedBars, LegendDot } from '@/components/admin/widgets'

export default function AdminDashboard() {
  const { data, isLoading } = useQuery({ queryKey: ['dashboard', 'admin'], queryFn: () => dashboardApi.admin() })

  if (isLoading || !data) return <Card className="p-5"><Spinner /></Card>
  const { kpi, byDepartment, punchHourDistribution, onTimeTrend, activityFeed } = data

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Tổng quan chấm công & vận hành hôm nay" actions={
        <Link to="/admin/live"><StatCardClick icon={<Radio className="h-5 w-5" />} label="Theo dõi Live" value="Mở" tone="brand" /></Link>
      } />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Đã chấm hôm nay" value={`${kpi.employeesCheckedInToday}/${kpi.totalEmployees}`} icon={<Users className="h-5 w-5" />} tone="brand"
          hint={`${Math.round((kpi.employeesCheckedInToday / Math.max(1, kpi.totalEmployees)) * 100)}% nhân sự`} />
        <StatCard label="Đúng giờ" value={`${kpi.onTimeRate}%`} icon={<CheckCircle2 className="h-5 w-5" />} tone="success" hint={`${kpi.lateToday} người đi muộn`} />
        <StatCard label="Vắng mặt" value={kpi.absentToday} icon={<XCircle className="h-5 w-5" />} tone="danger" hint="Chưa chấm công" />
        <StatCard label="Đơn chờ duyệt" value={kpi.pendingApprovals} icon={<ClipboardCheck className="h-5 w-5" />} tone="warning" hint="Cần xử lý" />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Xu hướng đúng giờ (7 ngày)" subtitle="Đúng giờ so với đi muộn" icon={<Activity className="h-4 w-4" />} />
          <CardBody>
            <GroupedBars data={onTimeTrend.map((d) => ({ label: d.day, a: d.onTime, b: d.late }))} height={180}
              legend={<><LegendDot tone="bg-brand-500" label="Đúng giờ" /><LegendDot tone="bg-warning-400" label="Đi muộn" /></>} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Phân bố giờ chấm" subtitle="7h – 22h hôm nay" icon={<Clock3 className="h-4 w-4" />} />
          <CardBody>
            <BarChart data={punchHourDistribution.map((p) => ({ label: p.hour.slice(0, 2), value: p.count }))} height={180} tone="info" />
          </CardBody>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Tình trạng theo phòng ban" icon={<Users className="h-4 w-4" />} />
          <CardBody className="space-y-4">
            {byDepartment.map((d) => {
              const pct = d.total ? Math.round((d.present / d.total) * 100) : 0
              return (
                <div key={d.name}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700">{d.name}</span>
                    <span className="text-xs text-slate-500">{d.present}/{d.total} · {pct}%</span>
                  </div>
                  <ProgressBar value={pct} tone={pct >= 80 ? 'success' : pct >= 50 ? 'warning' : 'danger'} />
                </div>
              )
            })}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Hoạt động gần đây" subtitle="Nhật ký hệ thống" icon={<Activity className="h-4 w-4" />} />
          {activityFeed.length === 0 ? <CardBody><EmptyState icon={<Activity className="h-6 w-6" />} title="Chưa có hoạt động" /></CardBody> : (
            <ul className="divide-y divide-slate-100">
              {activityFeed.slice(0, 8).map((e, i) => (
                <li key={i} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={e.actorName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-700">{e.title}</p>
                    <p className="text-xs text-slate-400">{e.actorName}</p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{fmtDate(e.timestamp, 'HH:mm dd/MM')}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link to="/admin/summary-timesheet"><StatCardClick icon={<ClipboardCheck className="h-5 w-5" />} label="Bảng công chờ xử lý" value={kpi.pendingPayrolls} tone="warning" /></Link>
        <Link to="/admin/payroll"><StatCardClick icon={<Wallet className="h-5 w-5" />} label="Kỳ lương" value="Quản lý" tone="info" /></Link>
        <Link to="/admin/reports"><StatCardClick icon={<Percent className="h-5 w-5" />} label="Báo cáo" value="Xem" tone="brand" /></Link>
      </div>

      {/* ---- Dashboard quỹ lương / giờ công TB / so sánh tháng (theo nhận xét GV) ---- */}
      <DashboardFunds />
    </div>
  )
}

/** Quỹ lương theo phòng ban + giờ công trung bình + so sánh quỹ lương các kỳ. */
function DashboardFunds() {
  const { data: fund, isLoading: lf } = useQuery({ queryKey: ['dashboard', 'salary-fund'], queryFn: () => dashboardApi.salaryFund() })
  const { data: hours, isLoading: lh } = useQuery({ queryKey: ['dashboard', 'work-hours-avg'], queryFn: () => dashboardApi.workHoursAvg() })
  const { data: monthly, isLoading: lm } = useQuery({ queryKey: ['dashboard', 'salary-monthly'], queryFn: () => dashboardApi.salaryMonthly() })

  return (
    <div className="mt-6 space-y-5">
      <div className="grid gap-5 lg:grid-cols-3">
        {/* Quỹ lương theo phòng ban */}
        <Card className="lg:col-span-2">
          <CardHeader title="Quỹ lương theo phòng ban" subtitle={fund ? `Kỳ ${fund.period} · NET ${fmtCurrency(fund.totalNet)}` : 'Đang tải…'}
            icon={<BadgeDollarSign className="h-4 w-4" />} />
          <CardBody>
            {lf || !fund ? <Spinner /> : fund.byDepartment.length === 0 ? <EmptyState icon={<BadgeDollarSign className="h-6 w-6" />} title="Chưa có dữ liệu lương" /> : (
              <>
                <BarChart data={fund.byDepartment.map((d) => ({ label: d.name.replace('Phòng ', ''), value: Math.round(d.net / 1_000_000) }))}
                  height={200} tone="brand" valueFmt={(n) => `${fmtNum(n)} tr`} />
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500 sm:grid-cols-4">
                  <FundStat label="Quỹ NET" value={fmtCurrency(fund.totalNet)} />
                  <FundStat label="Quỹ GROSS" value={fmtCurrency(fund.totalGross)} />
                  <FundStat label="Lương cơ bản" value={fmtCurrency(fund.totalBase)} />
                  <FundStat label="Tiền OT" value={fmtCurrency(fund.totalOt)} />
                </div>
              </>
            )}
          </CardBody>
        </Card>

        {/* Giờ công trung bình / NV */}
        <Card>
          <CardHeader title="Giờ công trung bình" subtitle={hours ? `${hours.from} → ${hours.to}` : '30 ngày gần nhất'}
            icon={<Hourglass className="h-4 w-4" />} />
          <CardBody>
            {lh || !hours ? <Spinner /> : (
              <>
                <div className="mb-3 flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-brand-600">{fmtNum(hours.overall, 1)}</span>
                  <span className="text-sm text-slate-500">giờ/NV (toàn công ty)</span>
                </div>
                <BarChart data={hours.byDepartment.map((d) => ({ label: d.name.replace('Phòng ', ''), value: d.avgHours }))}
                  height={150} tone="info" valueFmt={(n) => `${fmtNum(n, 1)}h`} />
              </>
            )}
          </CardBody>
        </Card>
      </div>

      {/* So sánh quỹ lương các kỳ — giải thích tháng nhiều/tháng ít do OT */}
      <Card>
        <CardHeader title="So sánh quỹ lương các kỳ (nửa tháng)" subtitle="Tháng lương cao/thấp giải thích bằng tiền làm thêm (OT)"
          icon={<TrendingUp className="h-4 w-4" />} />
        <CardBody>
          {lm || !monthly ? <Spinner /> : monthly.periods.length === 0 ? <EmptyState icon={<TrendingUp className="h-6 w-6" />} title="Chưa có dữ liệu" /> : (
            <>
              <GroupedBars data={monthly.periods.map((p) => ({ label: p.label, a: Math.round(p.totalNet / 1_000_000), b: Math.round(p.totalOt / 1_000_000) }))}
                height={210}
                legend={<><LegendDot tone="bg-brand-500" label="Quỹ NET (triệu)" /><LegendDot tone="bg-warning-400" label="Tiền OT (triệu)" /></>} />
              <p className="mt-3 text-xs text-slate-500">
                <TrendingUp className="mr-1 inline h-3.5 w-3.5 text-warning-500" />
                Các kỳ cận Tết/lễ (ví dụ <b>2026/02/H1</b>) có OT cao (làm thêm lễ tết 3x + phụ cấp đêm) → quỹ lương NET cao;
                các kỳ giữa năm ít OT → quỹ lương thấp. Đây là lý do tháng nhiều/tháng ít.
              </p>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function FundStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-slate-50 px-2.5 py-2"><p className="text-slate-400">{label}</p><p className="font-semibold text-slate-700">{value}</p></div>
}

function StatCardClick({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone: 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' }) {
  return <StatCard label={label} value={value} icon={icon} tone={tone} />
}