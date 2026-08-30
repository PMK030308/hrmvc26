import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before, beforeEach } from 'node:test'

const directory = mkdtempSync(join(tmpdir(), 'hrm-authz-management-'))
process.env.HRM_DB_PATH = join(directory, 'management.db')

const { db, initSchema } = await import('../db.js')
const { runMigrations } = await import('./migrationService.js')
const {
  applyEmployeeStatusAuthorizationChange,
  ensureDefaultRolePermissions,
  getPermissionMatrixSnapshot,
  replacePermissionMatrix,
  updateAuthorizationUser,
} = await import('./permissionService.js')

before(() => {
  initSchema()
  runMigrations(db)
  ensureDefaultRolePermissions()
  db.prepare('INSERT INTO branches (id, name, address) VALUES (?, ?, ?)').run('branch', 'Main', '')
  db.prepare('INSERT INTO departments (id, code, name) VALUES (?, ?, ?)').run('department', 'D', 'Department')
  db.prepare('INSERT INTO positions (id, code, name) VALUES (?, ?, ?)').run('position', 'EMP', 'Employee')
})

after(() => {
  db.close()
  delete process.env.HRM_DB_PATH
  rmSync(directory, { recursive: true, force: true })
})

beforeEach(() => {
  db.exec('DELETE FROM audit_logs; DELETE FROM users; DELETE FROM employees;')
  db.prepare('UPDATE permission_matrix_state SET version=1 WHERE id=1').run()
  db.prepare('DELETE FROM role_feature_permissions').run()
  ensureDefaultRolePermissions()
  insertAdmin('admin-one')
})

function insertAdmin(id: string): void {
  const employeeId = `employee-${id}`
  db.prepare(`INSERT INTO employees
    (id, employee_code, full_name, email, status, department_id, position_id, branch_id, hire_date)
    VALUES (?, ?, ?, ?, 2, 'department', 'position', 'branch', '2020-01-01')`)
    .run(employeeId, id, id, `${id}@example.test`)
  db.prepare(`INSERT INTO users
    (id, email, employee_id, password_hash, roles, permissions, department_scopes, is_active, authz_version)
    VALUES (?, ?, ?, 'hash', '["Admin"]', '[]', '[]', 1, 1)`)
    .run(id, `${id}@example.test`, employeeId)
}

test('last active permission manager cannot be disabled or stripped of its managing role', () => {
  assert.throws(
    () => updateAuthorizationUser({ actorId: 'admin-one', targetUserId: 'admin-one', roles: ['Employee'], isActive: true, departmentScopes: [], expectedVersion: 1 }),
    (error: any) => error?.status === 409,
  )
  assert.throws(
    () => updateAuthorizationUser({ actorId: 'admin-one', targetUserId: 'admin-one', roles: ['Admin'], isActive: false, departmentScopes: [], expectedVersion: 1 }),
    (error: any) => error?.status === 409,
  )
  const row = db.prepare('SELECT roles, is_active, authz_version FROM users WHERE id=?').get('admin-one') as any
  assert.equal(row.roles, '["Admin"]')
  assert.equal(row.is_active, 1)
  assert.equal(row.authz_version, 1)
})

test('last permission manager is determined by effective permission, not the Admin role name', () => {
  db.prepare(`UPDATE role_feature_permissions SET allowed=CASE WHEN role='Employee' THEN 1 ELSE 0 END
    WHERE feature='config.permission' AND action='manage'`).run()
  db.prepare(`UPDATE role_feature_permissions SET allowed=CASE WHEN role='Employee' THEN 1 ELSE 0 END
    WHERE feature='config.user' AND action='manage'`).run()
  db.prepare("UPDATE users SET roles='[\"Employee\"]' WHERE id='admin-one'").run()

  assert.throws(
    () => updateAuthorizationUser({ actorId: 'admin-one', targetUserId: 'admin-one', roles: ['Employee'], isActive: false, departmentScopes: [], expectedVersion: 1 }),
    (error: any) => error?.status === 409,
  )
})

test('user authorization updates are versioned and preserve an active manager', () => {
  insertAdmin('admin-two')
  const updated = updateAuthorizationUser({ actorId: 'admin-one', targetUserId: 'admin-two', roles: ['Employee'], isActive: true, departmentScopes: [], expectedVersion: 1 })
  assert.equal(updated.authorizationVersion, 2)
  assert.throws(
    () => updateAuthorizationUser({ actorId: 'admin-one', targetUserId: 'admin-two', roles: ['HR'], isActive: true, departmentScopes: [], expectedVersion: 1 }),
    (error: any) => error?.status === 409,
  )
})

