import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { notificationsApi } from '@/api/notifications'
import type { AppNotification } from '@/types'
import { useAuthStore } from '@/stores/authStore'

/**
 * Mô phỏng realtime (SignalR/WS) bằng polling notificationsApi.list mỗi 5s.
 * Khi có thông báo mới cho user → toast + invalidate queries.
 * Bản production thay bằng SignalR client / WebSocket.
 */
export function useRealtime() {
  const qc = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const seenIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!user) return
    let active = true

    // Khởi tạo seen với thông báo hiện có
    notificationsApi.list().then(({ items }) => {
      if (!active) return
      items.forEach((n) => seenIds.current.add(n.id))
    }).catch(() => { /* bỏ qua */ })

    const id = setInterval(async () => {
      try {
        const { items } = await notificationsApi.list()
        if (!active) return
        const newOnes = items.filter((n) => !n.isRead && !seenIds.current.has(n.id))
        newOnes.forEach((n: AppNotification) => {
          seenIds.current.add(n.id)
          toast(n.title, { description: n.message })
        })
        if (newOnes.length > 0) {
          qc.invalidateQueries({ queryKey: ['notifications'] })
          qc.invalidateQueries({ queryKey: ['employee', 'dashboard'] })
          qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] })
        }
      } catch {
        /* bỏ qua lỗi poll */
      }
    }, 5000)

    return () => { active = false; clearInterval(id) }
  }, [user, qc])
}