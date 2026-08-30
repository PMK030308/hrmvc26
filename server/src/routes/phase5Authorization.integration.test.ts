import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before, beforeEach } from 'node:test'
import type { NextFunction, Request, Response } from 'express'
import type { HttpError } from '../types.js'

const directory = mkdtempSync(join(tmpdir(), 'hrm-phase5-authz-'))
process.env.HRM_DB_PATH = join(directory, 'phase5.db')

const { db, initSchema } = await import('../db.js')
const { runMigrations } = await import('../services/migrationService.js')
const { ensureDefaultRolePermissions } = await import('../services/permissionService.js')
const { default: express } = await import('express')
const { default: jwt } = await import('jsonwebtoken')
const { timesheetRouter, payrollRouter } = await import('./timesheet.js')
const { dashboardRouter } = await import('./dashboard.js')
const { attendanceRouter } = await import('./attendance.js')

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
  insertUser('empty-manager', ['Manager'], 'other', [])
  insertUser('hr', ['HR'], 'root', ['root'])
  insertUser('accountant', ['Accountant'], 'other', [])
  insertUser('director', ['Director'], 'other', [])
  insertUser('admin', ['Admin'], 'root', [])
  insertUser('employee', ['Employee'], 'child', [])
  insertUser('outsider', ['Employee'], 'other', [])
  insertEmployee('report-employee', 'other', 'manager-employee')

  const app = express()
  app.use(express.json())
  app.use('/api/timesheet', timesheetRouter)
  app.use('/api/payroll', payrollRouter)
  app.use('/api/dashboard', dashboardRouter)
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
  db.prepare('DELETE FROM audit_logs').run()
  db.prepare('DELETE FROM payslips').run()
  db.prepare('DELETE FROM summary_timesheet_details').run()
  db.prepare('DELETE FROM summary_timesheets').run()
  db.prepare('DELETE FROM attendance_records').run()
  db.prepare('DELETE FROM role_feature_permissions').run()
  ensureDefaultRolePermissions()
  db.prepare('UPDATE users SET is_active=1').run()
  db.prepare('UPDATE employees SET status=2').run()
})

function insertEmployee(id: string, departmentId: string, managerId: string | null): void {
  db.prepare(`INSERT INTO employees
    (id, employee_code, first_name, last_name, full_name, gender, email, phone, address, marital_status,
     status, manager_id, department_id, position_id, branch_id, hire_date, work_nature, contract_type, wage)
    VALUES (?, ?, 'First', 'Last', ?, 1, ?, '', '', 'Single', 2, ?, ?, 'position', 'branch', '2020-01-01', 1, 1, 20000000)`)
    .run(id, id, `Employee ${id}`, `${id}@example.test`, managerId, departmentId)
}

function insertUser(id: string, roles: string[], departmentId: string, scopes: string[]): void {
  const employeeId = `${id}-employee`
  insertEmployee(employeeId, departmentId, null)
  db.prepare(`INSERT INTO users
    (id, email, employee_id, password_hash, roles, permissions, department_scopes, is_active)
    VALUES (?, ?, ?, 'hash', ?, '[]', ?, 1)`)
    .run(id, `${id}@example.test`, employeeId, JSON.stringify(roles), JSON.stringify(scopes))
}

function auth(id: string): Record<string, string> {
  const secret = process.env.JWT_SECRET || 'hrm-attendance-dev-secret-change-me'
  return { Authorization: `Bearer ${jwt.sign({ id, roles: ['Admin'] }, secret, { expiresIn: '1h' })}` }
}

function setPermission(role: string, permission: string, allowed: boolean): void {
  const separator = permission.lastIndexOf('.')
  db.prepare(`INSERT INTO role_feature_permissions (role, feature, action, allowed, updated_at)
    VALUES (?, ?, ?, ?, '2026-08-30T00:00:00')
    ON CONFLICT(role, feature, action) DO UPDATE SET allowed=excluded.allowed`)
    .run(role, permission.slice(0, separator), permission.slice(separator + 1), allowed ? 1 : 0)
}

function insertAttendance(employeeId: string): void {
  db.prepare(`INSERT INTO attendance_records
    (id, employee_id, date, actual_work_hours, work_hours, overtime_hours, status, main_status, approval_status, issues, is_active, created_at, updated_at)
    VALUES (?, ?, '2026-08-01', 8, 8, 1, 1, 1, 1, '[]', 1, '2026-08-01T08:00:00', '2026-08-01T17:00:00')`)
    .run(`ar-${employeeId}`, employeeId)
}

