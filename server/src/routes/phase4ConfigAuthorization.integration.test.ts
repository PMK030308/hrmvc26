import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before, beforeEach } from 'node:test'
import type { NextFunction, Request, Response } from 'express'
import type { HttpError } from '../types.js'

const directory = mkdtempSync(join(tmpdir(), 'hrm-phase4-config-'))
process.env.HRM_DB_PATH = join(directory, 'config.db')

const { db, initSchema } = await import('../db.js')
const { runMigrations } = await import('../services/migrationService.js')
const { ensureDefaultRolePermissions } = await import('../services/permissionService.js')
const { default: express } = await import('express')
const { default: jwt } = await import('jsonwebtoken')
const { configRouter } = await import('./config.js')
const { dashboardRouter } = await import('./dashboard.js')

let server: ReturnType<ReturnType<typeof express>['listen']>
let baseUrl = ''

before(async () => {
  initSchema()
  runMigrations(db)
  db.prepare('INSERT INTO branches (id, name, address) VALUES (?, ?, ?)').run('branch', 'Main', '')
  db.prepare('INSERT INTO departments (id, code, name) VALUES (?, ?, ?)').run('department', 'D', 'Department')
  db.prepare('INSERT INTO positions (id, code, name) VALUES (?, ?, ?)').run('position', 'EMP', 'Employee')
  insertUser('admin', ['Admin'])
  insertUser('hr', ['HR'])
  insertUser('manager', ['Manager'])
  insertUser('employee', ['Employee'])
  db.prepare('INSERT INTO regulation (id, enable_punch_face) VALUES (?, ?)').run('regulation', 1)
  db.prepare(`INSERT INTO leave_types
    (id, name, category, fund_type, max_days, require_attachment, require_reason, day_calculation_type)
    VALUES ('annual', 'Annual leave', 1, 1, 12, 0, 1, 1)`).run()

  const app = express()
  app.use(express.json())
  app.use('/api/config', configRouter)
  app.use('/api/dashboard', dashboardRouter)
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
  db.prepare('DELETE FROM role_feature_permissions').run()
  ensureDefaultRolePermissions()
  db.prepare('DELETE FROM audit_logs').run()
  db.prepare('DELETE FROM gps_catalog').run()
  db.prepare('UPDATE regulation SET enable_punch_face=1 WHERE id=?').run('regulation')
  db.prepare("UPDATE users SET is_active=1 WHERE id IN ('admin','hr','manager','employee')").run()
})

function insertUser(id: string, roles: string[]): void {
  const employeeId = `${id}-employee`
  db.prepare(`INSERT INTO employees
    (id, employee_code, full_name, email, status, department_id, position_id, branch_id, hire_date)
    VALUES (?, ?, ?, ?, 2, 'department', 'position', 'branch', '2020-01-01')`)
    .run(employeeId, id, id, `${id}@example.test`)
  db.prepare(`INSERT INTO users
    (id, email, employee_id, password_hash, roles, permissions, department_scopes, is_active)
    VALUES (?, ?, ?, 'hash', ?, '[]', '[]', 1)`)
    .run(id, `${id}@example.test`, employeeId, JSON.stringify(roles))
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

test('regulation read and manage use DB-fresh permissions instead of role names', async () => {
  setPermission('Manager', 'config.regulation.view', false)
  assert.equal((await fetch(`${baseUrl}/config/regulations/attendance`, { headers: auth('manager') })).status, 403)

  setPermission('Employee', 'config.regulation.view', true)
  assert.equal((await fetch(`${baseUrl}/config/regulations/attendance`, { headers: auth('employee') })).status, 200)

  setPermission('HR', 'config.regulation.manage', false)
  const denied = await fetch(`${baseUrl}/config/regulations/attendance`, {
    method: 'PUT', headers: { ...auth('hr'), 'Content-Type': 'application/json' }, body: JSON.stringify({ enablePunchFace: false }),
  })
  assert.equal(denied.status, 403)

  setPermission('Employee', 'config.regulation.manage', true)
  const allowed = await fetch(`${baseUrl}/config/regulations/attendance`, {
    method: 'PUT', headers: { ...auth('employee'), 'Content-Type': 'application/json' }, body: JSON.stringify({ enablePunchFace: false }),
  })
  assert.equal(allowed.status, 200)
})

test('regulation update validates catalogs and rolls back dependent writes atomically', async () => {
  setPermission('HR', 'config.regulation.manage', true)
  const response = await fetch(`${baseUrl}/config/regulations/attendance`, {
    method: 'PUT', headers: { ...auth('hr'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ enablePunchFace: false, gpsCatalog: [{ name: 'Broken GPS', lng: 106.7, radiusMeters: 50 }] }),
  })
  assert.equal(response.status, 400)
  assert.equal((db.prepare("SELECT enable_punch_face FROM regulation WHERE id='regulation'").get() as any).enable_punch_face, 1)
  assert.equal((db.prepare('SELECT COUNT(*) count FROM gps_catalog').get() as any).count, 0)
})

test('leave type read and manage use explicit permissions', async () => {
  setPermission('HR', 'config.leave_type.view', false)
  assert.equal((await fetch(`${baseUrl}/config/leave-types`, { headers: auth('hr') })).status, 403)

  setPermission('Employee', 'config.leave_type.view', true)
  assert.equal((await fetch(`${baseUrl}/config/leave-types`, { headers: auth('employee') })).status, 200)

  setPermission('HR', 'config.leave_type.manage', false)
  const denied = await fetch(`${baseUrl}/config/leave-types/annual`, {
    method: 'PUT', headers: { ...auth('hr'), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Changed' }),
  })
  assert.equal(denied.status, 403)
})

test('user creation rejects duplicate email and an employee already linked to an account', async () => {
  setPermission('Admin', 'config.user.manage', true)
  const duplicateEmail = await fetch(`${baseUrl}/config/roles/users`, {
    method: 'POST', headers: { ...auth('admin'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'employee@example.test', employeeId: 'manager-employee', roles: ['Employee'] }),
  })
  assert.equal(duplicateEmail.status, 409)

  const linkedEmployee = await fetch(`${baseUrl}/config/roles/users`, {
    method: 'POST', headers: { ...auth('admin'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'new-account@example.test', employeeId: 'manager-employee', roles: ['Employee'] }),
  })
  assert.equal(linkedEmployee.status, 409)
})

test('dashboard omits embedded audit activity without audit.view and includes it when granted', async () => {
  db.prepare(`INSERT INTO audit_logs
    (id, user_id, user_name, action, entity, detail, created_at)
    VALUES ('audit', 'admin', 'Admin', 2, 'Secret', 'Sensitive audit detail', '2026-08-30T00:00:00')`).run()
  setPermission('HR', 'audit.view', false)
  const hidden = await fetch(`${baseUrl}/dashboard/admin`, { headers: auth('hr') })
  assert.equal(hidden.status, 200)
  const hiddenBody = await hidden.json() as any
  assert.deepEqual(hiddenBody.activityFeed, [])

  setPermission('HR', 'audit.view', true)
  const visible = await fetch(`${baseUrl}/dashboard/admin`, { headers: auth('hr') })
  const visibleBody = await visible.json() as any
  assert.equal(visible.status, 200)
  assert.equal(visibleBody.activityFeed[0].title, 'Sensitive audit detail')
})
