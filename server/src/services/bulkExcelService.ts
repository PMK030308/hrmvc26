import ExcelJS from 'exceljs'
import { db } from '../db.js'
import { processPunch, recomputeAll } from '../engines/attendance.js'
import { pushAudit } from '../helpers.js'
import { isoNow } from '../lib/date.js'
import { uid } from '../repo.js'
import type { AuthorizationActor } from '../authz/authorizationActor.js'
import { canManageShiftSchedule, canViewShiftSchedule } from '../authz/shiftAuthorization.js'
import { canViewAttendance } from '../authz/attendanceAuthorization.js'
import { createTabularExcel } from './tabularDocumentService.js'
import { httpError } from '../types.js'

export const BULK_EXCEL_MAX_BYTES = 5 * 1024 * 1024
export const BULK_EXCEL_MAX_ROWS = 5_000

export interface BulkImportError {
  row: number
  field: string
  message: string
}

export interface BulkImportResult {
  totalRows: number
  importedCount: number
  errors: BulkImportError[]
}

function text(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    const hours = String(value.getHours()).padStart(2, '0')
    const minutes = String(value.getMinutes()).padStart(2, '0')
    const seconds = String(value.getSeconds()).padStart(2, '0')
    return hours === '00' && minutes === '00' && seconds === '00'
      ? `${year}-${month}-${day}`
      : `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`
  }
  if (typeof value === 'object') {
    if ('text' in value) return String(value.text ?? '').trim()
    if ('result' in value) return String(value.result ?? '').trim()
    if ('richText' in value) return value.richText.map((part) => part.text).join('').trim()
  }
  return String(value).trim()
}

function normalize(value: string): string {
  return value.trim().toLocaleUpperCase('vi-VN')
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00`)
  return !Number.isNaN(parsed.getTime()) && parsed.getFullYear() === Number(value.slice(0, 4))
    && parsed.getMonth() + 1 === Number(value.slice(5, 7)) && parsed.getDate() === Number(value.slice(8, 10))
}

function validDateTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return false
  return !Number.isNaN(new Date(value).getTime())
}

async function loadRows(buffer: Buffer, expectedHeaders: readonly string[]): Promise<Array<{ row: number; values: Record<string, string> }>> {
  const workbook = new ExcelJS.Workbook()
  try { await workbook.xlsx.load(buffer as any) } catch { throw httpError(400, 'File Excel không hợp lệ hoặc đã bị hỏng.') }
  const sheet = workbook.worksheets[0]
  if (!sheet) return []
  const headerMap = new Map<string, number>()
  sheet.getRow(1).eachCell((cell, column) => headerMap.set(normalize(text(cell.value)), column))
  for (const header of expectedHeaders) {
    if (!headerMap.has(normalize(header))) throw httpError(400, `Thiếu cột bắt buộc: ${header}.`)
  }
  const rows: Array<{ row: number; values: Record<string, string> }> = []
  sheet.eachRow((excelRow, rowNumber) => {
    if (rowNumber === 1) return
    const values = Object.fromEntries(expectedHeaders.map((header) => [header, text(excelRow.getCell(headerMap.get(normalize(header))!).value)]))
    if (Object.values(values).some(Boolean)) rows.push({ row: rowNumber, values })
  })
  if (rows.length > BULK_EXCEL_MAX_ROWS) throw httpError(400, `Mỗi file chỉ được tối đa ${BULK_EXCEL_MAX_ROWS} dòng.`)
  return rows
}

function addTemplateHeader(sheet: ExcelJS.Worksheet, headers: readonly string[], widths: number[]): void {
  const row = sheet.addRow([...headers])
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }
  row.alignment = { horizontal: 'center', vertical: 'middle' }
  headers.forEach((_header, index) => { sheet.getColumn(index + 1).width = widths[index] ?? 18 })
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } }
}

const SHIFT_HEADERS = ['Mã nhân viên', 'Ngày', 'Mã ca'] as const

export async function createShiftScheduleTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const input = workbook.addWorksheet('Phân ca')
  addTemplateHeader(input, SHIFT_HEADERS, [18, 16, 16])
  input.addRow(['NV001', '2026-09-04', 'HC'])
  const catalog = workbook.addWorksheet('Danh mục ca')
  catalog.addRow(['Mã ca', 'Tên ca', 'Bắt đầu', 'Kết thúc'])
  for (const shift of db.prepare('SELECT code, name, start_time, end_time FROM shifts WHERE status=1 ORDER BY code').all() as any[]) {
    catalog.addRow([shift.code, shift.name, shift.start_time, shift.end_time])
  }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function createShiftScheduleExport(actor: AuthorizationActor, year: number, month: number, departmentId?: string): Promise<Buffer> {
  const from = `${year}-${String(month).padStart(2, '0')}-01`
  const to = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`
  const rows = (db.prepare(`SELECT e.id employee_id, e.employee_code, e.full_name, e.department_id,
      s.date, sh.code shift_code, sh.name shift_name, sh.start_time, sh.end_time
    FROM shift_schedules s JOIN employees e ON e.id=s.employee_id JOIN shifts sh ON sh.id=s.shift_id
    WHERE s.is_active=1 AND s.date BETWEEN ? AND ? ORDER BY e.employee_code, s.date`).all(from, to) as any[])
    .filter((row) => (!departmentId || row.department_id === departmentId)
      && canViewShiftSchedule(actor, { id: row.employee_id, departmentId: row.department_id }))
    .map((row) => ({ employeeCode: row.employee_code, employeeName: row.full_name, date: row.date,
      shiftCode: row.shift_code, shiftName: row.shift_name, startTime: row.start_time, endTime: row.end_time }))
  return createTabularExcel({
    title: `Lịch phân ca tháng ${String(month).padStart(2, '0')}/${year}`,
    subtitle: `${rows.length} lượt phân ca`, sheetName: 'Lịch phân ca', rows,
    columns: [
      { header: 'Mã nhân viên', key: 'employeeCode', width: 16 }, { header: 'Họ tên', key: 'employeeName', width: 28 },
      { header: 'Ngày', key: 'date', width: 14 }, { header: 'Mã ca', key: 'shiftCode', width: 12 },
      { header: 'Tên ca', key: 'shiftName', width: 22 }, { header: 'Bắt đầu', key: 'startTime', width: 12 },
      { header: 'Kết thúc', key: 'endTime', width: 12 },
    ],
  })
}

