import ExcelJS from 'exceljs'
import { db } from '../db.js'
import { pushAudit } from '../helpers.js'
import { isoNow } from '../lib/date.js'
import { mapEmployee, uid } from '../repo.js'
import {
  canCreateEmployeeInDepartment,
  canViewEmployee,
  ORGANIZATION_PERMISSIONS,
} from '../authz/organizationAuthorization.js'
import type { AuthorizationActor } from '../authz/authorizationActor.js'

export const EMPLOYEE_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const EMPLOYEE_IMPORT_MAX_BYTES = 5 * 1024 * 1024
export const EMPLOYEE_IMPORT_MAX_ROWS = 1000

export interface EmployeeImportError {
  row: number
  field: string
  message: string
}

export interface EmployeeImportResult {
  totalRows: number
  importedCount: number
  errors: EmployeeImportError[]
}

const HEADERS = [
  'Mã nhân viên', 'Họ', 'Tên', 'Email', 'Số điện thoại', 'Giới tính', 'Ngày sinh',
  'Mã phòng ban', 'Mã vị trí', 'Chi nhánh', 'Mã quản lý', 'Ngày vào làm',
  'Tính chất công việc', 'Loại hợp đồng', 'Trạng thái', 'Lương',
] as const

type Header = typeof HEADERS[number]
type RawImportRow = Record<Header, unknown>

interface ValidEmployeeRow {
  rowNumber: number
  employeeCode: string
  firstName: string
  lastName: string
  email: string
  phone: string
  gender: number
  dateOfBirth: string | null
  departmentId: string
  positionId: string
  branchId: string | null
  managerCode: string | null
  hireDate: string
  workNature: number
  contractType: number
  status: number
  wage: number
}

const genderValues = new Map([['khac', 0], ['nam', 1], ['nu', 2]])
const workNatureValues = new Map([
  ['toan thoi gian', 1], ['ban thoi gian', 2], ['hop dong', 3], ['thuc tap', 4],
  ['thoi vu', 5], ['thu viec', 6],
])
const contractValues = new Map([
  ['khong xac dinh thoi han', 1], ['xac dinh thoi han', 2], ['ban thoi gian', 3],
  ['thoi vu', 4], ['thuc tap', 5],
])
const statusValues = new Map([
  ['thu viec', 1], ['dang lam', 2], ['nghi phep', 3], ['da nghi', 4], ['sa thai', 5],
])

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .trim().toLowerCase().replace(/\s+/g, ' ')
}

function plainCellValue(value: unknown): unknown {
  if (value == null) return ''
  if (value instanceof Date) return value
  if (typeof value !== 'object') return value
  const cell = value as Record<string, unknown>
  if ('formula' in cell || 'sharedFormula' in cell) return { rejectedFormula: true }
  if (Array.isArray(cell.richText)) return cell.richText.map((part: any) => part.text ?? '').join('')
  if (typeof cell.text === 'string') return cell.text
  if (typeof cell.result === 'string' || typeof cell.result === 'number') return cell.result
  return String(value)
}

function asText(value: unknown): string {
  const plain = plainCellValue(value)
  if (plain && typeof plain === 'object') return ''
  return String(plain ?? '').trim()
}

