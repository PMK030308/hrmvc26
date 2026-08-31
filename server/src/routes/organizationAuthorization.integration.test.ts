import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before, beforeEach } from 'node:test'
import type { NextFunction, Request, Response } from 'express'
import type { HttpError } from '../types.js'

const directory = mkdtempSync(join(tmpdir(), 'hrm-org-authz-'))
process.env.HRM_DB_PATH = join(directory, 'organization.db')

const { db, initSchema } = await import('../db.js')
const { runMigrations } = await import('../services/migrationService.js')
const { ensureDefaultRolePermissions } = await import('../services/permissionService.js')
const { default: express } = await import('express')
const { default: jwt } = await import('jsonwebtoken')
const { orgRouter } = await import('./org.js')

let server: ReturnType<ReturnType<typeof express>['listen']>
let baseUrl = ''

before(async () => {
  initSchema()
  runMigrations(db)
  db.prepare('INSERT INTO branches (id, name, address) VALUES (?, ?, ?)').run('branch', 'Main', '')
  db.prepare('INSERT INTO departments (id, code, name, parent_id) VALUES (?, ?, ?, ?)').run('root', 'ROOT', 'Root', null)
  db.prepare('INSERT INTO departments (id, code, name, parent_id) VALUES (?, ?, ?, ?)').run('child', 'CHILD', 'Child', 'root')
  db.prepare('INSERT INTO departments (id, code, name, parent_id) VALUES (?, ?, ?, ?)').run('other', 'OTHER', 'Other', null)
  db.prepare('INSERT INTO positions (id, code, name) VALUES (?, ?, ?)').run('position', 'EMP', 'Employee')

  insertUser('manager', ['Manager'], 'root', ['root'])
  insertUser('global', ['Director'], 'other', [])
  insertUser('private', ['HR'], 'root', ['root'])
  insertUser('compensation', ['Accountant'], 'other', [])
  insertUser('admin', ['Admin'], 'root', [])
  insertUser('ordinary', ['Employee'], 'other', [])
  insertEmployee('child-employee', 'child', 'manager-employee')
  insertEmployee('report-employee', 'other', 'manager-employee')
  insertEmployee('outsider-employee', 'other', null)
  insertUserForEmployee('target-user', ['Employee'], 'child-employee')

  const app = express()
  app.use(express.json())
  app.use('/api/org', orgRouter)
  app.use((error: HttpError, _req: Request, res: Response, _next: NextFunction) => {
    res.status(error.status ?? 500).json({ message: error.message })
  })
  server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  baseUrl = `http://127.0.0.1:${address.port}/api`
})

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  db.close()
  delete process.env.HRM_DB_PATH
  rmSync(directory, { recursive: true, force: true })
})

beforeEach(() => {
  db.prepare('DELETE FROM audit_logs').run()
  db.prepare('DELETE FROM role_feature_permissions').run()
  ensureDefaultRolePermissions()
  db.prepare('UPDATE users SET is_active=1').run()
  db.prepare('UPDATE employees SET status=2').run()
})

function insertEmployee(id: string, departmentId: string, managerId: string | null): void {
  db.prepare(`INSERT INTO employees
    (id, employee_code, first_name, last_name, full_name, gender, date_of_birth, email, phone, address,
     marital_status, status, manager_id, department_id, position_id, branch_id, hire_date, work_nature, contract_type, wage)
    VALUES (?, ?, 'First', 'Last', ?, 1, '1990-01-02', ?, '0900000000', 'Private address',
      'Single', 2, ?, ?, 'position', 'branch', '2020-01-01', 1, 2, 25000000)`)
    .run(id, id, `Employee ${id}`, `${id}@example.test`, managerId, departmentId)
}

function insertUser(id: string, roles: string[], departmentId: string, scopes: string[]): void {
  const employeeId = `${id}-employee`
  insertEmployee(employeeId, departmentId, null)
  insertUserForEmployee(id, roles, employeeId, scopes)
}