export async function importShiftSchedule(buffer: Buffer, actor: AuthorizationActor): Promise<BulkImportResult> {
  const rows = await loadRows(buffer, SHIFT_HEADERS)
  const employees = new Map((db.prepare('SELECT id, employee_code, department_id, status FROM employees').all() as any[])
    .map((row) => [normalize(row.employee_code), row]))
  const shifts = new Map((db.prepare('SELECT id, code, status FROM shifts').all() as any[]).map((row) => [normalize(row.code), row]))
  const errors: BulkImportError[] = []
  const validRows: Array<{ employeeId: string; date: string; shiftId: string }> = []
  const keys = new Set<string>()
  for (const row of rows) {
    const employee = employees.get(normalize(row.values['Mã nhân viên']))
    const shift = shifts.get(normalize(row.values['Mã ca']))
    const date = row.values.Ngày
    if (!employee || ![1, 2, 3].includes(employee.status) || !canManageShiftSchedule(actor, { id: employee.id, departmentId: employee.department_id })) {
      errors.push({ row: row.row, field: 'Mã nhân viên', message: 'Nhân viên không tồn tại hoặc ngoài phạm vi quản lý.' })
    }
    if (!shift || shift.status !== 1) errors.push({ row: row.row, field: 'Mã ca', message: 'Ca làm không tồn tại hoặc đã ngưng hoạt động.' })
    if (!validDate(date)) errors.push({ row: row.row, field: 'Ngày', message: 'Ngày phải theo định dạng YYYY-MM-DD.' })
    const key = `${employee?.id ?? row.values['Mã nhân viên']}|${date}`
    if (keys.has(key)) errors.push({ row: row.row, field: 'Ngày', message: 'Nhân viên bị trùng ngày phân ca trong file.' })
    keys.add(key)
    if (employee && shift && validDate(date)) validRows.push({ employeeId: employee.id, date, shiftId: shift.id })
  }
  if (errors.length) return { totalRows: rows.length, importedCount: 0, errors }
  db.transaction(() => {
    const affected = new Set<string>()
    for (const row of validRows) {
      db.prepare('DELETE FROM shift_schedules WHERE employee_id=? AND date=?').run(row.employeeId, row.date)
      db.prepare('INSERT INTO shift_schedules (id, employee_id, shift_id, date, rule_id, is_active) VALUES (?,?,?,?,NULL,1)')
        .run(uid('sch'), row.employeeId, row.shiftId, row.date)
      affected.add(row.employeeId)
    }
    for (const employeeId of affected) recomputeAll(employeeId)
    pushAudit(actor.userId, actor.email, 2, 'ShiftScheduleImport', null, `Nhập Excel ${validRows.length} lượt phân ca`)
  }).immediate()
  return { totalRows: rows.length, importedCount: validRows.length, errors: [] }
}

const ATTENDANCE_HEADERS = ['Mã nhân viên', 'Thời điểm chấm', 'Ghi chú'] as const

