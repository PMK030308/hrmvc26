import assert from 'node:assert/strict'
import test from 'node:test'
import { organizationCapabilities } from './organizationCapabilities.js'

test('employee actions follow effective permissions rather than role names', () => {
  const denied = organizationCapabilities([])
  assert.equal(denied.canViewEmployees, false)
  assert.equal(denied.canManageEmployees, false)

  const scoped = organizationCapabilities(['org.employee.view_scoped', 'org.employee.manage_scoped'])
  assert.equal(scoped.canViewEmployees, true)
  assert.equal(scoped.canManageEmployees, true)
})

test('private and compensation projections remain independent', () => {
  const privateOnly = organizationCapabilities(['org.employee.view_all', 'org.employee.view_private'])
  assert.equal(privateOnly.canViewPrivate, true)
  assert.equal(privateOnly.canViewCompensation, false)

  const compensationOnly = organizationCapabilities(['org.employee.view_all', 'org.employee.view_compensation'])
  assert.equal(compensationOnly.canViewPrivate, false)
  assert.equal(compensationOnly.canViewCompensation, true)
})

test('delegation and admin capabilities use backend permission keys', () => {
  const capabilities = organizationCapabilities([
    'delegation.create', 'delegation.revoke_any', 'delegation.view_all',
    'config.regulation.view', 'audit.view', 'system.demo_reset',
  ])
  assert.equal(capabilities.canCreateDelegation, true)
  assert.equal(capabilities.canRevokeAnyDelegation, true)
  assert.equal(capabilities.canViewAllDelegations, true)
  assert.equal(capabilities.canViewRegulations, true)
  assert.equal(capabilities.canViewAudit, true)
  assert.equal(capabilities.canResetDemo, true)
})
