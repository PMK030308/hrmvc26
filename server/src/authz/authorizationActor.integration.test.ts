import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before } from 'node:test'

const directory = mkdtempSync(join(tmpdir(), 'hrm-shared-authz-'))
process.env.HRM_DB_PATH = join(directory, 'actor.db')

const { db, initSchema } = await import('../db.js')
const { runMigrations } = await import('../services/migrationService.js')
const { ensureDefaultRolePermissions } = await import('../services/permissionService.js')
const { hasPermission, loadAuthorizationActor, matchesDepartmentScope } = await import('./authorizationActor.js')

before(() => {
  initSchema()
  runMigrations(db)
  ensureDefaultRolePermissions()
  db.prepare('INSERT INTO branches (id, name, address) VALUES (?, ?, ?)').run('branch', 'Main', '')
  db.prepare('INSERT INTO departments (id, code, name) VALUES (?, ?, ?)').run('parent', 'P', 'Parent')
  db.prepare('INSERT INTO departments (id, code, name, parent_id) VALUES (?, ?, ?, ?)').run('child', 'C', 'Child', 'parent')
  db.prepare('INSERT INTO positions (id, code, name) VALUES (?, ?, ?)').run('position', 'EMP', 'Employee')
})

after(() => {
  db.close()
  delete process.env.HRM_DB_PATH
  rmSync(directory, { recursive: true, force: true })
})

function insertPrincipal(id: string, status: number, isActive: number, roles: string[], scopes: string[] = [], legacyPermissions = ['Delete']): void {
  const employeeId = `employee-${id}`
  db.prepare(`INSERT INTO employees
    (id, employee_code, full_name, email, status, department_id, position_id, branch_id, hire_date)
    VALUES (?, ?, ?, ?, ?, 'child', 'position', 'branch', '2020-01-01')`)
    .run(employeeId, id.toUpperCase(), id, `${id}@example.test`, status)
  db.prepare(`INSERT INTO users
    (id, email, employee_id, password_hash, roles, permissions, department_scopes, is_active)
    VALUES (?, ?, ?, 'hash', ?, ?, ?, ?)`)
    .run(id, `${id}@example.test`, employeeId, JSON.stringify(roles), JSON.stringify(legacyPermissions), JSON.stringify(scopes), isActive)
}

test('actor authority is DB-fresh, merges roles with allow-only OR, and ignores users.permissions', () => {
  insertPrincipal('multi-role', 2, 1, ['Employee', 'HR'])
  const first = loadAuthorizationActor('multi-role')
  assert.equal(hasPermission(first, 'requests.request.modify_own'), true)
  assert.equal(hasPermission(first, 'requests.request.view_scoped'), true)
  assert.equal(hasPermission(first, 'Delete'), false)

  db.prepare(`UPDATE role_feature_permissions SET allowed=0
    WHERE role IN ('Employee', 'HR') AND feature='requests.request' AND action='modify_own'`).run()
  const refreshed = loadAuthorizationActor('multi-role')
  assert.equal(hasPermission(refreshed, 'requests.request.modify_own'), false)
})

test('disabled, resigned, and terminated principals are rejected even with an existing JWT identity', () => {
  insertPrincipal('disabled', 2, 0, ['Employee'])
  insertPrincipal('resigned', 4, 1, ['Employee'])
  insertPrincipal('terminated', 5, 1, ['Employee'])
  for (const id of ['disabled', 'resigned', 'terminated']) {
    assert.throws(() => loadAuthorizationActor(id), (error: any) => error?.status === 401)
  }
})

test('probation and on-leave principals remain active under the approved mapping', () => {
  insertPrincipal('probation', 1, 1, ['Employee'])
  insertPrincipal('on-leave', 3, 1, ['Employee'])
  assert.equal(loadAuthorizationActor('probation').isActive, true)
  assert.equal(loadAuthorizationActor('on-leave').isActive, true)
})

test('empty department scope denies and a parent scope includes descendants', () => {
  insertPrincipal('empty-scope', 2, 1, ['HR'])
  insertPrincipal('parent-scope', 2, 1, ['HR'], ['parent'])
  assert.equal(matchesDepartmentScope(loadAuthorizationActor('empty-scope'), 'child'), false)
  assert.equal(matchesDepartmentScope(loadAuthorizationActor('parent-scope'), 'child'), true)
  assert.equal(matchesDepartmentScope(loadAuthorizationActor('parent-scope'), 'missing'), false)
})
