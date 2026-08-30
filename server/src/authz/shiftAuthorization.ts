import { hasPermission, matchesEffectiveEmployeeScope, type AuthorizationActor } from './authorizationActor.js'

export const SHIFT_PERMISSIONS = {
  CATALOG_VIEW: 'shifts.catalog.view',
  CATALOG_MANAGE: 'shifts.catalog.manage',
  SCHEDULE_VIEW_SELF: 'shifts.schedule.view_self',
  SCHEDULE_VIEW_SCOPED: 'shifts.schedule.view_scoped',
  SCHEDULE_VIEW_ALL: 'shifts.schedule.view_all',
  SCHEDULE_MANAGE_SCOPED: 'shifts.schedule.manage_scoped',
  SCHEDULE_MANAGE_ALL: 'shifts.schedule.manage_all',
} as const

interface ShiftTarget { id: string; departmentId: string | null | undefined }

export function canViewShiftSchedule(actor: AuthorizationActor, target: ShiftTarget): boolean {
  if (target.id === actor.employeeId && hasPermission(actor, SHIFT_PERMISSIONS.SCHEDULE_VIEW_SELF)) return true
  if (hasPermission(actor, SHIFT_PERMISSIONS.SCHEDULE_VIEW_ALL)) return true
  return hasPermission(actor, SHIFT_PERMISSIONS.SCHEDULE_VIEW_SCOPED)
    && matchesEffectiveEmployeeScope(actor, target)
}

export function canManageShiftSchedule(actor: AuthorizationActor, target: ShiftTarget): boolean {
  if (hasPermission(actor, SHIFT_PERMISSIONS.SCHEDULE_MANAGE_ALL)) return true
  return hasPermission(actor, SHIFT_PERMISSIONS.SCHEDULE_MANAGE_SCOPED)
    && matchesEffectiveEmployeeScope(actor, target)
}