export async function createAttendanceTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Dữ liệu chấm công')
  addTemplateHeader(sheet, ATTENDANCE_HEADERS, [18, 24, 36])
  sheet.addRow(['NV001', '2026-09-04T08:00:00', 'Dữ liệu từ máy chấm công'])
  sheet.addRow(['NV001', '2026-09-04T17:00:00', 'Dữ liệu từ máy chấm công'])
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function createAttendanceExport(actor: AuthorizationActor, from: string, to: string, departmentId?: string): Promise<Buffer> {
  const rows = (db.prepare(`SELECT e.id employee_id, e.employee_code, e.full_name, e.department_id, r.*
    FROM attendance_records r JOIN employees e ON e.id=r.employee_id
    WHERE r.date BETWEEN ? AND ? ORDER BY e.employee_code, r.date`).all(from, to) as any[])
    .filter((row) => (!departmentId || row.department_id === departmentId)
      && canViewAttendance(actor, { id: row.employee_id, departmentId: row.department_id }))
    .map((row) => ({ employeeCode: row.employee_code, employeeName: row.full_name, date: row.date,
      shiftName: row.shift_name, checkIn: row.check_in_time, checkOut: row.check_out_time,
      actualHours: row.actual_work_hours, workHours: row.work_hours, lateMinutes: row.late_minutes,
      earlyMinutes: row.early_leave_minutes, overtimeHours: row.overtime_hours, notes: row.notes }))
  return createTabularExcel({
    title: 'Dữ liệu chấm công', subtitle: `${from} đến ${to} · ${rows.length} bản ghi`, sheetName: 'Chấm công', rows,
    columns: [
      { header: 'Mã nhân viên', key: 'employeeCode', width: 16 }, { header: 'Họ tên', key: 'employeeName', width: 28 },
      { header: 'Ngày', key: 'date', width: 14 }, { header: 'Ca', key: 'shiftName', width: 20 },
      { header: 'Giờ vào', key: 'checkIn', width: 18 }, { header: 'Giờ ra', key: 'checkOut', width: 18 },
      { header: 'Giờ thực tế', key: 'actualHours', width: 14, numeric: true }, { header: 'Giờ tính công', key: 'workHours', width: 14, numeric: true },
      { header: 'Phút muộn', key: 'lateMinutes', width: 12, numeric: true }, { header: 'Phút về sớm', key: 'earlyMinutes', width: 14, numeric: true },
      { header: 'Giờ OT', key: 'overtimeHours', width: 12, numeric: true }, { header: 'Ghi chú', key: 'notes', width: 28 },
    ],
  })
}

export async function importAttendancePunches(buffer: Buffer, actor: AuthorizationActor): Promise<BulkImportResult> {
  const rows = await loadRows(buffer, ATTENDANCE_HEADERS)
  const employees = new Map((db.prepare('SELECT id, employee_code, department_id, status FROM employees').all() as any[])
    .map((row) => [normalize(row.employee_code), row]))
  const errors: BulkImportError[] = []
  const validRows: Array<{ employeeId: string; punchedAt: string; notes: string }> = []
  const perDay = new Map<string, number>()
  const now = Date.now()
  for (const row of rows) {
    const employee = employees.get(normalize(row.values['Mã nhân viên']))
    const punchedAt = row.values['Thời điểm chấm']
    if (!employee || ![1, 2, 3].includes(employee.status) || !canViewAttendance(actor, { id: employee.id, departmentId: employee.department_id })) {
      errors.push({ row: row.row, field: 'Mã nhân viên', message: 'Nhân viên không tồn tại hoặc ngoài phạm vi được phép.' })
    }
    if (!validDateTime(punchedAt)) errors.push({ row: row.row, field: 'Thời điểm chấm', message: 'Thời điểm phải theo định dạng YYYY-MM-DDTHH:mm:ss.' })
    else if (new Date(punchedAt).getTime() > now + 60_000) errors.push({ row: row.row, field: 'Thời điểm chấm', message: 'Không được nhập thời điểm trong tương lai.' })
    const key = `${employee?.id ?? row.values['Mã nhân viên']}|${punchedAt.slice(0, 10)}`
    perDay.set(key, (perDay.get(key) ?? 0) + 1)
    if ((perDay.get(key) ?? 0) > 2) errors.push({ row: row.row, field: 'Thời điểm chấm', message: 'Mỗi nhân viên chỉ được tối đa 2 lượt chấm trong một ngày.' })
    if (employee && validDateTime(punchedAt)) validRows.push({ employeeId: employee.id, punchedAt: punchedAt.length === 16 ? `${punchedAt}:00` : punchedAt, notes: row.values['Ghi chú'] })
  }
  if (errors.length) return { totalRows: rows.length, importedCount: 0, errors }
  validRows.sort((left, right) => left.punchedAt.localeCompare(right.punchedAt))
  db.transaction(() => {
    for (const row of validRows) {
      const result = processPunch(row.employeeId, 99, {
        fixedPunchedAt: row.punchedAt, notes: row.notes || 'Nhập Excel', deviceInfo: 'Excel import',
        proxyActorUserId: actor.userId, proxyReason: 'Nhập dữ liệu chấm công từ Excel',
      })
      if (!result.success) throw new Error(result.message || 'Không thể nhập lượt chấm công.')
    }
    pushAudit(actor.userId, actor.email, 1, 'AttendanceImport', null, `Nhập Excel ${validRows.length} lượt chấm công lúc ${isoNow()}`)
  }).immediate()
  return { totalRows: rows.length, importedCount: validRows.length, errors: [] }
}
