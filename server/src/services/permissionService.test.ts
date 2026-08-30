import assert from 'node:assert/strict'
import test from 'node:test'
import { REQUEST_PERMISSIONS } from '../authz/requestAuthorization.js'
import {
  ALL_REQUEST_PERMISSIONS,
  ALL_ROLES,
  DEFAULT_ROLE_PERMISSIONS,
  mergeRolePermissions,
  validatePermissionMatrix,
  type PermissionMatrixRow,
} from './permissionService.js'

test('employee defaults are limited to own and partner request actions', () => {
  const permissions = DEFAULT_ROLE_PERMISSIONS.Employee
  assert.equal(permissions.includes(REQUEST_PERMISSIONS.VIEW_OWN), true)
  assert.equal(permissions.includes(REQUEST_PERMISSIONS.MODIFY_OWN), true)
  assert.equal(permissions.includes(REQUEST_PERMISSIONS.VIEW_ALL), false)
  assert.equal(permissions.includes(REQUEST_PERMISSIONS.APPROVE_ASSIGNED), false)
})

test('HR defaults include scoped view and assigned approval without global view', () => {
  const permissions = DEFAULT_ROLE_PERMISSIONS.HR
  assert.equal(permissions.includes(REQUEST_PERMISSIONS.VIEW_SCOPED), true)
  assert.equal(permissions.includes(REQUEST_PERMISSIONS.APPROVE_ASSIGNED), true)
  assert.equal(permissions.includes(REQUEST_PERMISSIONS.VIEW_ALL), false)
})

test('Admin defaults can view all but do not receive an approval override', () => {
  const permissions = DEFAULT_ROLE_PERMISSIONS.Admin
  assert.equal(permissions.includes(REQUEST_PERMISSIONS.VIEW_ALL), true)
  assert.equal(permissions.includes(REQUEST_PERMISSIONS.APPROVE_ASSIGNED), true)
  assert.equal(permissions.some((permission) => permission.includes('override')), false)
})

test('multiple roles merge permissions using allow-only OR semantics', () => {
  const permissions = mergeRolePermissions(['Employee', 'HR'], DEFAULT_ROLE_PERMISSIONS)
  assert.equal(permissions.has(REQUEST_PERMISSIONS.MODIFY_OWN), true)
  assert.equal(permissions.has(REQUEST_PERMISSIONS.VIEW_SCOPED), true)
})

function completeMatrix(): PermissionMatrixRow[] {
  return ALL_REQUEST_PERMISSIONS.map((permission) => ({
    permission,
    roles: Object.fromEntries(ALL_ROLES.map((role) => [role, true])) as PermissionMatrixRow['roles'],
  }))
}

test('request permission matrix requires every permission and every role exactly once', () => {
  assert.doesNotThrow(() => validatePermissionMatrix(completeMatrix()))
  assert.throws(() => validatePermissionMatrix(completeMatrix().slice(1)), /đầy đủ/i)
  const duplicate = completeMatrix()
  duplicate[duplicate.length - 1] = duplicate[0]!
  assert.throws(() => validatePermissionMatrix(duplicate), /trùng/i)

  const missingRole = completeMatrix()
  delete (missingRole[0]!.roles as Partial<PermissionMatrixRow['roles']>).Guest
  assert.throws(() => validatePermissionMatrix(missingRole), /vai trò/i)
})
