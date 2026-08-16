import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Bell, CheckCheck, Info, AlertTriangle, CheckCircle2, XCircle, CalendarClock, BadgeCheck } from 'lucide-react'
import { toast } from 'sonner'
import { notificationsApi } from '@/api/notifications'
import { NOTIF_TYPE_LABEL } from '@/constants/enums'
import { fmtDate, fmtTime } from '@/lib/date'
import { Card, CardHeader, PageHeader, Spinner, EmptyState, Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { NotificationType } from '@/types'

const typeIcon: Record<NotificationType, React.ReactNode> = {
  1: <Info className="h-5 w-5 text-info-500" />,
  2: <AlertTriangle className="h-5 w-5 text-warning-500" />,
  3: <CheckCircle2 className="h-5 w-5 text-success-500" />,
  4: <XCircle className="h-5 w-5 text-danger-500" />,
  5: <CalendarClock className="h-5 w-5 text-brand-500" />,
  6: <BadgeCheck className="h-5 w-5 text-brand-600" />,
}

export default function NotificationsPage() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['notifications'], queryFn: () => notificationsApi.list() })
  const markAll = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => { toast.success('Đã đánh dấu tất cả là đã đọc'); qc.invalidateQueries({ queryKey: ['notifications'] }) },
  })
  const markOne = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  return (
    <div>
      <PageHeader title="Thông báo" subtitle={data ? `${data.unread} chưa đọc / ${data.items.length} tổng` : 'Tất cả thông báo'}
        actions={data && data.unread > 0 ? <Button variant="secondary" onClick={() => markAll.mutate()} icon={<CheckCheck className="h-4 w-4" />}>Đánh dấu đã đọc</Button> : undefined} />
      {isLoading ? <Card className="p-5"><Spinner /></Card> : data && data.items.length === 0 ? (
        <Card><EmptyState icon={<Bell className="h-6 w-6" />} title="Không có thông báo" description="Bạn sẽ nhận thông báo khi có đơn mới, duyệt, lương..." /></Card>
      ) : (
        <Card>
          <CardHeader title="Hộp thư đến" icon={<Bell className="h-4 w-4" />} />
          <div className="divide-y divide-slate-100">
            {data!.items.map((n) => (
              <Link key={n.id} to={n.linkUrl ?? '#'} onClick={() => !n.isRead && markOne.mutate(n.id)}
                className={cn('flex gap-3 px-5 py-4 transition hover:bg-slate-50', !n.isRead && 'bg-brand-50/40')}>
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-50">{typeIcon[n.type]}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn('text-sm', n.isRead ? 'text-slate-700' : 'font-semibold text-slate-800')}>{n.title}</p>
                    {!n.isRead && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
                  </div>
                  <p className="mt-0.5 text-sm text-slate-500">{n.message}</p>
                  <p className="mt-1 text-[10px] text-slate-400">{fmtDate(n.createdAt, 'dd/MM/yyyy')} · {fmtTime(n.createdAt)} · {NOTIF_TYPE_LABEL[n.type].label}</p>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}