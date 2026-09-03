import assert from 'node:assert/strict'
import test from 'node:test'

import { countPermissionChanges, groupPermissionRows, matchesNormalizedSearch } from './rolePermissionUiUtils.ts'

const rows = [
  { key: 'requests.request.view_own', module: 'requests', label: 'Xem đơn của mình', roles: { Employee: true, Admin: true } },
  { key: 'requests.request.create_own', module: 'requests', label: 'Tạo đơn của mình', roles: { Employee: true, Admin: true } },
  { key: 'org.catalog.view', module: 'org', label: 'Xem danh mục tổ chức', roles: { Employee: false, Admin: true } },
]

test('groups permissions by module while preserving row order', () => {
  assert.deepEqual(
    groupPermissionRows(rows, '').map((group) => ({ module: group.module, label: group.label, keys: group.rows.map((row) => row.key) })),
    [
      { module: 'requests', label: 'Đơn từ', keys: ['requests.request.view_own', 'requests.request.create_own'] },
      { module: 'org', label: 'Tổ chức & nhân viên', keys: ['org.catalog.view'] },
    ],
  )
})

test('filters permissions by human label, technical key, or module label', () => {
  assert.deepEqual(groupPermissionRows(rows, 'tổ chức').flatMap((group) => group.rows.map((row) => row.key)), ['org.catalog.view'])
  assert.deepEqual(groupPermissionRows(rows, 'create_own').flatMap((group) => group.rows.map((row) => row.key)), ['requests.request.create_own'])
  assert.deepEqual(groupPermissionRows(rows, 'xem đơn').flatMap((group) => group.rows.map((row) => row.key)), ['requests.request.view_own'])
  assert.deepEqual(groupPermissionRows(rows, 'xem don').flatMap((group) => group.rows.map((row) => row.key)), ['requests.request.view_own'])
})

test('matches Vietnamese account text with an unaccented query', () => {
  assert.equal(matchesNormalizedSearch('Đặng Phương Anh · Nhân viên', 'dang phuong'), true)
})

test('counts each changed role checkbox', () => {
  const draft = rows.map((row) => ({ ...row, roles: { ...row.roles } }))
  draft[0].roles.Employee = false
  draft[2].roles.Employee = true

  assert.equal(countPermissionChanges(rows, draft), 2)
})
