// ============================================================================
// API — Bảng công chi tiết + tổng hợp (§8) + lương (§8.5) — HTTP.
// ============================================================================
import { api } from './http'
import type {
  AttendanceRecord, Employee, SummaryTimesheet, Payslip,
} from '@/types'

export const timesheetApi = {
  detailed(params: { year: number; month: number; half?: 1 | 2; departmentId?: string }): Promise<{
    employees: Employee[]; days: string[]; rows: Record<string, Record<string, AttendanceRecord | null>>
  }> {
    return api.get('/timesheet/detailed', params)
  },

  buildSummary(params: { year: number; month: number; half: 1 | 2 }): Promise<SummaryTimesheet> {
    return api.post('/timesheet/build-summary', params)
  },

  listSummary(): Promise<SummaryTimesheet[]> { return api.get('/timesheet/list-summary') },

  confirmByHr(id: string): Promise<SummaryTimesheet> { return api.post(`/timesheet/confirm-by-hr/${id}`) },

  transferToPayroll(id: string): Promise<SummaryTimesheet> { return api.post(`/timesheet/transfer-to-payroll/${id}`) },

  rebuild(id: string): Promise<SummaryTimesheet> { return api.post(`/timesheet/rebuild/${id}`) },
}

export const payrollApi = {
  mine(): Promise<{ list: Payslip[]; latest: Payslip | null }> { return api.get('/payroll/mine') },

  byPeriod(period: string): Promise<Payslip | null> { return api.get(`/payroll/by-period/${period}`) },

  sheet(period: string): Promise<Payslip[]> { return api.get(`/payroll/sheet/${period}`) },

  periods(): Promise<string[]> { return api.get('/payroll/periods') },

  approvePayroll(period: string): Promise<{ ok: true }> { return api.post(`/payroll/approve-payroll/${period}`) },
}