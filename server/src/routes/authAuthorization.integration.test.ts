import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before, beforeEach } from 'node:test'
import type { NextFunction, Request, Response } from 'express'
import type { HttpError } from '../types.js'

const directory = mkdtempSync(join(tmpdir(), 'hrm-auth-http-'))
process.env.HRM_DB_PATH = join(directory, 'auth-http.db')

const { db, initSchema } = await import('../db.js')
const { runMigrations } = await import('../services/migrationService.js')
const { ensureDefaultRolePermissions } = await import('../services/permissionService.js')
const { default: express } = await import('express')
const { default: jwt } = await import('jsonwebtoken')
const { default: bcrypt } = await import('bcryptjs')
const { authRouter } = await import('./auth.js')
const { configRouter } = await import('./config.js')

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
  insertUser('employee', ['Employee'])

  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRouter)
  app.use('/api/config', configRouter)
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
  db.prepare("UPDATE users SET is_active=1, roles='[\"Admin\"]' WHERE id='admin'").run()
  db.prepare("UPDATE users SET is_active=1, roles='[\"Employee\"]' WHERE id='employee'").run()
  db.prepare(`UPDATE role_feature_permissions SET allowed=1
    WHERE role='Employee' AND feature='requests.request' AND action='view_own'`).run()
})

function insertUser(id: string, roles: string[]): void {
  const employeeId = `employee-${id}`
  db.prepare(`INSERT INTO employees
    (id, employee_code, full_name, email, status, department_id, position_id, branch_id, hire_date)
    VALUES (?, ?, ?, ?, 2, 'department', 'position', 'branch', '2020-01-01')`)
    .run(employeeId, id, id, `${id}@example.test`)
  db.prepare(`INSERT INTO users
    (id, email, employee_id, password_hash, roles, permissions, department_scopes, is_active)
    VALUES (?, ?, ?, ?, ?, '["Delete"]', '[]', 1)`)
    .run(id, `${id}@example.test`, employeeId, bcrypt.hashSync('password123', 4), JSON.stringify(roles))
}

function token(id: string, roles: string[]): string {
  return jwt.sign({ id, roles, session_version: 1, token_type: 'access' }, process.env.JWT_SECRET || 'hrm-attendance-dev-secret-change-me', { expiresIn: '1h' })
}

test('protected routes reject missing and stale session versions but ignore authz-only changes', async () => {
  const secret = process.env.JWT_SECRET || 'hrm-attendance-dev-secret-change-me'
  const missingVersion = jwt.sign({ id: 'employee' }, secret, { expiresIn: '1h' })
  assert.equal((await fetch(`${baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${missingVersion}` } })).status, 401)

  const current = token('employee', ['Employee'])
  db.prepare("UPDATE users SET authz_version=authz_version+1 WHERE id='employee'").run()
  assert.equal((await fetch(`${baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${current}` } })).status, 200)

  db.prepare("UPDATE users SET session_version=session_version+1 WHERE id='employee'").run()
  assert.equal((await fetch(`${baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${current}` } })).status, 401)
})

test('login issues access and refresh tokens and password change invalidates both old tokens', async () => {
  db.prepare("UPDATE users SET session_version=1 WHERE id='employee'").run()
  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'employee@example.test', password: 'password123' }),
  })
  assert.equal(login.status, 200)
  const credentials = await login.json() as any
  assert.equal((jwt.decode(credentials.token) as any).session_version, 1)
  assert.equal((jwt.decode(credentials.refreshToken) as any).token_type, 'refresh')

  const changed = await fetch(`${baseUrl}/auth/change-password`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'password123', newPassword: 'password456', confirmPassword: 'password456' }),
  })
  assert.equal(changed.status, 200)
  assert.equal((db.prepare("SELECT session_version FROM users WHERE id='employee'").get() as any).session_version, 2)
  assert.equal((await fetch(`${baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${credentials.token}` } })).status, 401)
  assert.equal((await fetch(`${baseUrl}/auth/refresh`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: credentials.refreshToken }),
  })).status, 401)
})

test('an existing token is rejected immediately after users.is_active becomes false', async () => {
  const existingToken = token('employee', ['Employee'])
  db.prepare('UPDATE users SET is_active=0 WHERE id=?').run('employee')
  const response = await fetch(`${baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${existingToken}` } })
  assert.equal(response.status, 401)
})

test('stale Admin role in JWT cannot authorize config after the DB role is revoked', async () => {
  const staleAdminToken = token('admin', ['Admin'])
  db.prepare("UPDATE users SET roles='[\"Employee\"]' WHERE id='admin'").run()
  const response = await fetch(`${baseUrl}/config/roles/matrix`, { headers: { Authorization: `Bearer ${staleAdminToken}` } })
  assert.equal(response.status, 403)
})

test('/auth/me returns DB-fresh effective permissions and ignores users.permissions', async () => {
  const existingToken = token('employee', ['Admin'])
  const first = await fetch(`${baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${existingToken}` } })
  assert.equal(first.status, 200)
  const firstBody = await first.json() as any
  assert.equal(firstBody.effectivePermissions.includes('requests.request.view_own'), true)
  assert.equal(firstBody.effectivePermissions.includes('Delete'), false)

  db.prepare(`UPDATE role_feature_permissions SET allowed=0
    WHERE role='Employee' AND feature='requests.request' AND action='view_own'`).run()
  const refreshed = await fetch(`${baseUrl}/auth/me`, { headers: { Authorization: `Bearer ${existingToken}` } })
  const refreshedBody = await refreshed.json() as any
  assert.equal(refreshedBody.effectivePermissions.includes('requests.request.view_own'), false)
})

test('generic matrix endpoint rejects an incomplete payload with 400', async () => {
  const adminToken = token('admin', ['Admin'])
  const response = await fetch(`${baseUrl}/config/roles/matrix`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedVersion: 1, permissions: [] }),
  })
  assert.equal(response.status, 400)
})