function insertUserForEmployee(id: string, roles: string[], employeeId: string, scopes: string[] = []): void {
  db.prepare(`INSERT INTO users
    (id, email, employee_id, password_hash, roles, permissions, department_scopes, is_active)
    VALUES (?, ?, ?, 'hash', ?, '[]', ?, 1)`)
    .run(id, `${id}@example.test`, employeeId, JSON.stringify(roles), JSON.stringify(scopes))
}

function token(id: string): string {
  return jwt.sign({ id, roles: ['Admin'], session_version: 1, token_type: 'access' }, process.env.JWT_SECRET || 'hrm-attendance-dev-secret-change-me', { expiresIn: '1h' })
}

function auth(id: string): Record<string, string> {
  return { Authorization: `Bearer ${token(id)}` }
}

function setPermission(role: string, permission: string, allowed: boolean): void {
  const separator = permission.lastIndexOf('.')
  db.prepare(`INSERT INTO role_feature_permissions (role, feature, action, allowed, updated_at)
    VALUES (?, ?, ?, ?, '2026-08-30T00:00:00')
    ON CONFLICT(role, feature, action) DO UPDATE SET allowed=excluded.allowed`)
    .run(role, permission.slice(0, separator), permission.slice(separator + 1), allowed ? 1 : 0)
}

async function employeeList(actorId: string) {
  return fetch(`${baseUrl}/org/employees`, { headers: auth(actorId) })
}

test('scoped employee list is the union of department descendants and indirect reporting line', async () => {
  setPermission('Manager', 'org.employee.view_scoped', true)
  setPermission('Manager', 'org.employee.view_all', false)
  setPermission('Manager', 'org.employee.view_private', false)
  setPermission('Manager', 'org.employee.view_compensation', false)

  const response = await employeeList('manager')
  assert.equal(response.status, 200)
  const body = await response.json() as any[]
  const ids = body.map((employee) => employee.id)
  assert.equal(ids.includes('child-employee'), true)
  assert.equal(ids.includes('report-employee'), true)
  assert.equal(ids.includes('outsider-employee'), false)
  const projected = body.find((employee) => employee.id === 'child-employee')
  assert.equal('phone' in projected, false)
  assert.equal('address' in projected, false)
  assert.equal('dateOfBirth' in projected, false)
  assert.equal('wage' in projected, false)
})

test('empty department scope never becomes global and unrelated employee detail is hidden', async () => {
  setPermission('Manager', 'org.employee.view_scoped', true)
  db.prepare("UPDATE users SET department_scopes='[]' WHERE id='manager'").run()
  db.prepare("UPDATE employees SET manager_id=NULL WHERE id='outsider-employee'").run()

  const list = await employeeList('manager')
  assert.equal(list.status, 200)
  const body = await list.json() as any[]
  assert.equal(body.some((employee) => employee.id === 'outsider-employee'), false)
  const detail = await fetch(`${baseUrl}/org/employees/outsider-employee`, { headers: auth('manager') })
  assert.equal(detail.status, 404)
})

test('global access and field projections follow effective permissions rather than role names', async () => {
  setPermission('Admin', 'org.employee.view_all', false)
  assert.equal((await employeeList('admin')).status, 403)

  setPermission('Employee', 'org.employee.view_all', true)
  setPermission('Employee', 'org.employee.view_private', true)
  setPermission('Employee', 'org.employee.view_compensation', false)
  const response = await fetch(`${baseUrl}/org/employees/outsider-employee`, { headers: auth('ordinary') })
  assert.equal(response.status, 200)
  const body = await response.json() as any
  assert.equal(body.phone, '0900000000')
  assert.equal(body.address, 'Private address')
  assert.equal('wage' in body, false)
})

