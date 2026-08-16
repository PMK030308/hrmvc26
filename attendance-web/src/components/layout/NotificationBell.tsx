import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCheck } from 'lucide-react'
import { notificationsApi } from '@/api/notifications'
import { NOTIF_TYPE_LABEL } from '@/constants/enums'
import { fmtDate } from '@/lib/date'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { Badge } from '@/components/ui'

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list(),
    refetchInterval: 15000,
  })

  const markAll = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const markOne = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const items = data?.items ?? []
  const unread = data?.unread ?? 0

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative grid h-10 w-10 place-items-center rounded-lg text-slate-600 hover:bg-slate-100">
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger-600 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-80 origin-top-right rounded-2xl bg-white shadow-pop ring-1 ring-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-semibold text-slate-800">Thông báo {unread > 0 && <Badge tone="danger">{unread} mới</Badge>}</p>
              {unread > 0 && (
                <button onClick={() => markAll.mutate()} className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                  <CheckCheck className="h-3.5 w-3.5" /> Đọc tất cả
                </button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {items.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-400">Không có thông báo</p>
              ) : items.slice(0, 20).map((n) => {
                const meta = NOTIF_TYPE_LABEL[n.type]
                return (
                  <button key={n.id} onClick={() => { markOne.mutate(n.id); if (n.linkUrl) navigate(n.linkUrl); setOpen(false) }}
                    className={cn('flex w-full gap-3 border-b border-slate-50 px-4 py-3 text-left transition hover:bg-slate-50', !n.isRead && 'bg-brand-50/40')}>
                    <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', !n.isRead ? 'bg-brand-500' : 'bg-transparent')} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-slate-800">{n.title}</p>
                        <Badge tone={meta.tone as any}>{meta.label}</Badge>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{n.message}</p>
                      <p className="mt-1 text-[10px] text-slate-400">{fmtDate(n.createdAt, 'dd/MM/yyyy HH:mm')}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}