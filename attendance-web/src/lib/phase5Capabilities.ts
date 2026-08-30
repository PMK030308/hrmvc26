export function phase5Capabilities(effectivePermissions: readonly string[]) {
  const permissions = new Set(effectivePermissions)
  return {
    canViewOwnTimesheet: permissions.has('timesheet.detail.view_self'),
    canViewTimesheetDetail: permissions.has('timesheet.detail.view_self')
      || permissions.has('timesheet.detail.view_scoped') || permissions.has('timesheet.detail.view_all'),
    canViewSummary: permissions.has('timesheet.summary.view_scoped') || permissions.has('timesheet.summary.view_all'),
    canBuildSummary: permissions.has('timesheet.summary.build'),
    canViewOwnPayslip: permissions.has('payroll.payslip.view_self'),
    canViewPayrollSheet: permissions.has('payroll.sheet.view'),
    canApprovePayroll: permissions.has('payroll.sheet.approve'),
    canViewReports: permissions.has('reports.attendance.view_scoped') || permissions.has('reports.attendance.view_all')
      || permissions.has('reports.payroll.view_aggregate') || permissions.has('reports.payroll.view_detail'),
    canViewPayrollAggregateReport: permissions.has('reports.payroll.view_aggregate') || permissions.has('reports.payroll.view_detail'),
    canViewPayrollDetailReport: permissions.has('reports.payroll.view_detail'),
  }
}

export function shouldReloadFinancialState(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && (error as { status?: unknown }).status === 409
}
