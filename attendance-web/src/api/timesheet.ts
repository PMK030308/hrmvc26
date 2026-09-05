// ============================================================================
// API — Bảng công chi tiết + tổng hợp (§8) + lương (§8.5) — HTTP.
// ============================================================================
import { api, downloadFile } from './http'
import type {
  AttendanceRecord, Employee, SummaryTimesheet, Payslip, PayrollSheet,
} from '@/types'
import { normalizePayrollSheet, normalizeSummaryTimesheet } from '@/lib/financialApiCompatibility'

export const timesheetApi = {
  detailed(params: { year: number; month: number; half?: 1 | 2; departmentId?: string }): Promise<{
    employees: Employee[]; days: string[]; rows: Record<string, Record<string, AttendanceRecord | null>>
  }> {
    return api.get('/timesheet/detailed', params)
  },

  async buildSummary(params: { year: number; month: number; half: 1 | 2 }): Promise<SummaryTimesheet> {
    return normalizeSummaryTimesheet(await api.post('/timesheet/build-summary', params))
  },

  async listSummary(): Promise<SummaryTimesheet[]> {
    const rows = await api.get<unknown[]>('/timesheet/list-summary')
    return (Array.isArray(rows) ? rows : []).map(normalizeSummaryTimesheet)
  },

  confirmByHr(id: string, expectedVersion: number): Promise<SummaryTimesheet> { return api.post(`/timesheet/confirm-by-hr/${id}`, { expectedVersion }) },

  transferToPayroll(id: string, expectedVersion: number): Promise<SummaryTimesheet> { return api.post(`/timesheet/transfer-to-payroll/${id}`, { expectedVersion }) },

  rebuild(id: string, expectedVersion: number): Promise<SummaryTimesheet> { return api.post(`/timesheet/rebuild/${id}`, { expectedVersion }) },

  exportDetailed(params: { year: number; month: number; half: 1 | 2; departmentId?: string }): Promise<void> {
    return downloadFile('/timesheet/detailed/export-excel', `bang-cong-${params.year}-${params.month}-${params.half}.xlsx`, params)
  },

  exportSummary(id: string, format: 'excel' | 'pdf'): Promise<void> {
    return downloadFile(`/timesheet/summary/${id}/export-${format}`, `bang-cong-tong-hop.${format === 'excel' ? 'xlsx' : 'pdf'}`)
  },
}

export const payrollApi = {
  mine(): Promise<{ list: Payslip[]; latest: Payslip | null }> { return api.get('/payroll/mine') },

  byPeriod(period: string): Promise<Payslip | null> { return api.get(`/payroll/by-period/${period}`) },

  async sheet(period: string): Promise<PayrollSheet> {
    return normalizePayrollSheet(await api.get(`/payroll/sheet/${period}`), period)
  },

  periods(): Promise<string[]> { return api.get('/payroll/periods') },

  approvePayroll(period: string, expectedVersion: number): Promise<{ ok: true; period: string; status: number; version: number }> {
    return api.post(`/payroll/approve-payroll/${period}`, { expectedVersion })
  },

  exportSheet(period: string): Promise<void> { return downloadFile(`/payroll/sheet/${period}/export-excel`, `bang-luong-${period}.xlsx`) },

  exportPayslip(id: string): Promise<void> { return downloadFile(`/payroll/payslip/${id}/export-pdf`, `phieu-luong-${id}.pdf`) },
}
