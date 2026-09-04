import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before, beforeEach } from 'node:test'
import type { NextFunction, Request, Response } from 'express'
import ExcelJS from 'exceljs'
import type { HttpError } from '../types.js'

const directory = mkdtempSync(join(tmpdir(), 'hrm-employee-excel-'))
process.env.HRM_DB_PATH = join(directory, 'employee-excel.db')

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
  db.prepare('INSERT INTO branches (id, name, address) VALUES (?, ?, ?)').run('branch-main', 'Trụ sở chính', '')
  db.prepare('INSERT INTO branches (id, name, address) VALUES (?, ?, ?)').run('branch-south', 'Chi nhánh Nam', '')
  db.prepare('INSERT INTO departments (id, code, name) VALUES (?, ?, ?)').run('dept-hr', 'HR', 'Nhân sự')
  db.prepare('INSERT INTO departments (id, code, name) VALUES (?, ?, ?)').run('dept-it', 'IT', 'Công nghệ')
  db.prepare('INSERT INTO positions (id, code, name) VALUES (?, ?, ?)').run('pos-staff', 'NV', 'Nhân viên')
  insertEmployee('admin-employee', 'ADMIN01', 'admin@example.test', 'dept-hr')
  insertEmployee('hr-employee', 'HR01', 'hr@example.test', 'dept-hr')
  insertEmployee('ordinary-employee', 'EMP01', 'employee@example.test', 'dept-it')
  insertUser('admin', ['Admin'], 'admin-employee', [])
  insertUser('hr', ['HR'], 'hr-employee', ['dept-hr'])
  insertUser('ordinary', ['Employee'], 'ordinary-employee', [])

  const app = express()
  app.use(express.json())
  app.use('/api/org', orgRouter)
  app.use((error: HttpError, _req: Request, res: Response, _next: NextFunction) => {
    res.status(error.status ?? 500).json({ message: error.message, code: error.code, fieldErrors: error.fieldErrors })
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
  db.prepare("DELETE FROM employees WHERE id LIKE 'emp-import-%'").run()
  db.prepare('DELETE FROM audit_logs').run()
  db.prepare('DELETE FROM role_feature_permissions').run()
  ensureDefaultRolePermissions()
})

function insertEmployee(id: string, employeeCode: string, email: string, departmentId: string): void {
  db.prepare(`INSERT INTO employees
    (id, employee_code, first_name, last_name, full_name, email, department_id, position_id, branch_id, hire_date)
    VALUES (?, ?, 'An', 'Nguyễn', ?, ?, ?, 'pos-staff', 'branch-main', '2025-01-01')`)
    .run(id, employeeCode, `Nguyễn An ${employeeCode}`, email, departmentId)
}

function insertUser(id: string, roles: string[], employeeId: string, scopes: string[]): void {
  db.prepare(`INSERT INTO users
    (id, email, employee_id, password_hash, roles, permissions, department_scopes, is_active)
    VALUES (?, ?, ?, 'hash', ?, '[]', ?, 1)`)
    .run(id, `${id}@example.test`, employeeId, JSON.stringify(roles), JSON.stringify(scopes))
}

function token(id: string): string {
  return jwt.sign({ id, roles: [], session_version: 1, token_type: 'access' }, process.env.JWT_SECRET || 'hrm-attendance-dev-secret-change-me', { expiresIn: '1h' })
}

function auth(id: string): Record<string, string> {
  return { Authorization: `Bearer ${token(id)}` }
}

function setPermission(role: string, permission: string, allowed: boolean): void {
  const separator = permission.lastIndexOf('.')
  db.prepare(`INSERT INTO role_feature_permissions (role, feature, action, allowed, updated_at)
    VALUES (?, ?, ?, ?, '2026-09-04T00:00:00')
    ON CONFLICT(role, feature, action) DO UPDATE SET allowed=excluded.allowed`)
    .run(role, permission.slice(0, separator), permission.slice(separator + 1), allowed ? 1 : 0)
}

