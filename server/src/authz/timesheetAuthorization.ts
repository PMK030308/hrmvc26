import { matchesEffectiveEmployeeScope, type AuthorizationActor } from './authorizationActor.js'

export const TIMESHEET_PERMISSIONS = {
  DETAIL_VIEW_SELF: 'timesheet.detail.view_self',
  DETAIL_VIEW_SCOPED: 'timesheet.detail.view_scoped',
  DETAIL_VIEW_ALL: 'timesheet.detail.view_all',
  SUMMARY_VIEW_SCOPED: 'timesheet.summary.view_scoped',
  SUMMARY_VIEW_ALL: 'timesheet.summary.view_all',
  SUMMARY_BUILD: 'timesheet.summary.build',
  SUMMARY_CONFIRM_HR: 'timesheet.summary.confirm_hr',
  SUMMARY_REBUILD: 'timesheet.summary.rebuild',
  SUMMARY_TRANSFER_PAYROLL: 'timesheet.summary.transfer_payroll',
} as const

export interface TimesheetEmployeeTarget {
  id: string
  departmentId: string | null | undefined
}

export function canViewTimesheetEmployee(actor: AuthorizationActor, target: TimesheetEmployeeTarget): boolean {
  if (actor.permissions.has(TIMESHEET_PERMISSIONS.DETAIL_VIEW_ALL)) return true
  if (target.id === actor.employeeId && actor.permissions.has(TIMESHEET_PERMISSIONS.DETAIL_VIEW_SELF)) return true
  return actor.permissions.has(TIMESHEET_PERMISSIONS.DETAIL_VIEW_SCOPED)
    && matchesEffectiveEmployeeScope(actor, target)
}

export function canListTimesheetDetail(actor: AuthorizationActor): boolean {
  return actor.permissions.has(TIMESHEET_PERMISSIONS.DETAIL_VIEW_ALL)
    || actor.permissions.has(TIMESHEET_PERMISSIONS.DETAIL_VIEW_SCOPED)
    || actor.permissions.has(TIMESHEET_PERMISSIONS.DETAIL_VIEW_SELF)
}

export function canViewSummaryEmployee(actor: AuthorizationActor, target: TimesheetEmployeeTarget): boolean {
  if (actor.permissions.has(TIMESHEET_PERMISSIONS.SUMMARY_VIEW_ALL)) return true
  return actor.permissions.has(TIMESHEET_PERMISSIONS.SUMMARY_VIEW_SCOPED)
    && matchesEffectiveEmployeeScope(actor, target)
}

export function canListSummaries(actor: AuthorizationActor): boolean {
  return actor.permissions.has(TIMESHEET_PERMISSIONS.SUMMARY_VIEW_ALL)
    || actor.permissions.has(TIMESHEET_PERMISSIONS.SUMMARY_VIEW_SCOPED)
}

export type SummaryTransitionAction = 'confirm' | 'rebuild' | 'transfer'

export function canTransitionSummary(actor: AuthorizationActor, action: SummaryTransitionAction): boolean {
  const permission = action === 'confirm'
    ? TIMESHEET_PERMISSIONS.SUMMARY_CONFIRM_HR
    : action === 'rebuild'
      ? TIMESHEET_PERMISSIONS.SUMMARY_REBUILD
      : TIMESHEET_PERMISSIONS.SUMMARY_TRANSFER_PAYROLL
  return actor.permissions.has(permission)
}
