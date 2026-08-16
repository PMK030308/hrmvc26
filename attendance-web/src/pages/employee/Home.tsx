import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CalendarDays, FileText, Clock3, Bell, Sparkles } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { attendanceApi } from '@/api/attendance'

import { notificationsApi } from '@/api/notifications'
import { useAuthStore } from '@/stores/authStore'
import { REQUEST_STATUS_LABEL, REQUEST_TYPE_LABEL, NOTIF_TYPE_LABEL } from '@/constants/enums'
import { fmtDate, fmtHours, yearsOfService } from '@/lib/date'
import { Card, CardHeader, StatCard, Avatar, StatusBadge, EmptyState, Badge } from '@/components/ui'
import { PunchCard, Summary30, RecentAttendance, FloatingPunch } from '@/components/attendance/widgets'
import { requestSummary } from '@/components/requests/widgets'

import type { AnyRequest } from '@/types'

export default function EmployeeHome() {
  const user = useAuthStore((s) => s.user)!
  const { data, isLoading } = useQuery({ queryKey: ['employee', 'dashboard'], queryFn: () => attendanceApi.dashboard(), staleTime: 30_000 })
  const { data: notif } = useQuery({ queryKey: ['notifications'], queryFn: () => notificationsApi.list() })

  if (isLoading || !data) {
    return (
      <div className="space-y-5">
        <SkeletonHeader name={user.email} />
        <div className="grid gap-5 lg:grid-cols-3"><div className="h-80 animate-pulse rounded-2xl bg-slate-200/60" /><div className="h-80 animate-pulse rounded-2xl bg-slate-200/60" /><div className="h-80 animate-pulse rounded-2xl bg-slate-200/60" /></div>
      </div>
    )
  }

  const emp = data.employee
  const sc = data.statCards
  const quickActions = [
    { to: '/employee/requests/leaves/new', label: 'Xin nghỉ phép', icon: CalendarDays, tone: 'brand' as const },
    { to: '/employee/requests/overtimes/new', label: 'Đăng ký OT', icon: Clock3, tone: 'info' as const },
    { to: '/employee/requests/business-trips/new', label: 'Xin công tác', icon: FileText, tone: 'success' as const },
    { to: '/employee/requests/shift-swaps/new', label: 'Đổi ca', icon: CalendarDays, tone: 'warning' as const },
  ]

  return (
    <div className="space-y-5">
      {/* Greeting */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Avatar name={emp.fullName} src={emp.avatarData} size="lg" />
          <div>
            <p className="flex items-center gap-2 text-sm text-slate-500"><Sparkles className="h-4 w-4 text-brand-500" />{data.greeting},</p>
            <h1 className="text-xl font-bold text-slate-800">{emp.fullName}</h1>
            <p className="text-xs text-slate-500">{emp.employeeCode} · {yearsOfService(emp.hireDate)} năm cống hiến</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {quickActions.map((a) => (
            <Link key={a.to} to={a.to} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition hover:shadow-sm ${
              a.tone === 'brand' ? 'bg-brand-50 text-brand-700' : a.tone === 'info' ? 'bg-info-50 text-info-600' : a.tone === 'success' ? 'bg-success-50 text-success-700' : 'bg-warning-50 text-warning-700'}`}>
              <a.icon className="h-3.5 w-3.5" /> {a.label}
            </Link>
          ))}
        </div>
      </motion.div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Quỹ phép năm" value={`${sc.leaveBalance.allocated - sc.leaveBalance.used}`} hint={`Đang chờ: ${sc.leaveBalance.pending} ngày`} icon={<CalendarDays className="h-5 w-5" />} tone="brand" />
        <StatCard label="Chờ duyệt (của tôi)" value={sc.pendingApprovals} hint="Đơn đang xử lý" icon={<FileText className="h-5 w-5" />} tone="warning" />
        <StatCard label="Công tháng này" value={fmtHours(sc.monthPaidUnits)} hint="Đơn vị công hưởng" icon={<Clock3 className="h-5 w-5" />} tone="success" />
        <StatCard label="OT 30 ngày" value={fmtHours(sc.otHours30)} hint={`Giờ làm: ${fmtHours(sc.workHours30)}`} icon={<Clock3 className="h-5 w-5" />} tone="info" />
      </div>

      {/* Main grid */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-1"><PunchCard /></div>
        <div className="lg:col-span-2 space-y-5">
          <Summary30 />
          <RecentAttendance records={data.recentAttendance} />
        </div>
      </div>

      {/* Đơn của tôi + thông báo */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Đơn từ của tôi" icon={<FileText className="h-4 w-4" />} action={<Link to="/employee/requests" className="text-xs font-medium text-brand-600 hover:underline">Xem tất cả</Link>} />
          {data.myRequests.length === 0 ? <EmptyState icon={<FileText className="h-6 w-6" />} title="Chưa có đơn nào" /> : (
            <div className="divide-y divide-slate-100">
              {data.myRequests.slice(0, 5).map((r: AnyRequest) => (
                <Link key={r.id} to={`/employee/requests/${r.type}/${r.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-slate-800"><Badge tone={REQUEST_TYPE_LABEL[r.type].tone}>{REQUEST_TYPE_LABEL[r.type].label}</Badge></p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">{requestSummary(r)} · {fmtDate(r.createdAt, 'dd/MM HH:mm')}</p>
                  </div>
                  <StatusBadge map={REQUEST_STATUS_LABEL} value={r.status} />
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Thông báo" icon={<Bell className="h-4 w-4" />} action={<Link to="/employee/notifications" className="text-xs font-medium text-brand-600 hover:underline">{notif?.unread ? `${notif.unread} mới` : 'Xem'}</Link>} />
          {data.notifications.length === 0 ? <EmptyState icon={<Bell className="h-6 w-6" />} title="Không có thông báo" /> : (
            <div className="divide-y divide-slate-100">
              {data.notifications.slice(0, 5).map((n) => (
                <Link key={n.id} to={n.linkUrl ?? '/employee/notifications'} className="flex gap-3 px-5 py-3 hover:bg-slate-50">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.isRead ? 'bg-slate-300' : 'bg-brand-500'}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">{n.title}</p>
                    <p className="truncate text-xs text-slate-500">{n.message}</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">{fmtDate(n.createdAt, 'dd/MM HH:mm')} · {NOTIF_TYPE_LABEL[n.type].label}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      <FloatingPunch />
    </div>
  )
}

function SkeletonHeader({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-4">
      <div className="h-12 w-12 animate-pulse rounded-full bg-slate-200" />
      <div>
        <div className="h-3 w-24 animate-pulse rounded bg-slate-200" />
        <div className="mt-2 h-5 w-40 animate-pulse rounded bg-slate-200" />
        <p className="text-xs text-slate-400">{name}</p>
      </div>
    </div>
  )
}