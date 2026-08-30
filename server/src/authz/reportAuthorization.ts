import { matchesEffectiveEmployeeScope, type AuthorizationActor } from './authorizationActor.js'

export const REPORT_PERMISSIONS = {
  ATTENDANCE_VIEW_SCOPED: 'reports.attendance.view_scoped',
  ATTENDANCE_VIEW_ALL: 'reports.attendance.view_all',
  PAYROLL_VIEW_AGGREGATE: 'reports.payroll.view_aggregate',
  PAYROLL_VIEW_DETAIL: 'reports.payroll.view_detail',
} as const

export interface ReportEmployeeTarget {
  id: string
  departmentId: string | null | undefined
}

export function canViewAttendanceReportEmployee(actor: AuthorizationActor, target: ReportEmployeeTarget): boolean {
  if (actor.permissions.has(REPORT_PERMISSIONS.ATTENDANCE_VIEW_ALL)) return true
  return actor.permissions.has(REPORT_PERMISSIONS.ATTENDANCE_VIEW_SCOPED)
    && matchesEffectiveEmployeeScope(actor, target)
}

export function canViewAttendanceReports(actor: AuthorizationActor): boolean {
  return actor.permissions.has(REPORT_PERMISSIONS.ATTENDANCE_VIEW_ALL)
    || actor.permissions.has(REPORT_PERMISSIONS.ATTENDANCE_VIEW_SCOPED)
}

export function reportProjectionFor(actor: AuthorizationActor): 'attendance' | 'aggregate' | 'detail' {
  if (actor.permissions.has(REPORT_PERMISSIONS.PAYROLL_VIEW_DETAIL)) return 'detail'
  if (actor.permissions.has(REPORT_PERMISSIONS.PAYROLL_VIEW_AGGREGATE)) return 'aggregate'
  return 'attendance'
}
