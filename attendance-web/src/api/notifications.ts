// ============================================================================
// API — Thông báo (§14.8 / §10.3) — HTTP.
// ============================================================================
import { api } from './http'
import type { AppNotification } from '@/types'

export const notificationsApi = {
  list(): Promise<{ items: AppNotification[]; unread: number }> { return api.get('/notifications') },

  markRead(id: string): Promise<{ ok: true }> { return api.post(`/notifications/mark-read/${id}`) },

  markAllRead(): Promise<{ ok: true }> { return api.post('/notifications/mark-all-read') },
}