test('serialized concurrent Admin disable attempts leave one active permission manager', () => {
  insertAdmin('admin-two')
  const first = updateAuthorizationUser({
    actorId: 'admin-two', targetUserId: 'admin-one', roles: ['Admin'], isActive: false,
    departmentScopes: [], expectedVersion: 1,
  })
  assert.equal(first.isActive, false)
  assert.throws(
    () => updateAuthorizationUser({ actorId: 'admin-two', targetUserId: 'admin-two', roles: ['Admin'], isActive: false, departmentScopes: [], expectedVersion: 1 }),
    (error: any) => error?.status === 409,
  )
  const activeManagers = (db.prepare("SELECT COUNT(*) count FROM users WHERE is_active=1 AND roles LIKE '%Admin%'").get() as any).count
  assert.equal(activeManagers, 1)
})

test('resigning the employee behind the last active permission manager is rejected', () => {
  assert.throws(
    () => applyEmployeeStatusAuthorizationChange('employee-admin-one', 2, 4),
    (error: any) => error?.status === 409,
  )
  insertAdmin('admin-two')
  const before = (db.prepare("SELECT authz_version FROM users WHERE id='admin-one'").get() as any).authz_version
  assert.doesNotThrow(() => applyEmployeeStatusAuthorizationChange('employee-admin-one', 2, 4))
  const after = (db.prepare("SELECT authz_version FROM users WHERE id='admin-one'").get() as any).authz_version
  assert.equal(after, before + 1)
})

test('matrix save uses optimistic locking and atomically preserves the last permission manager', () => {
  const original = getPermissionMatrixSnapshot()
  const edited = original.permissions.map((row) => ({ ...row, roles: { ...row.roles } }))
  const viewOwn = edited.find((row) => row.key === 'requests.request.view_own')!
  viewOwn.roles.Employee = !viewOwn.roles.Employee

  const saved = replacePermissionMatrix({ expectedVersion: original.version, permissions: edited }, 'admin-one')
  assert.equal(saved.version, original.version + 1)
  assert.equal((db.prepare("SELECT authz_version FROM users WHERE id='admin-one'").get() as any).authz_version, 2)
  assert.throws(
    () => replacePermissionMatrix({ expectedVersion: original.version, permissions: edited }, 'admin-one'),
    (error: any) => error?.status === 409,
  )

  const beforeRejected = getPermissionMatrixSnapshot()
  const revokeManager = beforeRejected.permissions.map((row) => ({ ...row, roles: { ...row.roles } }))
  const manage = revokeManager.find((row) => row.key === 'config.permission.manage')!
  for (const role of Object.keys(manage.roles)) manage.roles[role as keyof typeof manage.roles] = false
  const auditCount = (db.prepare('SELECT COUNT(*) count FROM audit_logs').get() as any).count
  assert.throws(
    () => replacePermissionMatrix({ expectedVersion: beforeRejected.version, permissions: revokeManager }, 'admin-one'),
    (error: any) => error?.status === 409,
  )
  assert.equal(getPermissionMatrixSnapshot().version, beforeRejected.version)
  assert.equal((db.prepare('SELECT COUNT(*) count FROM audit_logs').get() as any).count, auditCount)
})

test('default permission seeding is additive and does not overwrite Admin changes', () => {
  db.prepare(`UPDATE role_feature_permissions SET allowed=0
    WHERE role='Admin' AND feature='requests.request' AND action='view_all'`).run()
  ensureDefaultRolePermissions()
  const row = db.prepare(`SELECT allowed FROM role_feature_permissions
    WHERE role='Admin' AND feature='requests.request' AND action='view_all'`).get() as any
  assert.equal(row.allowed, 0)
})

test('permissions not yet enforced cannot be edited through the generic matrix', () => {
  const snapshot = getPermissionMatrixSnapshot()
  const edited = snapshot.permissions.map((row) => ({ ...row, roles: { ...row.roles } }))
  const futurePermission = edited.find((row) => !row.enforced)!
  futurePermission.roles.Admin = !futurePermission.roles.Admin
  assert.throws(
    () => replacePermissionMatrix({ expectedVersion: snapshot.version, permissions: edited }, 'admin-one'),
    (error: any) => error?.status === 400,
  )
})