function asDate(value: unknown): string | null {
  const plain = plainCellValue(value)
  if (plain instanceof Date && !Number.isNaN(plain.getTime())) return plain.toISOString().slice(0, 10)
  const text = String(plain ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const parsed = new Date(`${text}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text ? null : text
}

function addError(errors: EmployeeImportError[], row: number, field: Header | 'File', message: string): void {
  errors.push({ row, field, message })
}

function mapEnum(value: unknown, values: Map<string, number>): number | null {
  const text = asText(value)
  if (/^\d+$/.test(text)) {
    const numeric = Number(text)
    return [...values.values()].includes(numeric) ? numeric : null
  }
  return values.get(normalize(text)) ?? null
}

function escapeSpreadsheetFormula(value: unknown): string | number {
  if (typeof value === 'number') return value
  const text = String(value ?? '')
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

function configureSheet(sheet: ExcelJS.Worksheet, columnCount: number): void {
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnCount } }
  sheet.getRow(1).height = 24
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF475569' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } }
  })
}

function setColumnWidths(sheet: ExcelJS.Worksheet): void {
  const widths = [16, 18, 14, 28, 17, 13, 15, 17, 14, 22, 16, 17, 23, 24, 16, 16]
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width })
}

function addCatalogSheet(workbook: ExcelJS.Workbook, actor: AuthorizationActor): void {
  const sheet = workbook.addWorksheet('Danh mục')
  sheet.addRow(['Loại danh mục', 'Mã / giá trị', 'Tên hiển thị'])
  const departments = db.prepare('SELECT id, code, name FROM departments ORDER BY code').all() as any[]
  for (const item of departments) {
    if (canCreateEmployeeInDepartment(actor, item.id)) sheet.addRow(['Phòng ban', item.code, item.name])
  }
  for (const item of db.prepare('SELECT code, name FROM positions ORDER BY code').all() as any[]) sheet.addRow(['Vị trí', item.code, item.name])
  for (const item of db.prepare('SELECT name FROM branches ORDER BY name').all() as any[]) sheet.addRow(['Chi nhánh', item.name, item.name])
  for (const [name, value] of [['Nam', 1], ['Nữ', 2], ['Khác', 0]] as const) sheet.addRow(['Giới tính', value, name])
  for (const [name, value] of [['Toàn thời gian', 1], ['Bán thời gian', 2], ['Hợp đồng', 3], ['Thực tập', 4], ['Thời vụ', 5], ['Thử việc', 6]] as const) sheet.addRow(['Tính chất công việc', value, name])
  for (const [name, value] of [['Không xác định thời hạn', 1], ['Xác định thời hạn', 2], ['Bán thời gian', 3], ['Thời vụ', 4], ['Thực tập', 5]] as const) sheet.addRow(['Loại hợp đồng', value, name])
  for (const [name, value] of [['Thử việc', 1], ['Đang làm', 2], ['Nghỉ phép', 3], ['Đã nghỉ', 4], ['Sa thải', 5]] as const) sheet.addRow(['Trạng thái', value, name])
  configureSheet(sheet, 3)
  sheet.columns.forEach((column, index) => { column.width = [24, 20, 30][index] })
}

function addGuideSheet(workbook: ExcelJS.Workbook): void {
  const sheet = workbook.addWorksheet('Hướng dẫn')
  sheet.addRow(['HƯỚNG DẪN NHẬP NHÂN VIÊN'])
  sheet.mergeCells('A1:B1')
  sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF334155' } }
  sheet.addRows([
    ['1', 'Chỉ nhập dữ liệu trong sheet “Nhân viên”, không đổi tên hoặc xóa hàng tiêu đề.'],
    ['2', 'Các mã phòng ban, mã vị trí và tên chi nhánh phải có trong sheet “Danh mục”.'],
    ['3', 'Ngày dùng định dạng YYYY-MM-DD, ví dụ 2026-09-04.'],
    ['4', 'Mã nhân viên và email không được trùng trong file hoặc trên hệ thống.'],
    ['5', `Tối đa ${EMPLOYEE_IMPORT_MAX_ROWS} nhân viên mỗi file; nếu có bất kỳ dòng sai, hệ thống không nhập dòng nào.`],
    ['Ví dụ', 'NV001 | Nguyễn | An | an@congty.vn | 0901234567 | Nam | 1995-06-15 | HR | NV | Trụ sở chính | (để trống) | 2026-09-01 | Toàn thời gian | Xác định thời hạn | Đang làm | 12000000'],
  ])
  sheet.getColumn(1).width = 8
  sheet.getColumn(2).width = 90
  sheet.getColumn(2).alignment = { wrapText: true, vertical: 'top' }
}

export async function createEmployeeTemplate(actor: AuthorizationActor): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'HRM Chấm công'
  workbook.created = new Date()
  const sheet = workbook.addWorksheet('Nhân viên')
  sheet.addRow([...HEADERS])
  configureSheet(sheet, HEADERS.length)
  setColumnWidths(sheet)
  sheet.getColumn(16).numFmt = '#,##0'
  addCatalogSheet(workbook, actor)
  addGuideSheet(workbook)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function createEmployeeExport(actor: AuthorizationActor): Promise<Buffer> {
  const includePrivate = actor.permissions.has(ORGANIZATION_PERMISSIONS.EMPLOYEE_VIEW_PRIVATE)
  const includeWage = actor.permissions.has(ORGANIZATION_PERMISSIONS.EMPLOYEE_VIEW_COMPENSATION)
  const headers = ['Mã nhân viên', 'Họ tên', 'Email', 'Phòng ban', 'Vị trí', 'Chi nhánh', 'Trạng thái']
  if (includePrivate) headers.push('Số điện thoại', 'Ngày sinh', 'Ngày vào làm', 'Tính chất công việc', 'Loại hợp đồng')
  if (includeWage) headers.push('Lương')
  const departments = new Map((db.prepare('SELECT id, name FROM departments').all() as any[]).map((row) => [row.id, row.name]))
  const positions = new Map((db.prepare('SELECT id, name FROM positions').all() as any[]).map((row) => [row.id, row.name]))
  const branches = new Map((db.prepare('SELECT id, name FROM branches').all() as any[]).map((row) => [row.id, row.name]))
  const statusNames = ['', 'Thử việc', 'Đang làm', 'Nghỉ phép', 'Đã nghỉ', 'Sa thải']
  const workNames = ['', 'Toàn thời gian', 'Bán thời gian', 'Hợp đồng', 'Thực tập', 'Thời vụ', 'Thử việc']
  const contractNames = ['', 'Không xác định thời hạn', 'Xác định thời hạn', 'Bán thời gian', 'Thời vụ', 'Thực tập']

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Nhân viên')
  sheet.addRow(headers)
  const employees = (db.prepare('SELECT * FROM employees ORDER BY employee_code').all() as any[])
    .map(mapEmployee).filter((employee) => canViewEmployee(actor, employee))
  for (const employee of employees) {
    const row: Array<string | number> = [
      employee.employeeCode, employee.fullName, employee.email,
      departments.get(employee.departmentId) ?? '', positions.get(employee.positionId) ?? '',
      branches.get(employee.branchId) ?? '', statusNames[employee.status] ?? String(employee.status),
    ]
    if (includePrivate) row.push(employee.phone, employee.dateOfBirth ?? '', employee.hireDate, workNames[employee.workNature] ?? '', contractNames[employee.contractType] ?? '')
    if (includeWage) row.push(employee.wage)
    sheet.addRow(row.map(escapeSpreadsheetFormula))
  }
  configureSheet(sheet, headers.length)
  sheet.columns.forEach((column, index) => { column.width = index === 1 || index === 2 ? 26 : 18 })
  if (includeWage) sheet.getColumn(headers.length).numFmt = '#,##0'
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

function isFormula(value: unknown): boolean {
  return !!value && typeof value === 'object' && ('formula' in (value as object) || 'sharedFormula' in (value as object))
}

export async function importEmployeesFromExcel(buffer: Buffer, actor: AuthorizationActor): Promise<EmployeeImportResult> {
  const errors: EmployeeImportError[] = []
  const workbook = new ExcelJS.Workbook()
  // ExcelJS currently declares the pre-Node-22 Buffer shape; runtime accepts the Node Buffer directly.
  try { await workbook.xlsx.load(buffer as any) }
  catch { return { totalRows: 0, importedCount: 0, errors: [{ row: 0, field: 'File', message: 'File Excel bị hỏng hoặc không đúng định dạng .xlsx.' }] } }
  const sheet = workbook.getWorksheet('Nhân viên') ?? workbook.worksheets[0]
  if (!sheet) return { totalRows: 0, importedCount: 0, errors: [{ row: 0, field: 'File', message: 'Không tìm thấy sheet Nhân viên.' }] }
  const actualHeaders = Array.from({ length: HEADERS.length }, (_, index) => asText(sheet.getCell(1, index + 1).value))
  HEADERS.forEach((header, index) => {
    if (actualHeaders[index] !== header) addError(errors, 1, 'File', `Cột ${index + 1} phải là “${header}”. Hãy dùng file mẫu mới nhất.`)
  })
  if (errors.length > 0) return { totalRows: 0, importedCount: 0, errors }

  const rawRows: Array<{ rowNumber: number; values: RawImportRow }> = []
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    const rowValues = Array.isArray(row.values) ? row.values.slice(1) : []
    if (rowValues.every((value) => asText(value) === '')) continue
    const values = Object.fromEntries(HEADERS.map((header, index) => [header, row.getCell(index + 1).value])) as RawImportRow
    rawRows.push({ rowNumber, values })
  }
  if (rawRows.length === 0) addError(errors, 0, 'File', 'File chưa có dòng nhân viên nào để nhập.')
  if (rawRows.length > EMPLOYEE_IMPORT_MAX_ROWS) addError(errors, 0, 'File', `Mỗi file chỉ được nhập tối đa ${EMPLOYEE_IMPORT_MAX_ROWS} nhân viên.`)

  const departments = new Map((db.prepare('SELECT id, code FROM departments').all() as any[]).map((row) => [normalize(row.code), row.id]))
  const positions = new Map((db.prepare('SELECT id, code FROM positions').all() as any[]).map((row) => [normalize(row.code), row.id]))
  const branches = new Map((db.prepare('SELECT id, name FROM branches').all() as any[]).map((row) => [normalize(row.name), row.id]))
  const existingCodes = new Map((db.prepare('SELECT id, employee_code FROM employees').all() as any[]).map((row) => [normalize(row.employee_code), row.id]))
  const existingEmails = new Set((db.prepare('SELECT email FROM employees').all() as any[]).map((row) => normalize(row.email)))
  const fileCodes = new Set<string>()
  const fileEmails = new Set<string>()
  const validRows: ValidEmployeeRow[] = []

  for (const { rowNumber, values } of rawRows) {
    for (const header of HEADERS) if (isFormula(values[header])) addError(errors, rowNumber, header, 'Không chấp nhận công thức Excel trong dữ liệu nhập.')
    const employeeCode = asText(values['Mã nhân viên'])
    const firstName = asText(values['Tên'])
    const lastName = asText(values['Họ'])
    const email = asText(values.Email)
    const departmentCode = asText(values['Mã phòng ban'])
    const positionCode = asText(values['Mã vị trí'])
    const branchName = asText(values['Chi nhánh'])
    const managerCode = asText(values['Mã quản lý']) || null
    const dateOfBirthText = asText(values['Ngày sinh'])
    const hireDateText = asText(values['Ngày vào làm'])

    if (!employeeCode || employeeCode.length > 50) addError(errors, rowNumber, 'Mã nhân viên', 'Mã nhân viên là bắt buộc và tối đa 50 ký tự.')
    else if (existingCodes.has(normalize(employeeCode))) addError(errors, rowNumber, 'Mã nhân viên', 'Mã nhân viên đã tồn tại trên hệ thống.')
    else if (fileCodes.has(normalize(employeeCode))) addError(errors, rowNumber, 'Mã nhân viên', 'Mã nhân viên bị trùng trong file.')
    else fileCodes.add(normalize(employeeCode))
    if (!lastName || lastName.length > 100) addError(errors, rowNumber, 'Họ', 'Họ là bắt buộc và tối đa 100 ký tự.')
    if (!firstName || firstName.length > 100) addError(errors, rowNumber, 'Tên', 'Tên là bắt buộc và tối đa 100 ký tự.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) addError(errors, rowNumber, 'Email', 'Email không hợp lệ.')
    else if (existingEmails.has(normalize(email))) addError(errors, rowNumber, 'Email', 'Email đã tồn tại trên hệ thống.')
    else if (fileEmails.has(normalize(email))) addError(errors, rowNumber, 'Email', 'Email bị trùng trong file.')
    else fileEmails.add(normalize(email))
    const phone = asText(values['Số điện thoại'])
    if (phone.length > 30) addError(errors, rowNumber, 'Số điện thoại', 'Số điện thoại tối đa 30 ký tự.')

    const gender = mapEnum(values['Giới tính'], genderValues)
    if (gender == null) addError(errors, rowNumber, 'Giới tính', 'Giới tính phải là Nam, Nữ hoặc Khác.')
    const dateOfBirth = dateOfBirthText ? asDate(values['Ngày sinh']) : null
    if (dateOfBirthText && !dateOfBirth) addError(errors, rowNumber, 'Ngày sinh', 'Ngày sinh phải theo định dạng YYYY-MM-DD và là ngày hợp lệ.')
    const departmentId = departments.get(normalize(departmentCode))
    if (!departmentId) addError(errors, rowNumber, 'Mã phòng ban', 'Mã phòng ban không tồn tại.')
    else if (!canCreateEmployeeInDepartment(actor, departmentId)) addError(errors, rowNumber, 'Mã phòng ban', 'Bạn không có quyền nhập nhân viên vào phòng ban này.')
    const positionId = positions.get(normalize(positionCode))
    if (!positionId) addError(errors, rowNumber, 'Mã vị trí', 'Mã vị trí không tồn tại.')
    const branchId = branchName ? branches.get(normalize(branchName)) : null
    if (branchName && !branchId) addError(errors, rowNumber, 'Chi nhánh', 'Tên chi nhánh không tồn tại.')
    if (managerCode && normalize(managerCode) === normalize(employeeCode)) addError(errors, rowNumber, 'Mã quản lý', 'Nhân viên không thể tự quản lý chính mình.')

    const hireDate = asDate(values['Ngày vào làm'])
    if (!hireDateText || !hireDate) addError(errors, rowNumber, 'Ngày vào làm', 'Ngày vào làm là bắt buộc, theo định dạng YYYY-MM-DD.')
    const workNature = mapEnum(values['Tính chất công việc'], workNatureValues)
    if (workNature == null) addError(errors, rowNumber, 'Tính chất công việc', 'Tính chất công việc không hợp lệ; hãy chọn trong sheet Danh mục.')
    const contractType = mapEnum(values['Loại hợp đồng'], contractValues)
    if (contractType == null) addError(errors, rowNumber, 'Loại hợp đồng', 'Loại hợp đồng không hợp lệ; hãy chọn trong sheet Danh mục.')
    const status = mapEnum(values['Trạng thái'], statusValues)
    if (status == null) addError(errors, rowNumber, 'Trạng thái', 'Trạng thái không hợp lệ; hãy chọn trong sheet Danh mục.')
    const wageText = asText(values.Lương)
    const wage = wageText === '' ? 0 : Number(wageText)
    if (!Number.isFinite(wage) || wage < 0) addError(errors, rowNumber, 'Lương', 'Lương phải là số không âm.')

    validRows.push({ rowNumber, employeeCode, firstName, lastName, email, phone, gender: gender ?? 1, dateOfBirth,
      departmentId: departmentId ?? '', positionId: positionId ?? '', branchId: branchId ?? null, managerCode, hireDate: hireDate ?? '',
      workNature: workNature ?? 1, contractType: contractType ?? 2, status: status ?? 1, wage: Number.isFinite(wage) ? wage : 0 })
  }

  const allCodes = new Set([...existingCodes.keys(), ...fileCodes])
  for (const row of validRows) {
    if (row.managerCode && !allCodes.has(normalize(row.managerCode))) addError(errors, row.rowNumber, 'Mã quản lý', 'Mã quản lý không tồn tại trên hệ thống hoặc trong file.')
  }
  if (errors.length > 0) return { totalRows: rawRows.length, importedCount: 0, errors }

  const create = db.transaction(() => {
    const newIds = new Map(validRows.map((row) => [normalize(row.employeeCode), uid('emp-import')]))
    for (const row of validRows) {
      const id = newIds.get(normalize(row.employeeCode))!
      const managerId = row.managerCode ? (existingCodes.get(normalize(row.managerCode)) ?? newIds.get(normalize(row.managerCode)) ?? null) : null
      db.prepare(`INSERT INTO employees
        (id, employee_code, first_name, last_name, full_name, gender, date_of_birth, email, phone, address,
         marital_status, status, avatar_data, manager_id, department_id, position_id, branch_id, hire_date,
         work_nature, contract_type, wage, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'Single', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, row.employeeCode, row.firstName, row.lastName, `${row.lastName} ${row.firstName}`.trim(), row.gender,
          row.dateOfBirth, row.email, row.phone, row.status, managerId, row.departmentId, row.positionId, row.branchId,
          row.hireDate, row.workNature, row.contractType, row.wage, isoNow())
    }
    pushAudit(actor.userId, actor.email, 1, 'EmployeeImport', null, `Nhập Excel thành công ${validRows.length} nhân viên`)
  })
  create.immediate()
  return { totalRows: rawRows.length, importedCount: validRows.length, errors: [] }
}
