import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, beforeEach } from 'node:test'
import type { NextFunction, Request, Response } from 'express'
import type { HttpError } from '../types.js'

const directory = mkdtempSync(join(tmpdir(), 'hrm-request-authz-'))
process.env.HRM_DB_PATH = join(directory, 'integration.db')

const { db, initSchema, truncateAll } = await import('../db.js')
const { runMigrations } = await import('../services/migrationService.js')
const { ensureDefaultRolePermissions } = await import('../services/permissionService.js')
const {
  approveRequest,
  cancelRequest,
  createRequest,
  partnerRespond,
  updateRequest,
} = await import('./request.js')
const {
  loadRequestActor,
  loadRequestAuthorizationContext,
  requireViewableRequest,
} = await import('../authz/requestAuthorizationContext.js')
const { canApproveCurrentStep, canManageRequestAttachment } = await import('../authz/requestAuthorization.js')
const { default: express } = await import('express')
const { default: jwt } = await import('jsonwebtoken')
const { requestsRouter } = await import('../routes/requests.js')

initSchema()
runMigrations(db)
ensureDefaultRolePermissions()

after(() => {
  db.close()
  delete process.env.HRM_DB_PATH
  rmSync(directory, { recursive: true, force: true })
})

beforeEach(() => {
  truncateAll()
  seedActors()
})

function seedActors(): void {
  db.prepare('INSERT INTO branches (id, name, address) VALUES (?, ?, ?)').run('branch', 'Main', '')
  db.prepare('INSERT INTO departments (id, code, name, parent_id, manager_employee_id) VALUES (?, ?, ?, NULL, NULL)')
    .run('department-a', 'A', 'Department A')
  db.prepare('INSERT INTO departments (id, code, name, parent_id, manager_employee_id) VALUES (?, ?, ?, NULL, NULL)')
    .run('department-b', 'B', 'Department B')
  db.prepare('INSERT INTO positions (id, code, name) VALUES (?, ?, ?)').run('position', 'EMP', 'Employee')

  insertEmployee('employee-owner', 'E001', 'Owner', 'department-a', 'employee-manager')
  insertEmployee('employee-manager', 'E002', 'Manager', 'department-a', null)
  insertEmployee('employee-other', 'E003', 'Other', 'department-b', null)
  insertEmployee('employee-partner', 'E004', 'Partner', 'department-b', null)
  insertEmployee('employee-delegate', 'E005', 'Delegate', 'department-b', null)
  insertEmployee('employee-hr', 'E006', 'HR', 'department-a', null)
  insertEmployee('employee-admin', 'E007', 'Admin', 'department-b', null)

  db.prepare('UPDATE departments SET manager_employee_id=? WHERE id=?').run('employee-manager', 'department-a')
  insertUser('user-owner', 'employee-owner', ['Employee'])
  insertUser('user-manager', 'employee-manager', ['Manager'])
  insertUser('user-other', 'employee-other', ['Employee'])
  insertUser('user-partner', 'employee-partner', ['Employee'])
  insertUser('user-delegate', 'employee-delegate', ['Manager'])
  insertUser('user-hr', 'employee-hr', ['HR'], ['department-a'])
  insertUser('user-admin', 'employee-admin', ['Admin'])
}

function insertEmployee(id: string, code: string, name: string, departmentId: string, managerId: string | null): void {
  db.prepare(`INSERT INTO employees
    (id, employee_code, first_name, last_name, full_name, email, department_id, position_id, branch_id, hire_date, manager_id)
    VALUES (?, ?, ?, '', ?, ?, ?, 'position', 'branch', '2020-01-01', ?)`)
    .run(id, code, name, name, `${id}@example.test`, departmentId, managerId)
}

