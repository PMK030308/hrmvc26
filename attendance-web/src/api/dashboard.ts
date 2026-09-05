// ============================================================================
// API — Dashboard (Admin/HR) + Director (§10 / §14.7) — HTTP.
// ============================================================================
import { api, downloadFile } from './http'
import type { AdminDashboard, AnyRequest, PayrollAggregate, SalaryFund, WorkHoursAvg, SalaryMonthly } from '@/types'
import { normalizeDirectorPayroll, normalizeDirectorReport } from '@/lib/financialApiCompatibility'

export const dashboardApi = {
  admin(): Promise<AdminDashboard> { return api.get('/dashboard/admin') },

  directorApprovals(): Promise<AnyRequest[]> { return api.get('/dashboard/director-approvals') },

  async directorPayrolls(): Promise<PayrollAggregate | null> {
    return normalizeDirectorPayroll(await api.get('/dashboard/director-payrolls'))
  },

  directorReports(from: string, to: string): Promise<{
    employees: { name: string; paidUnits: number; otHours: number; late: number; net?: number }[]
    payroll: { totalNet: number; totalGross: number } | null
    projection: 'attendance' | 'aggregate' | 'detail'
  }> {
    return api.get('/dashboard/director-reports', { from, to }).then(normalizeDirectorReport)
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

  exportReport(from: string, to: string, format: 'excel' | 'pdf'): Promise<void> {
    return downloadFile(`/dashboard/director-reports/export-${format}`, `bao-cao-${from}_${to}.${format === 'excel' ? 'xlsx' : 'pdf'}`, { from, to })
  },
}
