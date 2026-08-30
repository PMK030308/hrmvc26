import type { AuthorizationActor } from './authorizationActor.js'

export const PAYROLL_PERMISSIONS = {
  PAYSLIP_VIEW_SELF: 'payroll.payslip.view_self',
  SHEET_VIEW: 'payroll.sheet.view',
  SHEET_APPROVE: 'payroll.sheet.approve',
} as const

export function canViewOwnPayslip(actor: AuthorizationActor, employeeId: string): boolean {
  return employeeId === actor.employeeId && actor.permissions.has(PAYROLL_PERMISSIONS.PAYSLIP_VIEW_SELF)
}

export function canViewPayrollSheet(actor: AuthorizationActor): boolean {
  return actor.permissions.has(PAYROLL_PERMISSIONS.SHEET_VIEW)
}

export function canApprovePayroll(actor: AuthorizationActor): boolean {
  return actor.permissions.has(PAYROLL_PERMISSIONS.SHEET_APPROVE)
}