function insertUser(id: string, employeeId: string, roles: string[], scopes: string[] = []): void {
  db.prepare(`INSERT INTO users
    (id, email, employee_id, password_hash, roles, permissions, department_scopes)
    VALUES (?, ?, ?, 'hash', ?, '[]', ?)`)
    .run(id, `${id}@example.test`, employeeId, JSON.stringify(roles), JSON.stringify(scopes))
}

function insertRequest(options: {
  id: string
  employeeId?: string
  type?: 'late-earlies' | 'shift-swaps'
  status?: number
  version?: number
  currentLevel?: number
  partnerEmployeeId?: string | null
  partnerStatus?: number
}): void {
  const employeeId = options.employeeId ?? 'employee-owner'
  const employee = db.prepare('SELECT employee_code, full_name FROM employees WHERE id=?').get(employeeId) as any
  db.prepare(`INSERT INTO requests
    (id, type, employee_id, employee_name, employee_code, status, request_version, current_level,
     capabilities, created_at, updated_at, request_date, late_early_type, requested_time, minutes, reason,
     shift_swap_mode, suggested_swap_partner_id, suggested_swap_partner_name, swap_partner_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', '2026-08-29T09:00:00', '2026-08-29T09:00:00',
      '2026-08-30', 1, '09:00', 30, 'Test', ?, ?, ?, ?)`)
    .run(
      options.id,
      options.type ?? 'late-earlies',
      employeeId,
      employee.full_name,
      employee.employee_code,
      options.status ?? 2,
      options.version ?? 1,
      options.currentLevel ?? 1,
      options.type === 'shift-swaps' ? 2 : null,
      options.partnerEmployeeId ?? null,
      options.partnerEmployeeId ? 'Partner' : null,
      options.partnerStatus ?? 0,
    )
}

function insertApproval(
  requestId: string,
  approverUserId: string,
  status = 2,
  onBehalfOfUserId: string | null = null,
  level = 1,
): void {
  db.prepare(`INSERT INTO request_approvals
    (id, request_id, request_type, level, approver_user_id, approver_name, status, on_behalf_of_user_id, on_behalf_of_name)
    VALUES (?, ?, 'late-earlies', ?, ?, 'Approver', ?, ?, ?)`)
    .run(`approval-${requestId}-${level}`, requestId, level, approverUserId, status, onBehalfOfUserId, onBehalfOfUserId ? 'Delegator' : null)
}

function expectHttpStatus(fn: () => unknown, status: number): void {
  assert.throws(fn, (error: unknown) => (error as HttpError).status === status)
}

test('owner can view/update/cancel own draft while another employee receives hidden 404', () => {
  insertRequest({ id: 'draft-update', status: 1 })
  requireViewableRequest(loadRequestActor('user-owner'), 'late-earlies', 'draft-update')
  expectHttpStatus(() => requireViewableRequest(loadRequestActor('user-other'), 'late-earlies', 'draft-update'), 404)
  expectHttpStatus(() => updateRequest('user-other', 'late-earlies', 'draft-update', { reason: 'No' }, 1), 404)

  const updated = updateRequest('user-owner', 'late-earlies', 'draft-update', { reason: 'Updated' }, 1)
  assert.equal(updated.requestVersion, 2)
  assert.equal(updated.reason, 'Updated')

  insertRequest({ id: 'draft-cancel', status: 1 })
  const cancelled = cancelRequest('user-owner', 'late-earlies', 'draft-cancel', 1)
  assert.equal(cancelled.status, 5)
  assert.equal(cancelled.requestVersion, 2)
})

test('HR scope and Admin global view do not grant modify or cancel authority over another owner', () => {
  insertRequest({ id: 'scoped-draft', status: 1 })
  requireViewableRequest(loadRequestActor('user-hr'), 'late-earlies', 'scoped-draft')
  requireViewableRequest(loadRequestActor('user-admin'), 'late-earlies', 'scoped-draft')
  expectHttpStatus(() => updateRequest('user-hr', 'late-earlies', 'scoped-draft', { reason: 'HR edit' }, 1), 403)
  expectHttpStatus(() => cancelRequest('user-admin', 'late-earlies', 'scoped-draft', 1), 403)

  insertRequest({ id: 'outside-scope', employeeId: 'employee-other', status: 1 })
  expectHttpStatus(() => requireViewableRequest(loadRequestActor('user-hr'), 'late-earlies', 'outside-scope'), 404)
  requireViewableRequest(loadRequestActor('user-admin'), 'late-earlies', 'outside-scope')
})

