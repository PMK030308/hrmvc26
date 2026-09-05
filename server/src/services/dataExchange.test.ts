import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before } from 'node:test'
import ExcelJS from 'exceljs'

const directory = mkdtempSync(join(tmpdir(), 'hrm-data-exchange-'))
process.env.HRM_DB_PATH = join(directory, 'data-exchange.db')

const { db, initSchema } = await import('../db.js')
const { runMigrations } = await import('./migrationService.js')
const { createTabularExcel, createTabularPdf } = await import('./tabularDocumentService.js')
const { importShiftSchedule } = await import('./bulkExcelService.js')

before(() => {
  initSchema()
  runMigrations(db)
  db.prepare('INSERT INTO departments (id, code, name) VALUES (?, ?, ?)').run('dept-it', 'IT', 'Công nghệ')
  db.prepare('INSERT INTO positions (id, code, name) VALUES (?, ?, ?)').run('pos-1', 'NV', 'Nhân viên')
  db.prepare(`INSERT INTO employees
    (id, employee_code, first_name, last_name, full_name, email, department_id, position_id, hire_date, status)
    VALUES ('emp-1', 'NV001', 'An', 'Nguyễn', 'Nguyễn An', 'an@example.test', 'dept-it', 'pos-1', '2025-01-01', 2)`).run()
  db.prepare(`INSERT INTO shifts (id, code, name, start_time, end_time, work_days, status, holiday_coefficient, color)
    VALUES ('shift-hc', 'HC', 'Hành chính', '08:00:00', '17:00:00', 1, 1, 1, '#2563eb')`).run()
})

after(() => {
  db.close()
  delete process.env.HRM_DB_PATH
  rmSync(directory, { recursive: true, force: true })
})

test('creates real Excel and PDF documents', async () => {
  const document = {
    title: 'Báo cáo thử nghiệm', sheetName: 'Báo cáo',
    columns: [{ header: 'Nhân viên', key: 'name' }, { header: 'Số giờ', key: 'hours', numeric: true }],
    rows: [{ name: '=HYPERLINK("https://example.test")', hours: 8 }],
  }
  const excel = await createTabularExcel(document)
  const pdf = await createTabularPdf(document)
  assert.equal(excel.subarray(0, 2).toString('ascii'), 'PK')
  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(excel as any)
  assert.equal(workbook.worksheets[0]?.getCell('A4').value, "'=HYPERLINK(\"https://example.test\")")
})

async function shiftWorkbook(rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Phân ca')
  sheet.addRow(['Mã nhân viên', 'Ngày', 'Mã ca'])
  sheet.addRows(rows)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

const actor = {
  userId: 'admin', email: 'admin@example.test', employeeId: 'emp-1', employeeStatus: 2,
  roles: ['Admin'] as import('../types.js').RoleCode[], assignedDepartmentScopes: [], departmentScopes: [],
  permissions: new Set(['shifts.schedule.manage_all']), legacyPermissions: [], isActive: true as const,
  authorizationVersion: 1, sessionVersion: 1,
}

test('imports a valid shift workbook and replaces the employee-day assignment', async () => {
  const result = await importShiftSchedule(await shiftWorkbook([['NV001', '2026-09-04', 'HC']]), actor)
  assert.deepEqual({ totalRows: result.totalRows, importedCount: result.importedCount, errors: result.errors.length }, { totalRows: 1, importedCount: 1, errors: 0 })
  assert.equal((db.prepare('SELECT shift_id FROM shift_schedules WHERE employee_id=? AND date=?').get('emp-1', '2026-09-04') as any).shift_id, 'shift-hc')
})

test('rejects the whole shift workbook when any row is invalid', async () => {
  const result = await importShiftSchedule(await shiftWorkbook([
    ['NV001', '2026-09-05', 'HC'],
    ['UNKNOWN', '2026-09-06', 'HC'],
  ]), actor)
  assert.equal(result.importedCount, 0)
  assert.equal(result.errors.length, 1)
  assert.equal((db.prepare('SELECT COUNT(*) count FROM shift_schedules WHERE date IN (?, ?)').get('2026-09-05', '2026-09-06') as any).count, 0)
})
