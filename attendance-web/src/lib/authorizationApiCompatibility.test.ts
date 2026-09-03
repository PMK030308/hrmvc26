import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizePermissionMatrixResponse, normalizeAuthorizationUser } from './authorizationApiCompatibility.ts'

test('keeps the new permission snapshot contract unchanged', () => {
  const current = { version: 3, permissions: [{ key: 'audit.view', module: 'audit', label: 'Audit', enforced: false, roles: { Admin: true } }] }
  assert.deepEqual(normalizePermissionMatrixResponse(current), current)
})

test('converts the legacy feature matrix into a read-only snapshot', () => {
  const result = normalizePermissionMatrixResponse([
    { feature: 'roles.manage', perms: [{ role: 'Admin', flags: ['View', 'Edit'] }, { role: 'HR', flags: ['View'] }] },
  ])

  assert.equal(result.readOnly, true)
  assert.equal(result.version, 0)
  assert.deepEqual(result.permissions.map((row) => row.key), ['roles.manage.view', 'roles.manage.edit'])
  assert.equal(result.permissions[0].roles.Admin, true)
  assert.equal(result.permissions[0].roles.HR, true)
  assert.equal(result.permissions[1].roles.HR, false)
  assert.equal(result.permissions[0].enforced, false)
})

test('fills fields absent from legacy authorization users', () => {
  const user = normalizeAuthorizationUser({ id: 'u1', email: 'admin@test.vn', employeeId: 'e1', roles: ['Admin'], permissions: ['View'], departmentScopes: [] })
  assert.equal(user.isActive, true)
  assert.equal(user.authorizationVersion, 1)
})

