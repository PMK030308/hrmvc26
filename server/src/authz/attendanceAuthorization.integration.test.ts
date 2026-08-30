import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before, beforeEach } from 'node:test'

const directory = mkdtempSync(join(tmpdir(), 'hrm-attendance-authz-'))
process.env.HRM_DB_PATH = join(directory, 'attendance-authz.db')

const { db, initSchema } = await import('../db.js')
const { runMigrations } = await import('../services/migrationService.js')
const { loadAuthorizationActor } = await import('./authorizationActor.js')
const { ATTENDANCE_PERMISSIONS, canProxyPunch, canViewAttendance } = await import('./attendanceAuthorization.js')
const { SHIFT_PERMISSIONS, canManageShiftSchedule, canViewShiftSchedule } = await import('./shiftAuthorization.js')

before(() => {
  initSchema()
  runMigrations(db)
  db.prepare('INSERT INTO branches (id, name, address) VALUES (?, ?, ?)').run('branch', 'Main', '')
  db.prepare('INSERT INTO positions (id, code, name) VALUES (?, ?, ?)').run('position', 'EMP', 'Employee')
  db.prepare('INSERT INTO departments (id, code, name, parent_id) VALUES (?, ?, ?, ?)').run('root', 'ROOT', 'Root', null)
  db.prepare('INSERT INTO departments (id, code, name, parent_id) VALUES (?, ?, ?, ?)').run('child', 'CHILD', 'Child', 'root')
  db.prepare('INSERT INTO departments (id, code, name, parent_id) VALUES (?, ?, ?, ?)').run('other', 'OTHER', 'Other', null)
  insertEmployee('manager', 'other', null)
  insertEmployee('direct', 'other', 'manager')
  insertEmployee('indirect', 'other', 'direct')
  insertEmployee('department-target', 'child', null)
  insertEmployee('outsider', 'other', null)
  db.prepare(`INSERT INTO users
    (id, email, employee_id, password_hash, roles, permissions, department_scopes, is_active)
    VALUES ('actor', 'actor@example.test', 'manager', 'hash', ?, '[]', ?, 1)`)
    .run(JSON.stringify(['Manager']), JSON.stringify(['root']))
})

after(() => {
  db.close()
  delete process.env.HRM_DB_PATH
  rmSync(directory, { recursive: true, force: true })
})

beforeEach(() => {
  db.prepare('DELETE FROM role_feature_permissions').run()
  db.prepare('UPDATE users SET department_scopes=? WHERE id=?').run(JSON.stringify(['root']), 'actor')
})

function insertEmployee(id: string, departmentId: string, managerId: string | null): void {
  db.prepare(`INSERT INTO employees
    (id, employee_code, full_name, email, status, manager_id, department_id, position_id, branch_id, hire_date)
    VALUES (?, ?, ?, ?, 2, ?, ?, 'position', 'branch', '2020-01-01')`)
    .run(id, id, id, `${id}@example.test`, managerId, departmentId)
}

function allow(permission: string): void {
  const split = permission.lastIndexOf('.')
  db.prepare(`INSERT INTO role_feature_permissions (role, feature, action, allowed, updated_at)
    VALUES ('Manager', ?, ?, 1, '2026-08-30T00:00:00')`).run(permission.slice(0, split), permission.slice(split + 1))
}

function employee(id: string): { id: string; departmentId: string } {
  const row = db.prepare('SELECT id, department_id FROM employees WHERE id=?').get(id) as any
  return { id: row.id, departmentId: row.department_id }
}

test('scoped attendance access is the union of descendant department scope and direct/indirect reporting line', () => {
  allow(ATTENDANCE_PERMISSIONS.VIEW_SCOPED)
  const actor = loadAuthorizationActor('actor')

  assert.deepEqual([...actor.permissions], [ATTENDANCE_PERMISSIONS.VIEW_SCOPED])
  assert.deepEqual(actor.departmentScopes.sort(), ['child', 'root'])
  assert.equal(canViewAttendance(actor, employee('department-target')), true)
  assert.equal(canViewAttendance(actor, employee('direct')), true)
  assert.equal(canViewAttendance(actor, employee('indirect')), true)
  assert.equal(canViewAttendance(actor, employee('outsider')), false)
})

test('empty department scope denies department access but reporting line remains independently effective', () => {
  allow(ATTENDANCE_PERMISSIONS.VIEW_SCOPED)
  db.prepare('UPDATE users SET department_scopes=? WHERE id=?').run(JSON.stringify([]), 'actor')
  const actor = loadAuthorizationActor('actor')

  assert.equal(canViewAttendance(actor, employee('department-target')), false)
  assert.equal(canViewAttendance(actor, employee('indirect')), true)
  assert.equal(canViewAttendance(actor, employee('outsider')), false)
})

test('view_all is global while role name and scope without permission grant nothing', () => {
  let actor = loadAuthorizationActor('actor')
  assert.equal(canViewAttendance(actor, employee('department-target')), false)
  assert.equal(canViewAttendance(actor, employee('indirect')), false)

  allow(ATTENDANCE_PERMISSIONS.VIEW_ALL)
  actor = loadAuthorizationActor('actor')
  assert.equal(canViewAttendance(actor, employee('outsider')), true)
})

test('proxy punch requires its own permission, effective scope, and a different target employee', () => {
  let actor = loadAuthorizationActor('actor')
  assert.equal(canProxyPunch(actor, employee('direct')), false)

  allow(ATTENDANCE_PERMISSIONS.PROXY_PUNCH)
  actor = loadAuthorizationActor('actor')
  assert.equal(canProxyPunch(actor, employee('direct')), true)
  assert.equal(canProxyPunch(actor, employee('department-target')), true)
  assert.equal(canProxyPunch(actor, employee('outsider')), false)
  assert.equal(canProxyPunch(actor, employee('manager')), false)
})

test('shift view/manage uses explicit permissions and the same effective scope semantics', () => {
  allow(SHIFT_PERMISSIONS.SCHEDULE_VIEW_SCOPED)
  allow(SHIFT_PERMISSIONS.SCHEDULE_MANAGE_SCOPED)
  let actor = loadAuthorizationActor('actor')
  assert.equal(canViewShiftSchedule(actor, employee('department-target')), true)
  assert.equal(canViewShiftSchedule(actor, employee('indirect')), true)
  assert.equal(canManageShiftSchedule(actor, employee('outsider')), false)

  db.prepare('DELETE FROM role_feature_permissions').run()
  allow(SHIFT_PERMISSIONS.SCHEDULE_VIEW_ALL)
  allow(SHIFT_PERMISSIONS.SCHEDULE_MANAGE_ALL)
  actor = loadAuthorizationActor('actor')
  assert.equal(canViewShiftSchedule(actor, employee('outsider')), true)
  assert.equal(canManageShiftSchedule(actor, employee('outsider')), true)
})