async function workbookBuffer(rows: Array<Record<string, unknown>>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Nhân viên')
  const headers = [
    'Mã nhân viên', 'Họ', 'Tên', 'Email', 'Số điện thoại', 'Giới tính', 'Ngày sinh',
    'Mã phòng ban', 'Mã vị trí', 'Chi nhánh', 'Mã quản lý', 'Ngày vào làm',
    'Tính chất công việc', 'Loại hợp đồng', 'Trạng thái', 'Lương',
  ]
  sheet.addRow(headers)
  for (const row of rows) sheet.addRow(headers.map((header) => row[header] ?? ''))
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

async function upload(actorId: string, rows: Array<Record<string, unknown>>): Promise<Response> {
  return fetch(`${baseUrl}/org/employees/import-excel`, {
    method: 'POST',
    headers: { ...auth(actorId), 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    body: await workbookBuffer(rows),
  })
}

const validRow = {
  'Mã nhân viên': 'NV900', 'Họ': 'Trần', 'Tên': 'Mai', 'Email': 'mai@example.test',
  'Số điện thoại': '0901234567', 'Giới tính': 'Nữ', 'Ngày sinh': '1999-05-20',
  'Mã phòng ban': 'HR', 'Mã vị trí': 'NV', 'Chi nhánh': 'Trụ sở chính',
  'Ngày vào làm': '2026-09-01', 'Tính chất công việc': 'Toàn thời gian',
  'Loại hợp đồng': 'Xác định thời hạn', 'Trạng thái': 'Đang làm', 'Lương': 12000000,
}

test('HR downloads a readable, lightly styled template with catalogs', async () => {
  const response = await fetch(`${baseUrl}/org/employees/import-template`, { headers: auth('hr') })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /spreadsheetml/)
  assert.match(response.headers.get('content-disposition') ?? '', /attachment/)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()))
  const input = workbook.getWorksheet('Nhân viên')
  assert.ok(input)
  assert.equal(input.getCell('A1').value, 'Mã nhân viên')
  assert.equal(input.views[0]?.state, 'frozen')
  assert.ok(input.getColumn(4).width! >= 24)
  assert.ok(input.getCell('A1').fill)
  assert.ok(workbook.getWorksheet('Danh mục'))
  assert.ok(workbook.getWorksheet('Hướng dẫn'))
})

test('invalid upload reports errors by spreadsheet row and inserts nothing', async () => {
  const response = await upload('hr', [
    { ...validRow, 'Mã nhân viên': 'HR01', Email: 'not-an-email' },
    { ...validRow, 'Mã nhân viên': 'NV901', Email: 'second@example.test', 'Mã phòng ban': 'MISSING' },
  ])
  assert.equal(response.status, 422)
  const body = await response.json() as any
  assert.equal(body.importedCount, 0)
  assert.equal(body.totalRows, 2)
  assert.ok(body.errors.some((error: any) => error.row === 2 && error.field === 'Mã nhân viên'))
  assert.ok(body.errors.some((error: any) => error.row === 2 && error.field === 'Email'))
  assert.ok(body.errors.some((error: any) => error.row === 3 && error.field === 'Mã phòng ban'))
  assert.equal((db.prepare("SELECT COUNT(*) count FROM employees WHERE employee_code IN ('NV900','NV901')").get() as any).count, 0)
})

test('valid upload atomically creates all rows and records one audit event', async () => {
  const response = await upload('hr', [
    validRow,
    { ...validRow, 'Mã nhân viên': 'NV901', Email: 'lan@example.test', 'Họ': 'Lê', 'Tên': 'Lan', 'Mã quản lý': 'HR01' },
  ])
  assert.equal(response.status, 201)
  const body = await response.json() as any
  assert.deepEqual(body, { totalRows: 2, importedCount: 2, errors: [] })
  assert.equal((db.prepare("SELECT COUNT(*) count FROM employees WHERE employee_code IN ('NV900','NV901')").get() as any).count, 2)
  assert.equal((db.prepare("SELECT COUNT(*) count FROM audit_logs WHERE entity='EmployeeImport'").get() as any).count, 1)
})

test('scoped HR cannot import into another department and ordinary employees cannot import', async () => {
  const outside = await upload('hr', [{ ...validRow, 'Mã phòng ban': 'IT' }])
  assert.equal(outside.status, 422)
  const outsideBody = await outside.json() as any
  assert.ok(outsideBody.errors.some((error: any) => error.row === 2 && error.field === 'Mã phòng ban'))
  assert.equal((db.prepare("SELECT COUNT(*) count FROM employees WHERE employee_code='NV900'").get() as any).count, 0)

  const forbidden = await upload('ordinary', [validRow])
  assert.equal(forbidden.status, 403)
})

test('export respects employee scope and hides compensation without its permission', async () => {
  setPermission('HR', 'org.employee.view_compensation', false)
  const response = await fetch(`${baseUrl}/org/employees/export-excel`, { headers: auth('hr') })
  assert.equal(response.status, 200)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()))
  const sheet = workbook.getWorksheet('Nhân viên')!
  const headers = (sheet.getRow(1).values as unknown[]).map(String)
  assert.equal(headers.includes('Lương'), false)
  const codes = Array.from({ length: sheet.rowCount - 1 }, (_, index) => String(sheet.getCell(index + 2, 1).value))
  assert.equal(codes.includes('HR01'), true)
  assert.equal(codes.includes('EMP01'), false)
})

test('upload rejects non-xlsx content without parsing it', async () => {
  const response = await fetch(`${baseUrl}/org/employees/import-excel`, {
    method: 'POST',
    headers: { ...auth('hr'), 'Content-Type': 'text/plain' },
    body: 'not a workbook',
  })
  assert.equal(response.status, 415)
})