test('only the exact current approver can approve and a replay/race loser gets 409', () => {
  insertRequest({ id: 'approval-race' })
  insertApproval('approval-race', 'user-manager')

  expectHttpStatus(() => approveRequest('user-owner', 'late-earlies', 'approval-race', '', 1), 403)
  const approved = approveRequest('user-manager', 'late-earlies', 'approval-race', 'OK', 1)
  assert.equal(approved.status, 3)
  assert.equal(approved.requestVersion, 2)
  expectHttpStatus(() => approveRequest('user-manager', 'late-earlies', 'approval-race', 'Again', 1), 409)
  assert.equal((db.prepare('SELECT COUNT(*) count FROM audit_logs WHERE entity_id=?').get('approval-race') as any).count, 1)
})

test('stale version is rejected before a visible owner mutation changes data', () => {
  insertRequest({ id: 'stale-update', status: 1, version: 2 })
  expectHttpStatus(() => updateRequest('user-owner', 'late-earlies', 'stale-update', { reason: 'Stale' }, 1), 409)
  const row = db.prepare('SELECT reason, request_version FROM requests WHERE id=?').get('stale-update') as any
  assert.equal(row.reason, 'Test')
  assert.equal(row.request_version, 2)
})

test('active delegation gives action to delegate; expired or revoked delegation returns it to delegator', () => {
  insertRequest({ id: 'delegated' })
  insertApproval('delegated', 'user-delegate', 2, 'user-manager')
  db.prepare(`INSERT INTO delegations
    (id, delegator_user_id, delegate_user_id, from_date, to_date, reason, is_active)
    VALUES ('delegation', 'user-manager', 'user-delegate', '2000-01-01', '2999-12-31', 'Leave', 1)`).run()

  let context = loadRequestAuthorizationContext('late-earlies', 'delegated')!
  assert.equal(canApproveCurrentStep(loadRequestActor('user-delegate'), context), true)
  assert.equal(canApproveCurrentStep(loadRequestActor('user-manager'), context), false)

  db.prepare('UPDATE delegations SET is_active=0 WHERE id=?').run('delegation')
  context = loadRequestAuthorizationContext('late-earlies', 'delegated')!
  assert.equal(canApproveCurrentStep(loadRequestActor('user-delegate'), context), false)
  assert.equal(canApproveCurrentStep(loadRequestActor('user-manager'), context), true)

  db.prepare("UPDATE delegations SET is_active=1, to_date='2001-01-01' WHERE id=?").run('delegation')
  context = loadRequestAuthorizationContext('late-earlies', 'delegated')!
  assert.equal(canApproveCurrentStep(loadRequestActor('user-delegate'), context), false)
  assert.equal(canApproveCurrentStep(loadRequestActor('user-manager'), context), true)
})

test('attachment authorization distinguishes outsider, owner and current approver', () => {
  insertRequest({ id: 'attachment-request', status: 1 })
  let context = loadRequestAuthorizationContext('late-earlies', 'attachment-request')!
  assert.equal(canManageRequestAttachment(loadRequestActor('user-owner'), context, 'upload'), true)
  assert.equal(canManageRequestAttachment(loadRequestActor('user-owner'), context, 'delete'), true)
  assert.equal(canManageRequestAttachment(loadRequestActor('user-other'), context, 'read'), false)

  db.prepare('UPDATE requests SET status=2 WHERE id=?').run('attachment-request')
  insertApproval('attachment-request', 'user-manager')
  context = loadRequestAuthorizationContext('late-earlies', 'attachment-request')!
  assert.equal(canManageRequestAttachment(loadRequestActor('user-manager'), context, 'upload'), true)
  assert.equal(canManageRequestAttachment(loadRequestActor('user-manager'), context, 'delete'), false)
})

