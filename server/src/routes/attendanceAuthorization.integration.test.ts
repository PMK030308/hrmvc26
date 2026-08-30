import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before, beforeEach } from 'node:test'
import type { NextFunction, Request, Response } from 'express'
import type { HttpError } from '../types.js'

const directory = mkdtempSync(join(tmpdir(), 'hrm-attendance-routes-'))
process.env.HRM_DB_PATH = join(directory, 'attendance-routes.db')

const { db, initSchema } = await import('../db.js')
const { runMigrations } = await import('../services/migrationService.js')
const { default: express } = await import('express')
const { default: jwt } = await import('jsonwebtoken')
const { attendanceRouter } = await import('./attendance.js')
const { authenticateAttendanceDevice, createAttendanceDevice, revokeAttendanceDevice, rotateAttendanceDeviceCredential } = await import('../services/deviceAuthService.js')

let server: ReturnType<ReturnType<typeof express>['listen']>
let baseUrl = ''

before(async () => {
  initSchema()
  runMigrations(db)
  db.prepare('INSERT INTO branches (id, name, address) VALUES (?, ?, ?)').run('branch', 'Main', '')
  db.prepare('INSERT INTO positions (id, code, name) VALUES (?, ?, ?)').run('position', 'EMP', 'Employee')
  db.prepare('INSERT INTO departments (id, code, name) VALUES (?, ?, ?)').run('scope', 'S', 'Scope')
  db.prepare('INSERT INTO departments (id, code, name) VALUES (?, ?, ?)').run('other', 'O', 'Other')
  insertEmployee('actor-employee', 'scope')
  insertEmployee('target', 'scope')
  insertEmployee('outsider', 'other')
  db.prepare(`INSERT INTO users
    (id, email, employee_id, password_hash, roles, permissions, department_scopes, is_active)
    VALUES ('actor', 'actor@example.test', 'actor-employee', 'hash', ?, '[]', ?, 1)`)
    .run(JSON.stringify(['Manager']), JSON.stringify(['scope']))

  const app = express()
  app.use(express.json({ limit: '2mb' }))
  app.use('/api/attendance', attendanceRouter)
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
  db.prepare('DELETE FROM punches').run()
  db.prepare('DELETE FROM attendance_records').run()
  db.prepare('DELETE FROM audit_logs').run()
  db.prepare('DELETE FROM role_feature_permissions').run()
  db.prepare('DELETE FROM attendance_devices').run()
  db.prepare('UPDATE employees SET status=2').run()
  allow('attendance.proxy_punch')
})

function insertEmployee(id: string, departmentId: string): void {
  db.prepare(`INSERT INTO employees
    (id, employee_code, full_name, email, status, department_id, position_id, branch_id, hire_date)
    VALUES (?, ?, ?, ?, 2, ?, 'position', 'branch', '2020-01-01')`)
    .run(id, id, id, `${id}@example.test`, departmentId)
}

function allow(permission: string): void {
  const split = permission.lastIndexOf('.')
  db.prepare(`INSERT INTO role_feature_permissions (role, feature, action, allowed, updated_at)
    VALUES ('Manager', ?, ?, 1, '2026-08-30T00:00:00')`).run(permission.slice(0, split), permission.slice(split + 1))
}

function token(): string {
  return jwt.sign({ id: 'actor', roles: ['Admin'] }, process.env.JWT_SECRET || 'hrm-attendance-dev-secret-change-me', { expiresIn: '1h' })
}

async function proxy(body: Record<string, unknown>) {
  return fetch(`${baseUrl}/attendance/proxy-punch`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('proxy punch requires a meaningful reason and rejects self-service through the proxy endpoint', async () => {
  assert.equal((await proxy({ targetEmployeeId: 'target', source: 2, reason: '   ' })).status, 400)
  assert.equal((await proxy({ targetEmployeeId: 'actor-employee', source: 2, reason: 'Forgot phone' })).status, 400)
})

test('proxy punch denies missing permission and hides an out-of-scope target', async () => {
  db.prepare('DELETE FROM role_feature_permissions').run()
  assert.equal((await proxy({ targetEmployeeId: 'target', source: 2, reason: 'Approved correction' })).status, 403)
  allow('attendance.proxy_punch')
  assert.equal((await proxy({ targetEmployeeId: 'outsider', source: 2, reason: 'Approved correction' })).status, 404)
})

test('valid proxy punch records explicit proxy provenance and detailed audit data', async () => {
  const response = await proxy({ targetEmployeeId: 'target', source: 2, reason: 'Employee device unavailable' })
  assert.equal(response.status, 200)
  const punch = db.prepare(`SELECT source, device_info, proxy_actor_user_id, proxy_reason, ip_address
    FROM punches WHERE employee_id='target'`).get() as any
  assert.equal(punch.source, 99)
  assert.equal(punch.device_info, 'Proxy')
  assert.equal(punch.proxy_actor_user_id, 'actor')
  assert.equal(punch.proxy_reason, 'Employee device unavailable')
  assert.ok(punch.ip_address)
  const audit = db.prepare(`SELECT detail FROM audit_logs WHERE entity='AttendanceProxyPunch'`).get() as any
  assert.match(audit.detail, /target/)
  assert.match(audit.detail, /Employee device unavailable/)
  assert.match(audit.detail, /(IN|OUT)/)
})

test('device punch requires a device id and rejects a separately revoked credential', async () => {
  createAttendanceDevice({ id: 'device-1', name: 'Front gate', credential: 'device-secret-one' })
  const body = JSON.stringify({ employeeCode: 'target' })
  const missingId = await fetch(`${baseUrl}/attendance/device-punch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Key': 'device-secret-one' }, body,
  })
  assert.equal(missingId.status, 401)

  revokeAttendanceDevice('device-1')
  const revoked = await fetch(`${baseUrl}/attendance/device-punch`, {
    method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-Device-Id': 'device-1', 'X-Device-Key': 'device-secret-one',
    }, body,
  })
  assert.equal(revoked.status, 401)
})

test('device credentials are hashed, rotate independently, and stale device timestamps are rejected', async () => {
  createAttendanceDevice({ id: 'device-2', name: 'Back gate', credential: 'device-secret-two' })
  const stored = db.prepare(`SELECT credential_hash FROM attendance_devices WHERE id='device-2'`).get() as any
  assert.notEqual(stored.credential_hash, 'device-secret-two')
  assert.ok(authenticateAttendanceDevice('device-2', 'device-secret-two'))

  rotateAttendanceDeviceCredential('device-2', 'device-secret-rotated')
  assert.equal(authenticateAttendanceDevice('device-2', 'device-secret-two'), null)
  assert.ok(authenticateAttendanceDevice('device-2', 'device-secret-rotated'))

  const stale = await fetch(`${baseUrl}/attendance/device-punch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'device-2', 'X-Device-Key': 'device-secret-rotated' },
    body: JSON.stringify({ employeeCode: 'target', punchedAt: '2020-01-01T08:00:00.000Z' }),
  })
  assert.equal(stale.status, 400)
})
