// ============================================================================
// API — Audit log (§A5) — HTTP.
// ============================================================================
import { api, downloadFile } from './http'
import type { AuditLog } from '@/types'

export const auditApi = {
  list(params?: { page?: number; pageSize?: number }): Promise<{ items: AuditLog[]; total: number }> {
    return api.get('/audit', params)
  },
  exportExcel(): Promise<void> { return downloadFile('/audit/export-excel', 'audit-log.xlsx') },
}