test('only the selected shift-swap partner can respond and a second response gets 409', () => {
  insertRequest({
    id: 'shift-swap',
    type: 'shift-swaps',
    status: 6,
    partnerEmployeeId: 'employee-partner',
    partnerStatus: 1,
  })
  expectHttpStatus(() => partnerRespond('user-other', 'shift-swap', true, null, 1), 404)
  const responded = partnerRespond('user-partner', 'shift-swap', true, null, 1)
  assert.equal(responded.swapPartnerStatus, 2)
  assert.equal(responded.requestVersion, 2)
  expectHttpStatus(() => partnerRespond('user-partner', 'shift-swap', true, null, 1), 409)
})

test('missing request is 404', () => {
  expectHttpStatus(() => requireViewableRequest(loadRequestActor('user-owner'), 'late-earlies', 'missing'), 404)
})

test('request create permission is enforced inside the engine for REST and chatbot callers', () => {
  db.prepare(`UPDATE role_feature_permissions SET allowed=0
    WHERE role='Employee' AND feature='requests.request' AND action='create_own'`).run()
  try {
    expectHttpStatus(() => createRequest('user-owner', 'late-earlies', {}), 403)
  } finally {
    db.prepare(`UPDATE role_feature_permissions SET allowed=1
      WHERE role='Employee' AND feature='requests.request' AND action='create_own'`).run()
  }
})

