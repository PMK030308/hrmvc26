import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before, beforeEach } from 'node:test'
import type { NextFunction, Request, Response } from 'express'
import type { HttpError } from '../types.js'

const directory = mkdtempSync(join(tmpdir(), 'hrm-reset-demo-authz-'))
process.env.HRM_DB_PATH = join(directory, 'reset-demo.db')

const { db, initSchema, truncateAll } = await import('../db.js')
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
  delete process.env.HRM_ALLOW_DEMO_RESET
  rmSync(directory, { recursive: true, force: true })
})

beforeEach(() => {
  truncateAll()
  db.prepare('DELETE FROM role_feature_permissions').run()
  ensureDefaultRolePermissions()
  db.prepare('INSERT INTO branches (id, name, address) VALUES (?, ?, ?)').run('marker-branch', 'Must survive denied reset', '')
  db.prepare('INSERT INTO departments (id, code, name) VALUES (?, ?, ?)').run('department', 'D', 'Department')
  db.prepare('INSERT INTO positions (id, code, name) VALUES (?, ?, ?)').run('position', 'EMP', 'Employee')
  db.prepare(`INSERT INTO employees
    (id, employee_code, full_name, email, status, department_id, position_id, branch_id, hire_date)
    VALUES ('employee-admin', 'ADMIN', 'Admin', 'admin@example.test', 2, 'department', 'position', 'marker-branch', '2020-01-01')`).run()
  db.prepare(`INSERT INTO users
    (id, email, employee_id, password_hash, roles, permissions, department_scopes, is_active)
    VALUES ('admin', 'admin@example.test', 'employee-admin', 'hash', '["Admin"]', '[]', '[]', 1)`).run()
  process.env.HRM_ALLOW_DEMO_RESET = 'true'
})

function token(): string {
  return jwt.sign({ id: 'admin', roles: ['Admin'] }, process.env.JWT_SECRET || 'hrm-attendance-dev-secret-change-me', { expiresIn: '1h' })
}

function setPermission(allowed: boolean): void {
  db.prepare(`INSERT INTO role_feature_permissions (role, feature, action, allowed, updated_at)
    VALUES ('Admin', 'system', 'demo_reset', ?, '2026-08-30T00:00:00')
    ON CONFLICT(role, feature, action) DO UPDATE SET allowed=excluded.allowed`).run(allowed ? 1 : 0)
}

async function reset(confirmation?: string) {
  return fetch(`${baseUrl}/org/reset-demo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(confirmation === undefined ? {} : { confirmation }),
  })
}

function markerExists(): boolean {
  return !!db.prepare("SELECT 1 FROM branches WHERE id='marker-branch'").get()
}

test('reset-demo stays disabled in production even with permission and confirmation', async () => {
  setPermission(true)
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    const response = await reset('RESET_DEMO_DATA')
    assert.equal(response.status, 404)
    assert.equal(markerExists(), true)
  } finally {
    process.env.NODE_ENV = previous
  }
})

test('reset-demo requires system.demo_reset and explicit confirmation outside production', async () => {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'development'
  try {
    setPermission(false)
    assert.equal((await reset('RESET_DEMO_DATA')).status, 403)
    assert.equal(markerExists(), true)

    setPermission(true)
    assert.equal((await reset()).status, 400)
    assert.equal((await reset('wrong-confirmation')).status, 400)
    assert.equal(markerExists(), true)
  } finally {
    process.env.NODE_ENV = previous
  }
})

test('reset-demo runs only with kill switch, permission and exact confirmation', async () => {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'development'
  try {
    setPermission(true)
    delete process.env.HRM_ALLOW_DEMO_RESET
    assert.equal((await reset('RESET_DEMO_DATA')).status, 404)
    assert.equal(markerExists(), true)

    process.env.HRM_ALLOW_DEMO_RESET = 'true'
    assert.equal((await reset('RESET_DEMO_DATA')).status, 200)
    assert.equal(markerExists(), false)
  } finally {
    process.env.NODE_ENV = previous
  }
})