function insertSummary(status = 2, version = 1): void {
  db.prepare(`INSERT INTO summary_timesheets (id, period, status, from_date, to_date, version)
    VALUES ('summary', '2026081', ?, '2026-08-01', '2026-08-15', ?)`)
    .run(status, version)
  for (const employeeId of ['employee-employee', 'outsider-employee', 'report-employee']) {
    db.prepare(`INSERT INTO summary_timesheet_details
      (id, summary_timesheet_id, employee_id, employee_name, employee_code, paid_units, ot_hours, late_early_count, work_hours)
      VALUES (?, 'summary', ?, ?, ?, 8, 1, 0, 8)`)
      .run(`detail-${employeeId}`, employeeId, employeeId, employeeId)
  }
}

function insertPayslip(employeeId: string): void {
  db.prepare(`INSERT INTO payslips
    (id, period, employee_id, employee_name, base_salary, paid_work, overtime, allowance, gross, deductions, net, components)
    VALUES (?, '2026081', ?, ?, 20000000, 10000000, 1000000, 0, 11000000, 1000000, 10000000, '[]')`)
    .run(`payslip-${employeeId}`, employeeId, employeeId)
}

test('timesheet detail uses DB-fresh effective scope and empty scope denies', async () => {
  insertAttendance('employee-employee')
  insertAttendance('outsider-employee')
  insertAttendance('report-employee')
  setPermission('Manager', 'timesheet.detail.view_scoped', true)
  setPermission('Manager', 'timesheet.detail.view_self', false)

  const scoped = await fetch(`${baseUrl}/timesheet/detailed?year=2026&month=8&half=1`, { headers: auth('manager') })
  assert.equal(scoped.status, 200)
  const scopedBody = await scoped.json() as any
  const scopedIds = new Set(scopedBody.employees.map((employee: any) => employee.id))
  assert.equal(scopedIds.has('employee-employee'), true)
  assert.equal(scopedIds.has('report-employee'), true)
  assert.equal(scopedIds.has('outsider-employee'), false)
  assert.equal(scopedIds.has('accountant-employee'), false)

  const empty = await fetch(`${baseUrl}/timesheet/detailed?year=2026&month=8&half=1`, { headers: auth('empty-manager') })
  assert.equal(empty.status, 200)
  assert.deepEqual((await empty.json() as any).employees, [])

  setPermission('Manager', 'timesheet.detail.view_scoped', false)
  assert.equal((await fetch(`${baseUrl}/timesheet/detailed?year=2026&month=8&half=1`, { headers: auth('manager') })).status, 403)
})

test('summary list filters details by effective scope and requires explicit global access', async () => {
  insertSummary()
  setPermission('Manager', 'timesheet.summary.view_scoped', true)
  const scoped = await fetch(`${baseUrl}/timesheet/list-summary`, { headers: auth('manager') })
  const scopedBody = await scoped.json() as any[]
  assert.equal(scoped.status, 200)
  const scopedIds = new Set(scopedBody[0].details.map((detail: any) => detail.employeeId))
  assert.equal(scopedIds.has('employee-employee'), true)
  assert.equal(scopedIds.has('report-employee'), true)
  assert.equal(scopedIds.has('outsider-employee'), false)

  setPermission('Admin', 'timesheet.summary.view_all', false)
  assert.equal((await fetch(`${baseUrl}/timesheet/list-summary`, { headers: auth('admin') })).status, 403)
  setPermission('Employee', 'timesheet.summary.view_all', true)
  const global = await fetch(`${baseUrl}/timesheet/list-summary`, { headers: auth('employee') })
  assert.equal(global.status, 200)
  assert.equal((await global.json() as any[])[0].details.length, 3)
})

test('self payslip and payroll sheet permissions do not trust role names or JWT claims', async () => {
  insertSummary(4)
  insertPayslip('employee-employee')
  insertPayslip('outsider-employee')
  setPermission('Employee', 'payroll.payslip.view_self', false)
  assert.equal((await fetch(`${baseUrl}/payroll/mine`, { headers: auth('employee') })).status, 403)
  setPermission('Employee', 'payroll.payslip.view_self', true)
  const mine = await fetch(`${baseUrl}/payroll/mine`, { headers: auth('employee') })
  assert.equal(mine.status, 200)
  assert.deepEqual((await mine.json() as any).list.map((row: any) => row.employeeId), ['employee-employee'])

  setPermission('Accountant', 'payroll.sheet.view', false)
  assert.equal((await fetch(`${baseUrl}/payroll/sheet/2026081`, { headers: auth('accountant') })).status, 403)
  setPermission('Employee', 'payroll.sheet.view', true)
  assert.equal((await fetch(`${baseUrl}/payroll/sheet/2026081`, { headers: auth('employee') })).status, 200)
})