test('request list honors the dynamic view matrix and invalid or expired JWT returns 401', async () => {
  insertRequest({ id: 'matrix-hidden', status: 1 })
  const app = express()
  app.use(express.json())
  app.use('/api/requests', requestsRouter)
  app.use((error: HttpError, _req: Request, res: Response, _next: NextFunction) => {
    res.status(error.status ?? 500).json({ message: error.message })
  })
  const server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const baseUrl = `http://127.0.0.1:${address.port}/api/requests/mine`
  const authUser = {
    id: 'user-owner',
    email: 'user-owner@example.test',
    employeeId: 'employee-owner',
    roles: ['Employee'],
    permissions: [],
    departmentScopes: [],
  }
  const token = jwt.sign(authUser, process.env.JWT_SECRET || 'hrm-attendance-dev-secret-change-me', { expiresIn: '1h' })
  const expiredToken = jwt.sign(authUser, process.env.JWT_SECRET || 'hrm-attendance-dev-secret-change-me', { expiresIn: -1 })

  try {
    assert.equal((await fetch(baseUrl)).status, 401)
    assert.equal((await fetch(baseUrl, { headers: { Authorization: 'Bearer invalid' } })).status, 401)
    assert.equal((await fetch(baseUrl, { headers: { Authorization: `Bearer ${expiredToken}` } })).status, 401)

    db.prepare(`UPDATE role_feature_permissions SET allowed=0
      WHERE role='Employee' AND feature='requests.request' AND action='view_own'`).run()
    const response = await fetch(baseUrl, { headers: { Authorization: `Bearer ${token}` } })
    assert.equal(response.status, 200)
    const body = await response.json() as { mine: unknown[] }
    assert.deepEqual(body.mine, [])
  } finally {
    db.prepare(`UPDATE role_feature_permissions SET allowed=1
      WHERE role='Employee' AND feature='requests.request' AND action='view_own'`).run()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('attachment routes hide the parent from outsiders and enforce separate upload/delete capabilities', async () => {
  insertRequest({ id: 'attachment-route', status: 1 })
  db.prepare(`INSERT INTO request_attachments
    (id, request_id, file_name, file_size, mime_type, data_url, uploaded_at)
    VALUES ('attachment-existing', 'attachment-route', 'proof.pdf', 12, 'application/pdf', 'data:application/pdf;base64,AA==', '2026-08-29T09:00:00')`).run()
  const app = express()
  app.use(express.json({ limit: '1mb' }))
  app.use('/api/requests', requestsRouter)
  app.use((error: HttpError, _req: Request, res: Response, _next: NextFunction) => {
    res.status(error.status ?? 500).json({ message: error.message })
  })
  const server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const baseUrl = `http://127.0.0.1:${address.port}/api/requests`
  const secret = process.env.JWT_SECRET || 'hrm-attendance-dev-secret-change-me'
  const ownerToken = jwt.sign({
    id: 'user-owner', email: 'user-owner@example.test', employeeId: 'employee-owner',
    roles: ['Employee'], permissions: [], departmentScopes: [],
  }, secret, { expiresIn: '1h' })
  const outsiderToken = jwt.sign({
    id: 'user-other', email: 'user-other@example.test', employeeId: 'employee-other',
    roles: ['Employee'], permissions: [], departmentScopes: [],
  }, secret, { expiresIn: '1h' })
  const pdf = Buffer.from('%PDF-1.4')
  const uploadBody = JSON.stringify({
    fileName: 'new.pdf', fileSize: pdf.length, mimeType: 'application/pdf', dataUrl: `data:application/pdf;base64,${pdf.toString('base64')}`,
  })

  try {
    const outsiderHeaders = { Authorization: `Bearer ${outsiderToken}`, 'Content-Type': 'application/json' }
    assert.equal((await fetch(`${baseUrl}/late-earlies/attachment-route/attachments`, { headers: outsiderHeaders })).status, 404)
    assert.equal((await fetch(`${baseUrl}/late-earlies/attachment-route/attachments`, { method: 'POST', headers: outsiderHeaders, body: uploadBody })).status, 404)
    assert.equal((await fetch(`${baseUrl}/attachments/attachment-existing`, { method: 'DELETE', headers: outsiderHeaders })).status, 404)

    const ownerHeaders = { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' }
    assert.equal((await fetch(`${baseUrl}/late-earlies/attachment-route/attachments`, { headers: ownerHeaders })).status, 200)
    const uploaded = await fetch(`${baseUrl}/late-earlies/attachment-route/attachments`, { method: 'POST', headers: ownerHeaders, body: uploadBody })
    assert.equal(uploaded.status, 200)
    const uploadedBody = await uploaded.json() as any
    assert.equal(uploadedBody.uploadedByUserId, 'user-owner')
    assert.equal(uploadedBody.checksumSha256, createHash('sha256').update(pdf).digest('hex'))
    const stored = db.prepare('SELECT file_size, uploaded_by_user_id, checksum_sha256 FROM request_attachments WHERE id=?').get(uploadedBody.id) as any
    assert.deepEqual(stored, { file_size: pdf.length, uploaded_by_user_id: 'user-owner', checksum_sha256: uploadedBody.checksumSha256 })

    const malformed = JSON.stringify({ fileName: 'bad.pdf', fileSize: 1, mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,***' })
    assert.equal((await fetch(`${baseUrl}/late-earlies/attachment-route/attachments`, { method: 'POST', headers: ownerHeaders, body: malformed })).status, 400)
    process.env.ATTACHMENT_MAX_BYTES = String(pdf.length - 1)
    assert.equal((await fetch(`${baseUrl}/late-earlies/attachment-route/attachments`, { method: 'POST', headers: ownerHeaders, body: uploadBody })).status, 413)
    delete process.env.ATTACHMENT_MAX_BYTES
    assert.equal((await fetch(`${baseUrl}/attachments/attachment-existing`, { method: 'DELETE', headers: ownerHeaders })).status, 200)
  } finally {
    delete process.env.ATTACHMENT_MAX_BYTES
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
