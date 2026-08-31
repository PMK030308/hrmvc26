import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before, beforeEach } from 'node:test'
import type { NextFunction, Request, Response } from 'express'
import type { HttpError } from '../types.js'

const directory = mkdtempSync(join(tmpdir(), 'hrm-phase4-authz-'))
process.env.HRM_DB_PATH = join(directory, 'phase4.db')

const { db, initSchema } = await import('../db.js')
const { runMigrations } = await import('../services/migrationService.js')
const { ensureDefaultRolePermissions } = await import('../services/permissionService.js')
const { default: express } = await import('express')
const { default: jwt } = await import('jsonwebtoken')
const { auditRouter } = await import('./audit.js')
const { delegationRouter } = await import('./delegation.js')
const { notificationsRouter } = await import('./notifications.js')

let server: ReturnType<ReturnType<typeof express>['listen']>
let baseUrl = ''

before(async () => {
  initSchema()
  runMigrations(db)
  ensureDefaultRolePermissions()
  db.prepare('INSERT INTO branches (id, name, address) VALUES (?, ?, ?)').run('branch', 'Main', '')
  db.prepare('INSERT INTO departments (id, code, name) VALUES (?, ?, ?)').run('department', 'D', 'Department')
  db.prepare('INSERT INTO positions (id, code, name) VALUES (?, ?, ?)').run('position', 'EMP', 'Employee')
  insertUser('admin', ['Admin'])
  insertUser('manager', ['Manager'])
  insertUser('delegate', ['Manager'])
  insertUser('employee', ['Employee'])

  const app = express()
  app.use(express.json())
  app.use('/api/audit', auditRouter)
  app.use('/api/delegation', delegationRouter)
  app.use('/api/notifications', notificationsRouter)
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
  db.exec('DELETE FROM notifications; DELETE FROM delegations; DELETE FROM audit_logs;')
  db.prepare('UPDATE users SET is_active=1').run()
  db.prepare('DELETE FROM role_feature_permissions').run()
  ensureDefaultRolePermissions()
})

function insertUser(id: string, roles: string[]): void {
  const employeeId = `employee-${id}`
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

function setPermission(role: string, permission: string, allowed: boolean): void {
  const separator = permission.lastIndexOf('.')
  db.prepare(`INSERT INTO role_feature_permissions (role, feature, action, allowed, updated_at)
    VALUES (?, ?, ?, ?, '2026-08-30T00:00:00')
    ON CONFLICT(role, feature, action) DO UPDATE SET allowed=excluded.allowed`)
    .run(role, permission.slice(0, separator), permission.slice(separator + 1), allowed ? 1 : 0)
}

function auth(id: string): Record<string, string> {
  return { Authorization: `Bearer ${token(id)}` }
}

async function createDelegation(body: Record<string, unknown>) {
  return fetch(`${baseUrl}/delegation`, {
    method: 'POST',
    headers: { ...auth('manager'), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('mark-read returns hidden 404 for a foreign or missing notification', async () => {
  db.prepare(`INSERT INTO notifications
    (id, recipient_user_id, title, message, type, is_read, created_at)
    VALUES ('foreign-notification', 'employee', 'Private', 'Private', 1, 0, '2026-08-30T00:00:00')`).run()

  const foreign = await fetch(`${baseUrl}/notifications/mark-read/foreign-notification`, {
    method: 'POST', headers: auth('manager'),
  })
  assert.equal(foreign.status, 404)
  const missing = await fetch(`${baseUrl}/notifications/mark-read/missing-notification`, {
    method: 'POST', headers: auth('manager'),
  })
  assert.equal(missing.status, 404)
  assert.equal((db.prepare("SELECT is_read FROM notifications WHERE id='foreign-notification'").get() as any).is_read, 0)
})

test('audit requires DB-fresh audit.view instead of an Admin role name', async () => {
  setPermission('Admin', 'audit.view', false)
  const denied = await fetch(`${baseUrl}/audit`, { headers: auth('admin') })
  assert.equal(denied.status, 403)

  setPermission('Employee', 'audit.view', true)
  const allowed = await fetch(`${baseUrl}/audit`, { headers: auth('employee') })
  assert.equal(allowed.status, 200)
})

test('audit rejects invalid pagination and caps oversized page sizes', async () => {
  assert.equal((await fetch(`${baseUrl}/audit?page=0`, { headers: auth('admin') })).status, 400)
  assert.equal((await fetch(`${baseUrl}/audit?pageSize=-1`, { headers: auth('admin') })).status, 400)
  assert.equal((await fetch(`${baseUrl}/audit?pageSize=not-a-number`, { headers: auth('admin') })).status, 400)

  const oversized = await fetch(`${baseUrl}/audit?pageSize=10000`, { headers: auth('admin') })
  assert.equal(oversized.status, 200)
  const body = await oversized.json() as any
  assert.equal(body.pageSize, 100)
})

test('delegation create requires an effective permission, not a Manager role name', async () => {
  setPermission('Manager', 'delegation.create', false)
  const response = await createDelegation({
    delegateUserId: 'delegate', fromDate: '2026-09-01', toDate: '2026-09-05', reason: 'Annual leave',
  })
  assert.equal(response.status, 403)
  assert.equal((db.prepare('SELECT COUNT(*) count FROM delegations').get() as any).count, 0)
})

test('delegation create rejects an inactive delegate and overlapping active windows', async () => {
  setPermission('Manager', 'delegation.create', true)
  setPermission('Manager', 'requests.approval.approve_assigned', true)
  db.prepare("UPDATE users SET is_active=0 WHERE id='delegate'").run()
  const inactive = await createDelegation({
    delegateUserId: 'delegate', fromDate: '2026-09-01', toDate: '2026-09-05', reason: 'Annual leave',
  })
  assert.equal(inactive.status, 400)

  db.prepare("UPDATE users SET is_active=1 WHERE id='delegate'").run()
  db.prepare(`INSERT INTO delegations
    (id, delegator_user_id, delegate_user_id, from_date, to_date, reason, is_active, created_at)
    VALUES ('existing', 'manager', 'delegate', '2026-09-01', '2026-09-05', 'Existing', 1, '2026-08-30T00:00:00')`).run()
  const overlap = await createDelegation({
    delegateUserId: 'delegate', fromDate: '2026-09-05', toDate: '2026-09-10', reason: 'Overlap',
  })
  assert.equal(overlap.status, 409)
  assert.equal((db.prepare('SELECT COUNT(*) count FROM delegations').get() as any).count, 1)
})
