// ============================================================================
// API — Audit log (§A5) — HTTP.
// ============================================================================
import { api } from './http'
import type { AuditLog } from '@/types'

export const auditApi = {
  list(params?: { page?: number; pageSize?: number }): Promise<{ items: AuditLog[]; total: number }> {
    return api.get('/audit', params)
  },
}