import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before, beforeEach } from 'node:test'
import type { NextFunction, Request, Response } from 'express'
import type { HttpError } from '../types.js'

const directory = mkdtempSync(join(tmpdir(), 'hrm-request-shift-routes-'))
process.env.HRM_DB_PATH = join(directory, 'request-shift-routes.db')

const { db, initSchema } = await import('../db.js')
const { runMigrations } = await import('../services/migrationService.js')
const { ensureDefaultRolePermissions } = await import('../services/permissionService.js')
const { default: express } = await import('express')
const { default: jwt } = await import('jsonwebtoken')
const { requestsRouter } = await import('./requests.js')

let server: ReturnType<ReturnType<typeof express>['listen']>
let baseUrl = ''

before(async () => {
  initSchema()
  runMigrations(db)
  ensureDefaultRolePermissions()
  db.prepare('INSERT INTO branches (id, name, address) VALUES (?, ?, ?)').run('branch', 'Main', '')
  db.prepare('INSERT INTO departments (id, code, name) VALUES (?, ?, ?)').run('department', 'D', 'Department')
  db.prepare('INSERT INTO departments (id, code, name) VALUES (?, ?, ?)').run('other', 'O', 'Other')
  db.prepare('INSERT INTO positions (id, code, name) VALUES (?, ?, ?)').run('position', 'EMP', 'Employee')
  db.prepare(`INSERT INTO employees
    (id, employee_code, full_name, email, status, department_id, position_id, branch_id, hire_date)
    VALUES ('employee', 'E001', 'Employee', 'employee@example.test', 2, 'department', 'position', 'branch', '2020-01-01')`).run()
  insertEmployee('partner', 'department')
  insertEmployee('outsider', 'other')
  db.prepare(`INSERT INTO users
    (id, email, employee_id, password_hash, roles, permissions, department_scopes, is_active)
    VALUES ('user', 'employee@example.test', 'employee', 'hash', ?, '[]', '[]', 1)`)
    .run(JSON.stringify(['Employee']))
  db.prepare(`INSERT INTO shifts (id, code, name, start_time, end_time, work_days, status, holiday_coefficient, color)
    VALUES ('shift', 'DAY', 'Day', '08:00:00', '17:00:00', 1, 1, 1, '#000000')`).run()
  db.prepare(`INSERT INTO shift_schedules (id, employee_id, shift_id, date, is_active)
    VALUES ('partner-schedule', 'partner', 'shift', '2026-08-30', 1)`).run()

  const app = express()
  app.use(express.json())
  app.use('/api/requests', requestsRouter)
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

beforeEach(() => db.prepare(`UPDATE employees SET status=2 WHERE id IN ('partner','outsider')`).run())

function insertEmployee(id: string, departmentId: string): void {
  db.prepare(`INSERT INTO employees
    (id, employee_code, full_name, email, status, department_id, position_id, branch_id, hire_date)
    VALUES (?, ?, ?, ?, 2, ?, 'position', 'branch', '2020-01-01')`)
    .run(id, id, id, `${id}@example.test`, departmentId)
}

function authToken(): string {
  return jwt.sign({ id: 'user', roles: ['Admin'] }, process.env.JWT_SECRET || 'hrm-attendance-dev-secret-change-me', { expiresIn: '1h' })
}

test('static my-shift helper is not shadowed by the generic request detail route', async () => {
  const response = await fetch(`${baseUrl}/requests/my-shift/2026-08-30`, {
    headers: { Authorization: `Bearer ${authToken()}` },
  })

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { shift: null, schedule: null })
})

test('partner catalog and preview share DB-fresh eligibility and block cross-department IDOR', async () => {
  const headers = { Authorization: `Bearer ${authToken()}` }
  const catalog = await fetch(`${baseUrl}/requests/catalog`, { headers })
  assert.equal(catalog.status, 200)
  const catalogBody = await catalog.json() as any
  assert.deepEqual(catalogBody.swapPartners.map((partner: any) => partner.id), ['partner'])

  const allowed = await fetch(`${baseUrl}/requests/partner-shift/partner/2026-08-30`, { headers })
  assert.equal(allowed.status, 200)
  const denied = await fetch(`${baseUrl}/requests/partner-shift/outsider/2026-08-30`, { headers })
  assert.equal(denied.status, 404)

  db.prepare(`UPDATE employees SET status=4 WHERE id='partner'`).run()
  const staleCatalog = await fetch(`${baseUrl}/requests/partner-shift/partner/2026-08-30`, { headers })
  assert.equal(staleCatalog.status, 404)
})
