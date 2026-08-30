import {
  hasPermission,
  matchesEffectiveEmployeeScope,
  type AuthorizationActor,
} from './authorizationActor.js'

export const ATTENDANCE_PERMISSIONS = {
  PUNCH_SELF: 'attendance.punch.self',
  VIEW_SELF: 'attendance.view_self',
  VIEW_SCOPED: 'attendance.view_scoped',
  VIEW_ALL: 'attendance.view_all',
  PROXY_PUNCH: 'attendance.proxy_punch',
  CONFIRM_SELF: 'attendance.timesheet.confirm_self',
  LEAVE_PLAN_SELF: 'attendance.leave_plan.view_self',
  LEAVERS_SCOPED: 'attendance.leavers.view_scoped',
  EVIDENCE_VIEW: 'attendance.evidence.view',
  DEVICE_MANAGE: 'attendance.device.manage',
} as const

export interface AttendanceTarget {
  id: string
  departmentId: string | null | undefined
}

export function canViewAttendance(actor: AuthorizationActor, target: AttendanceTarget): boolean {
  if (target.id === actor.employeeId) return hasPermission(actor, ATTENDANCE_PERMISSIONS.VIEW_SELF)
  if (hasPermission(actor, ATTENDANCE_PERMISSIONS.VIEW_ALL)) return true
  return hasPermission(actor, ATTENDANCE_PERMISSIONS.VIEW_SCOPED)
    && matchesEffectiveEmployeeScope(actor, target)
}

export function canProxyPunch(actor: AuthorizationActor, target: AttendanceTarget): boolean {
  if (target.id === actor.employeeId) return false
  return hasPermission(actor, ATTENDANCE_PERMISSIONS.PROXY_PUNCH)
    && matchesEffectiveEmployeeScope(actor, target)
}
