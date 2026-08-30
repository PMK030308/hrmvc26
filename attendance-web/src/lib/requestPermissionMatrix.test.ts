import assert from 'node:assert/strict'
import test from 'node:test'
import { togglePermission, toggleRequestPermission } from './requestPermissionMatrix.js'
import type { PermissionMatrixEntry } from '../types/index.js'

const matrix: RequestPermissionMatrixRow[] = [
  {
    permission: 'requests.request.view_own',
    roles: {
      Guest: false,
      Employee: true,
      Manager: true,
      Accountant: true,
      HR: true,
      Director: true,
      Admin: true,
    },
  },
  {
    permission: 'requests.request.view_all',
    roles: {
      Guest: false,
      Employee: false,
      Manager: false,
      Accountant: false,
      HR: false,
      Director: false,
      Admin: true,
    },
  },
]

test('toggleRequestPermission only changes the selected role and permission', () => {
  const next = toggleRequestPermission(matrix, 'requests.request.view_all', 'HR')

  assert.equal(next[1]?.roles.HR, true)
  assert.equal(next[1]?.roles.Admin, true)
  assert.deepEqual(next[0], matrix[0])
})

test('toggleRequestPermission keeps the source matrix immutable', () => {
  const next = toggleRequestPermission(matrix, 'requests.request.view_own', 'Guest')

  assert.notEqual(next, matrix)
  assert.notEqual(next[0], matrix[0])
  assert.equal(matrix[0]?.roles.Guest, false)
  assert.equal(next[0]?.roles.Guest, true)
})

const genericMatrix: PermissionMatrixEntry[] = [
  { key: 'requests.request.view_own', module: 'requests', label: 'View own', enforced: true, roles: matrix[0]!.roles },
  { key: 'attendance.punch.own', module: 'attendance', label: 'Punch', enforced: false, roles: matrix[1]!.roles },
]

test('generic matrix toggles enforced permissions immutably', () => {
  const next = togglePermission(genericMatrix, 'requests.request.view_own', 'Guest')
  assert.equal(next[0]?.roles.Guest, true)
  assert.equal(genericMatrix[0]?.roles.Guest, false)
})

test('generic matrix refuses to toggle permissions not yet enforced by backend', () => {
  const next = togglePermission(genericMatrix, 'attendance.punch.own', 'HR')
  assert.deepEqual(next, genericMatrix)
})
