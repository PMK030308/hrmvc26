import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before } from 'node:test'
import type { NextFunction, Request, Response } from 'express'
import type { HttpError } from '../types.js'

const directory = mkdtempSync(join(tmpdir(), 'hrm-request-pdf-'))
process.env.HRM_DB_PATH = join(directory, 'request-pdf.db')
process.env.APP_PUBLIC_URL = 'https://hrm.example.test'

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
  db.prepare('INSERT INTO branches (id, name, address) VALUES (?, ?, ?)').run('branch', 'Trụ sở Hà Nội', '')
  db.prepare('INSERT INTO departments (id, code, name) VALUES (?, ?, ?)').run('department', 'IT', 'Công nghệ thông tin')
  db.prepare('INSERT INTO positions (id, code, name) VALUES (?, ?, ?)').run('position', 'DEV', 'Lập trình viên')
  insertPrincipal('owner', 'NV001', 'Nguyễn Minh An')
  insertPrincipal('outsider', 'NV002', 'Trần Thu Hà')
  insertLeaveRequest('approved', 3)
  insertLeaveRequest('pending', 2)
  db.prepare(`INSERT INTO request_approvals
    (id, request_id, request_type, level, approver_user_id, approver_name, status, comment, approved_at)
    VALUES
    ('approval-1', 'approved', 'leaves', 1, 'manager', 'Lê Hải Yến', 3, 'Đồng ý', '2026-09-03T09:15:00'),
    ('approval-2', 'approved', 'leaves', 2, 'director', 'Phạm Minh Triết', 3, NULL, '2026-09-03T10:30:00')`).run()

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
  delete process.env.APP_PUBLIC_URL
  rmSync(directory, { recursive: true, force: true })
})

function insertPrincipal(id: string, code: string, fullName: string): void {
  const employeeId = `employee-${id}`
  db.prepare(`INSERT INTO employees
    (id, employee_code, full_name, email, status, department_id, position_id, branch_id, hire_date)
    VALUES (?, ?, ?, ?, 2, 'department', 'position', 'branch', '2024-01-01')`)
    .run(employeeId, code, fullName, `${id}@example.test`)
  db.prepare(`INSERT INTO users
    (id, email, employee_id, password_hash, roles, permissions, department_scopes, is_active)
    VALUES (?, ?, ?, 'hash', '["Employee"]', '[]', '[]', 1)`)
    .run(id, `${id}@example.test`, employeeId)
}

function insertLeaveRequest(id: string, status: number): void {
  db.prepare(`INSERT INTO requests
    (id, type, employee_id, employee_name, employee_code, status, request_version, current_level,
      created_at, updated_at, capabilities, leave_type_name, start_date, end_date, total_days, reason)
    VALUES (?, 'leaves', 'employee-owner', 'Nguyễn Minh An', 'NV001', ?, 1, 2,
      '2026-09-02T08:00:00', '2026-09-03T10:30:00', '{}', 'Nghỉ phép năm',
      '2026-09-08', '2026-09-09', 2, 'Giải quyết việc gia đình')`)
    .run(id, status)
}

function token(userId: string): string {
  return jwt.sign(
    { id: userId, session_version: 1, token_type: 'access' },
    process.env.JWT_SECRET || 'hrm-attendance-dev-secret-change-me',
    { expiresIn: '1h' },
  )
}

test('exports an official PDF with a verification code only for an approved request', async () => {
  const response = await fetch(`${baseUrl}/requests/leaves/approved/export-pdf`, {
    headers: { Authorization: `Bearer ${token('owner')}` },
  })

  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /^application\/pdf/)
  assert.match(response.headers.get('content-disposition') ?? '', /attachment; filename="request-NV001-approved\.pdf"/)
  assert.match(response.headers.get('x-request-verification-code') ?? '', /^REQ-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/)
  const bytes = new Uint8Array(await response.arrayBuffer())
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-')
  assert.ok(bytes.length > 2_000)
})

test('refuses to export a request that has not reached final approval', async () => {
  const response = await fetch(`${baseUrl}/requests/leaves/pending/export-pdf`, {
    headers: { Authorization: `Bearer ${token('owner')}` },
  })

  assert.equal(response.status, 409)
  assert.match((await response.json() as any).message, /duyệt hoàn tất/i)
})

test('does not expose an approved request PDF to an unrelated employee', async () => {
  const response = await fetch(`${baseUrl}/requests/leaves/approved/export-pdf`, {
    headers: { Authorization: `Bearer ${token('outsider')}` },
  })

  assert.equal(response.status, 404)
})