test('private and compensation projections are independent permissions', async () => {
  setPermission('HR', 'org.employee.view_scoped', true)
  setPermission('HR', 'org.employee.view_private', true)
  setPermission('HR', 'org.employee.view_compensation', false)
  const privateResponse = await fetch(`${baseUrl}/org/employees/child-employee`, { headers: auth('private') })
  const privateBody = await privateResponse.json() as any
  assert.equal(privateResponse.status, 200)
  assert.equal(privateBody.phone, '0900000000')
  assert.equal('wage' in privateBody, false)

  setPermission('Accountant', 'org.employee.view_all', true)
  setPermission('Accountant', 'org.employee.view_private', false)
  setPermission('Accountant', 'org.employee.view_compensation', true)
  const compensationResponse = await fetch(`${baseUrl}/org/employees/child-employee`, { headers: auth('compensation') })
  const compensationBody = await compensationResponse.json() as any
  assert.equal(compensationResponse.status, 200)
  assert.equal(compensationBody.wage, 25000000)
  assert.equal('phone' in compensationBody, false)
  assert.equal('address' in compensationBody, false)
})

test('catalog routes require org.catalog.view regardless of role name', async () => {
  setPermission('Admin', 'org.catalog.view', false)
  assert.equal((await fetch(`${baseUrl}/org/departments`, { headers: auth('admin') })).status, 403)
  setPermission('Employee', 'org.catalog.view', true)
  assert.equal((await fetch(`${baseUrl}/org/departments`, { headers: auth('ordinary') })).status, 200)
})

test('scoped manager can update descendants but cannot manage an out-of-scope employee or move outside scope', async () => {
  setPermission('HR', 'org.employee.manage_scoped', true)
  setPermission('HR', 'org.employee.manage_all', false)
  const allowed = await fetch(`${baseUrl}/org/employees/child-employee`, {
    method: 'PUT', headers: { ...auth('private'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '0911111111' }),
  })
  assert.equal(allowed.status, 200)

  const hidden = await fetch(`${baseUrl}/org/employees/outsider-employee`, {
    method: 'PUT', headers: { ...auth('private'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '0922222222' }),
  })
  assert.equal(hidden.status, 404)

  const moveOutside = await fetch(`${baseUrl}/org/employees/child-employee`, {
    method: 'PUT', headers: { ...auth('private'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ departmentId: 'other' }),
  })
  assert.equal(moveOutside.status, 404)
})

test('employee create validates references and uniqueness inside the authorized scope', async () => {
  setPermission('HR', 'org.employee.manage_scoped', true)
  const invalidReference = await fetch(`${baseUrl}/org/employees`, {
    method: 'POST', headers: { ...auth('private'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'New', lastName: 'Employee', departmentId: 'missing', positionId: 'position', email: 'new@example.test' }),
  })
  assert.equal(invalidReference.status, 400)

  const outsideScope = await fetch(`${baseUrl}/org/employees`, {
    method: 'POST', headers: { ...auth('private'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'New', lastName: 'Employee', departmentId: 'other', positionId: 'position', email: 'new@example.test' }),
  })
  assert.equal(outsideScope.status, 403)

  const duplicateCode = await fetch(`${baseUrl}/org/employees`, {
    method: 'POST', headers: { ...auth('private'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ employeeCode: 'child-employee', firstName: 'New', lastName: 'Employee', departmentId: 'child', positionId: 'position', email: 'unique@example.test' }),
  })
  assert.equal(duplicateCode.status, 409)
})

test('DELETE deactivates the employee and linked account without removing historical rows', async () => {
  setPermission('Admin', 'org.employee.manage_all', true)
  const response = await fetch(`${baseUrl}/org/employees/child-employee`, {
    method: 'DELETE', headers: auth('admin'),
  })
  assert.equal(response.status, 200)
  const employee = db.prepare("SELECT status FROM employees WHERE id='child-employee'").get() as any
  const user = db.prepare("SELECT is_active FROM users WHERE id='target-user'").get() as any
  assert.equal(employee.status, 4)
  assert.equal(user.is_active, 0)
  assert.ok(db.prepare("SELECT 1 FROM employees WHERE id='child-employee'").get())
  assert.equal((db.prepare("SELECT COUNT(*) count FROM audit_logs WHERE entity='Employee' AND entity_id='child-employee'").get() as any).count, 1)
})
