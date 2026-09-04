import assert from 'node:assert/strict'
import test from 'node:test'
import { allowsUiPermission, allowsAnyUiPermission } from './permissionCompatibility.ts'

test('legacy auth responses without effectivePermissions keep role-guarded UI available', () => {
  assert.equal(allowsUiPermission(undefined, 'config.permission.manage', ['Admin']), true)
  assert.equal(allowsUiPermission(undefined, 'config.permission.manage', ['HR']), false)
  assert.equal(allowsAnyUiPermission(undefined, ['org.employee.view_all']), true)
})

test('legacy auth responses keep delegation creation hidden from employees', () => {
  assert.equal(allowsUiPermission(undefined, 'delegation.create', ['Employee']), false)
  assert.equal(allowsUiPermission(undefined, 'delegation.create', ['Manager']), true)
})

test('new auth responses continue enforcing the effective permission matrix', () => {
  assert.equal(allowsUiPermission([], 'config.permission.manage'), false)
  assert.equal(allowsUiPermission(['config.permission.manage'], 'config.permission.manage'), true)
  assert.equal(allowsAnyUiPermission(['org.employee.view_all'], ['org.employee.view_scoped', 'org.employee.view_all']), true)
  assert.equal(allowsAnyUiPermission([], ['org.employee.view_scoped', 'org.employee.view_all']), false)
})
