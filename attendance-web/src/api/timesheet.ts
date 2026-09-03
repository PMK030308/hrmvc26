// ============================================================================
// API — Bảng công chi tiết + tổng hợp (§8) + lương (§8.5) — HTTP.
// ============================================================================
import { api } from './http'
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
}
