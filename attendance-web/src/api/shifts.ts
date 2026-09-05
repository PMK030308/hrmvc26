// ============================================================================
// API — Ca làm việc & phân ca (§7) — HTTP.
// ============================================================================
import { api, downloadFile, http } from './http'
import type { Shift, ShiftSchedule, Employee } from '@/types'

export interface BulkImportResult {
  totalRows: number
  importedCount: number
  errors: Array<{ row: number; field: string; message: string }>
}

export const shiftsApi = {
  list(): Promise<Shift[]> { return api.get('/shifts') },

  create(payload: Partial<Shift>): Promise<Shift> { return api.post('/shifts', payload) },

  update(id: string, payload: Partial<Shift>): Promise<Shift> { return api.put(`/shifts/${id}`, payload) },

  delete(id: string): Promise<{ ok: true }> { return api.del(`/shifts/${id}`) },

  schedule(params: { year: number; month: number; departmentId?: string }): Promise<{
    employees: Employee[]; days: string[]; schedules: Record<string, Record<string, ShiftSchedule | null>>
  }> {
    return api.get('/shifts/schedule', params)
  },

  assign(payload: { employeeId: string; date: string; shiftId: string | null }): Promise<{ ok: true }> {
    return api.post('/shifts/assign', payload)
  },

  bulkAssign(payload: { employeeIds: string[]; shiftId: string; dates: string[] }): Promise<{ ok: true }> {
    return api.post('/shifts/bulk-assign', payload)
  },

  downloadScheduleTemplate(): Promise<void> { return downloadFile('/shifts/schedule/import-template', 'mau-phan-ca.xlsx') },

  exportSchedule(params: { year: number; month: number; departmentId?: string }): Promise<void> {
    return downloadFile('/shifts/schedule/export-excel', `lich-phan-ca-${params.year}-${params.month}.xlsx`, params)
  },

  importSchedule(file: File): Promise<BulkImportResult> {
    return http.post<BulkImportResult>('/shifts/schedule/import-excel', file, {
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    }).then((response) => response.data)
  },
}
