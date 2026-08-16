// ============================================================================
// API — Dashboard (Admin/HR) + Director (§10 / §14.7) — HTTP.
// ============================================================================
import { api } from './http'
import type { AdminDashboard, AnyRequest, Payslip, SalaryFund, WorkHoursAvg, SalaryMonthly } from '@/types'

export const dashboardApi = {
  admin(): Promise<AdminDashboard> { return api.get('/dashboard/admin') },

  directorApprovals(): Promise<AnyRequest[]> { return api.get('/dashboard/director-approvals') },

  directorPayrolls(): Promise<Payslip[]> { return api.get('/dashboard/director-payrolls') },

  directorReports(from: string, to: string): Promise<{
    employees: { name: string; paidUnits: number; otHours: number; late: number; net: number }[]
  }> {
    return api.get('/dashboard/director-reports', { from, to })
  },

  /* ---- Dashboard mới: quỹ lương / giờ công TB / so sánh tháng ---- */

  /** Quỹ lương theo phòng ban (kỳ payslip cho trước, mặc định kỳ mới nhất). */
  salaryFund(period?: string): Promise<SalaryFund> {
    return api.get('/dashboard/salary-fund', period ? { period } : undefined)
  },

  /** Giờ công trung bình mỗi nhân viên (theo khoảng ngày). */
  workHoursAvg(from?: string, to?: string): Promise<WorkHoursAvg> {
    const params: Record<string, string> = {}
    if (from) params.from = from
    if (to) params.to = to
    return api.get('/dashboard/work-hours-avg', params)
  },

  /** So sánh quỹ lương các kỳ nửa tháng — giải thích tháng nhiều/tháng ít do OT. */
  salaryMonthly(): Promise<SalaryMonthly> { return api.get('/dashboard/salary-monthly') },
}