import { matchesEffectiveEmployeeScope, type AuthorizationActor } from './authorizationActor.js'

export const ORGANIZATION_PERMISSIONS = {
  CATALOG_VIEW: 'org.catalog.view',
  EMPLOYEE_VIEW_SCOPED: 'org.employee.view_scoped',
  EMPLOYEE_VIEW_ALL: 'org.employee.view_all',
  EMPLOYEE_VIEW_PRIVATE: 'org.employee.view_private',
  EMPLOYEE_VIEW_COMPENSATION: 'org.employee.view_compensation',
  EMPLOYEE_MANAGE_SCOPED: 'org.employee.manage_scoped',
  EMPLOYEE_MANAGE_ALL: 'org.employee.manage_all',
} as const

export interface EmployeeAuthorizationTarget {
  id: string
  departmentId: string | null | undefined
}

export function canViewEmployee(actor: AuthorizationActor, target: EmployeeAuthorizationTarget): boolean {
  if (actor.permissions.has(ORGANIZATION_PERMISSIONS.EMPLOYEE_VIEW_ALL)) return true
  return actor.permissions.has(ORGANIZATION_PERMISSIONS.EMPLOYEE_VIEW_SCOPED)
    && matchesEffectiveEmployeeScope(actor, target)
}

export function canManageEmployee(actor: AuthorizationActor, target: EmployeeAuthorizationTarget): boolean {
  if (actor.permissions.has(ORGANIZATION_PERMISSIONS.EMPLOYEE_MANAGE_ALL)) return true
  return actor.permissions.has(ORGANIZATION_PERMISSIONS.EMPLOYEE_MANAGE_SCOPED)
    && matchesEffectiveEmployeeScope(actor, target)
}

export function canCreateEmployeeInDepartment(actor: AuthorizationActor, departmentId: string): boolean {
  if (actor.permissions.has(ORGANIZATION_PERMISSIONS.EMPLOYEE_MANAGE_ALL)) return true
  if (!actor.permissions.has(ORGANIZATION_PERMISSIONS.EMPLOYEE_MANAGE_SCOPED)) return false
  return actor.departmentScopes.includes(departmentId)
}

export function canListEmployees(actor: AuthorizationActor): boolean {
  return actor.permissions.has(ORGANIZATION_PERMISSIONS.EMPLOYEE_VIEW_ALL)
    || actor.permissions.has(ORGANIZATION_PERMISSIONS.EMPLOYEE_VIEW_SCOPED)
}

export function canCreateEmployees(actor: AuthorizationActor): boolean {
  return actor.permissions.has(ORGANIZATION_PERMISSIONS.EMPLOYEE_MANAGE_ALL)
    || actor.permissions.has(ORGANIZATION_PERMISSIONS.EMPLOYEE_MANAGE_SCOPED)
}

export function projectEmployee(employee: Record<string, any>, actor: AuthorizationActor): Record<string, any> {
  const projected: Record<string, any> = {
    id: employee.id,
    employeeCode: employee.employeeCode,
    fullName: employee.fullName,
    email: employee.email,
    status: employee.status,
    avatarData: employee.avatarData,
    managerId: employee.managerId,
    departmentId: employee.departmentId,
    positionId: employee.positionId,
    branchId: employee.branchId,
  }
  if (actor.permissions.has(ORGANIZATION_PERMISSIONS.EMPLOYEE_VIEW_PRIVATE)) {
    Object.assign(projected, {
      firstName: employee.firstName,
      lastName: employee.lastName,
      gender: employee.gender,
      dateOfBirth: employee.dateOfBirth,
      phone: employee.phone,
      address: employee.address,
      maritalStatus: employee.maritalStatus,
      hireDate: employee.hireDate,
      workNature: employee.workNature,
      contractType: employee.contractType,
    })
  }
  if (actor.permissions.has(ORGANIZATION_PERMISSIONS.EMPLOYEE_VIEW_COMPENSATION)) {
    projected.wage = employee.wage
  }
  return projected
}