test('aggregate payroll report omits employee net while detail permission exposes it', async () => {
  insertAttendance('employee-employee')
  insertPayslip('employee-employee')
  setPermission('HR', 'reports.attendance.view_scoped', true)
  setPermission('HR', 'reports.payroll.view_aggregate', true)
  setPermission('HR', 'reports.payroll.view_detail', false)
  const aggregate = await fetch(`${baseUrl}/dashboard/director-reports?from=2026-08-01&to=2026-08-15`, { headers: auth('hr') })
  assert.equal(aggregate.status, 200)
  const aggregateBody = await aggregate.json() as any
  assert.equal('net' in aggregateBody.employees[0], false)
  assert.equal(aggregateBody.payroll.totalNet, 10000000)

  setPermission('HR', 'reports.payroll.view_detail', true)
  const detail = await fetch(`${baseUrl}/dashboard/director-reports?from=2026-08-01&to=2026-08-15`, { headers: auth('hr') })
  assert.equal('net' in (await detail.json() as any).employees[0], true)
})

test('summary workflow validates state and optimistic version', async () => {
  insertSummary(2, 1)
  setPermission('HR', 'timesheet.summary.confirm_hr', true)
  const confirmed = await fetch(`${baseUrl}/timesheet/confirm-by-hr/summary`, {
    method: 'POST', headers: { ...auth('hr'), 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: 1 }),
  })
  assert.equal(confirmed.status, 200)
  assert.equal((await confirmed.json() as any).version, 2)

  const stale = await fetch(`${baseUrl}/timesheet/confirm-by-hr/summary`, {
    method: 'POST', headers: { ...auth('hr'), 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: 1 }),
  })
  assert.equal(stale.status, 409)

  setPermission('HR', 'timesheet.summary.rebuild', true)
  const wrongState = await fetch(`${baseUrl}/timesheet/rebuild/summary`, {
    method: 'POST', headers: { ...auth('hr'), 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: 2 }),
  })
  assert.equal(wrongState.status, 409)
})

test('payroll transfer is idempotent and approval is versioned and race-safe', async () => {
  insertSummary(3, 1)
  setPermission('Accountant', 'timesheet.summary.transfer_payroll', true)
  const transfer = await fetch(`${baseUrl}/timesheet/transfer-to-payroll/summary`, {
    method: 'POST', headers: { ...auth('accountant'), 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: 1 }),
  })
  assert.equal(transfer.status, 200)
  assert.equal((db.prepare(`SELECT COUNT(*) count FROM payslips WHERE period='2026081'`).get() as any).count, 3)

  const retry = await fetch(`${baseUrl}/timesheet/transfer-to-payroll/summary`, {
    method: 'POST', headers: { ...auth('accountant'), 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: 1 }),
  })
  assert.equal(retry.status, 409)
  assert.equal((db.prepare(`SELECT COUNT(*) count FROM payslips WHERE period='2026081'`).get() as any).count, 3)

  setPermission('Director', 'payroll.sheet.approve', true)
  const [first, second] = await Promise.all([
    fetch(`${baseUrl}/payroll/approve-payroll/2026081`, { method: 'POST', headers: { ...auth('director'), 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: 2 }) }),
    fetch(`${baseUrl}/payroll/approve-payroll/2026081`, { method: 'POST', headers: { ...auth('director'), 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: 2 }) }),
  ])
  assert.deepEqual([first.status, second.status].sort(), [200, 409])
})

test('malformed periods and dates are rejected before report queries', async () => {
  setPermission('Admin', 'payroll.sheet.view', true)
  setPermission('Admin', 'reports.attendance.view_all', true)
  assert.equal((await fetch(`${baseUrl}/payroll/sheet/not-a-period`, { headers: auth('admin') })).status, 400)
  assert.equal((await fetch(`${baseUrl}/dashboard/director-reports?from=nope&to=2026-08-01`, { headers: auth('admin') })).status, 400)
})

test('employee timesheet confirmation is self-only and double-submit safe', async () => {
  insertSummary(2, 1)
  setPermission('Employee', 'attendance.confirm_self', true)
  const foreign = await fetch(`${baseUrl}/attendance/confirm-timesheet`, {
    method: 'POST', headers: { ...auth('outsider'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ summaryTimesheetDetailId: 'detail-employee-employee', status: 2, comment: 'foreign' }),
  })
  assert.equal(foreign.status, 404)

  const submit = () => fetch(`${baseUrl}/attendance/confirm-timesheet`, {
    method: 'POST', headers: { ...auth('employee'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ summaryTimesheetDetailId: 'detail-employee-employee', status: 2, comment: 'confirmed' }),
  })
  const [first, second] = await Promise.all([submit(), submit()])
  assert.deepEqual([first.status, second.status].sort(), [200, 409])
})
