import { Router } from 'express'
import { db } from '../db.js'
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js'
import { mapPayslip, mapSummaryTimesheet } from '../repo.js'
import { httpError } from '../types.js'
import { eachDayOfInterval, halfMonthRange, ymd } from '../lib/date.js'
import { canListSummaries, canListTimesheetDetail, canViewTimesheetEmployee } from '../authz/timesheetAuthorization.js'
import { canViewOwnPayslip, PAYROLL_PERMISSIONS } from '../authz/payrollAuthorization.js'
import {
  approvePayrollPeriod, buildSummaryForActor, confirmSummary, listSummariesForActor, parsePeriod,
  projectSummaryForActor, rebuildSummary, transferSummaryToPayroll,
} from '../services/timesheetService.js'
import { createTabularExcel, createTabularPdf, PDF_MIME, XLSX_MIME } from '../services/tabularDocumentService.js'
import { pushAudit } from '../helpers.js'

export const timesheetRouter = Router()

function parseDetailedRange(req: AuthedRequest): { year: number; month: number; half: 1 | 2; from: string; to: string } {
  const year = Number(req.query.year), month = Number(req.query.month), half = Number(req.query.half ?? 1)
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12 || (half !== 1 && half !== 2)) {
    throw httpError(400, 'Kỳ bảng công không hợp lệ.')
  }
  const range = halfMonthRange(year, month, half as 1 | 2)
  return { year, month, half: half as 1 | 2, from: ymd(range.from), to: ymd(range.to) }
}

timesheetRouter.get('/detailed/export-excel', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const actor = req.authorizationActor!
    if (!canListTimesheetDetail(actor)) throw httpError(403, 'Bạn không có quyền xuất bảng công.')
    const { year, month, half, from, to } = parseDetailedRange(req)
    const requestedDepartment = typeof req.query.departmentId === 'string' ? req.query.departmentId : null
    const employees = (db.prepare('SELECT id, employee_code, full_name, department_id FROM employees WHERE status=2').all() as any[])
      .filter((employee) => !requestedDepartment || employee.department_id === requestedDepartment)
      .filter((employee) => canViewTimesheetEmployee(actor, { id: employee.id, departmentId: employee.department_id }))
    const rows = employees.flatMap((employee) => (db.prepare(`SELECT * FROM attendance_records
      WHERE employee_id=? AND date BETWEEN ? AND ? ORDER BY date`).all(employee.id, from, to) as any[]).map((record) => ({
        employeeCode: employee.employee_code, employeeName: employee.full_name, date: record.date,
        shiftName: record.shift_name, checkIn: record.check_in_time, checkOut: record.check_out_time,
        workHours: record.work_hours, actualHours: record.actual_work_hours, lateMinutes: record.late_minutes,
        earlyMinutes: record.early_leave_minutes, overtimeHours: record.overtime_hours, status: record.status,
      })))
    const file = await createTabularExcel({
      title: `Bảng công chi tiết tháng ${String(month).padStart(2, '0')}/${year} - kỳ ${half}`,
      subtitle: `${from} đến ${to} · ${rows.length} bản ghi`, sheetName: 'Bảng công chi tiết', rows,
      columns: [
        { header: 'Mã NV', key: 'employeeCode', width: 14 }, { header: 'Họ tên', key: 'employeeName', width: 26 },
        { header: 'Ngày', key: 'date', width: 14 }, { header: 'Ca', key: 'shiftName', width: 20 },
        { header: 'Giờ vào', key: 'checkIn', width: 18 }, { header: 'Giờ ra', key: 'checkOut', width: 18 },
        { header: 'Giờ tính công', key: 'workHours', width: 14, numeric: true }, { header: 'Giờ thực tế', key: 'actualHours', width: 14, numeric: true },
        { header: 'Phút muộn', key: 'lateMinutes', width: 12, numeric: true }, { header: 'Phút về sớm', key: 'earlyMinutes', width: 14, numeric: true },
        { header: 'Giờ OT', key: 'overtimeHours', width: 12, numeric: true }, { header: 'Trạng thái', key: 'status', width: 12, numeric: true },
      ],
    })
    res.setHeader('Content-Type', XLSX_MIME)
    res.setHeader('Content-Disposition', `attachment; filename="bang-cong-${year}-${String(month).padStart(2, '0')}-ky-${half}.xlsx"`)
    pushAudit(req.user!.id, req.user!.email, 6, 'TimesheetExport', null, `Xuất bảng công ${from} đến ${to}`)
    res.send(file)
  } catch (error) { next(error) }
})

async function exportSummary(req: AuthedRequest, format: 'excel' | 'pdf'): Promise<{ buffer: Buffer; fileName: string; mime: string }> {
  const summary = listSummariesForActor(req.authorizationActor!).find((item) => item.id === req.params.id)
  if (!summary) throw httpError(404, 'Không tìm thấy bảng công tổng hợp.')
  const document = {
    title: `Bảng công tổng hợp ${summary.period}`,
    subtitle: `${summary.from} đến ${summary.to} · ${summary.details.length} nhân viên`, sheetName: 'Bảng công tổng hợp',
    rows: summary.details.map((detail: any) => ({
      employeeCode: detail.employeeCode, employeeName: detail.employeeName, paidUnits: detail.paidUnits,
      overtimeHours: detail.otHours, lateEarlyCount: detail.lateEarlyCount, workHours: detail.workHours,
      confirmationStatus: detail.confirmationStatus, confirmationComment: detail.confirmationComment,
    })),
    columns: [
      { header: 'Mã NV', key: 'employeeCode', width: 14 }, { header: 'Họ tên', key: 'employeeName', width: 26 },
      { header: 'Công hưởng', key: 'paidUnits', width: 14, numeric: true }, { header: 'Giờ OT', key: 'overtimeHours', width: 12, numeric: true },
      { header: 'Muộn/Về sớm', key: 'lateEarlyCount', width: 16, numeric: true }, { header: 'Giờ làm', key: 'workHours', width: 14, numeric: true },
      { header: 'Xác nhận', key: 'confirmationStatus', width: 12, numeric: true }, { header: 'Ý kiến', key: 'confirmationComment', width: 28 },
    ],
  }
  const buffer = format === 'excel' ? await createTabularExcel(document) : await createTabularPdf(document)
  return { buffer, fileName: `bang-cong-tong-hop-${summary.period}.${format === 'excel' ? 'xlsx' : 'pdf'}`, mime: format === 'excel' ? XLSX_MIME : PDF_MIME }
}

timesheetRouter.get('/summary/:id/export-excel', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const file = await exportSummary(req, 'excel')
    res.setHeader('Content-Type', file.mime); res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`)
    pushAudit(req.user!.id, req.user!.email, 6, 'SummaryTimesheetExport', req.params.id, 'Xuất Excel bảng công tổng hợp')
    res.send(file.buffer)
  } catch (error) { next(error) }
})

timesheetRouter.get('/summary/:id/export-pdf', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const file = await exportSummary(req, 'pdf')
    res.setHeader('Content-Type', file.mime); res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`)
    pushAudit(req.user!.id, req.user!.email, 6, 'SummaryTimesheetExport', req.params.id, 'Xuất PDF bảng công tổng hợp')
    res.send(file.buffer)
  } catch (error) { next(error) }
})

timesheetRouter.get('/detailed', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const actor = req.authorizationActor!
    if (!canListTimesheetDetail(actor)) throw httpError(403, 'Bạn không có quyền thực hiện thao tác này.')
    const year = Number(req.query.year)
    const month = Number(req.query.month)
    const half = Number(req.query.half ?? 1)
    if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12 || (half !== 1 && half !== 2)) {
      throw httpError(400, 'Kỳ bảng công không hợp lệ.')
    }
    const range = halfMonthRange(year, month, half as 1 | 2)
    const days = eachDayOfInterval({ start: range.from, end: range.to }).map(ymd)
    const requestedDepartment = typeof req.query.departmentId === 'string' ? req.query.departmentId : null
    const employees = (db.prepare('SELECT * FROM employees WHERE status=2').all() as any[])
      .filter((employee) => !requestedDepartment || employee.department_id === requestedDepartment)
      .filter((employee) => canViewTimesheetEmployee(actor, { id: employee.id, departmentId: employee.department_id }))
    const rows: Record<string, Record<string, any>> = {}
    for (const employee of employees) {
      rows[employee.id] = {}
      const records = db.prepare('SELECT * FROM attendance_records WHERE employee_id=? AND date>=? AND date<=?')
        .all(employee.id, days[0], days[days.length - 1]) as any[]
      const byDate = new Map(records.map((record) => [record.date, record]))
      for (const date of days) rows[employee.id][date] = mapAttendanceRecord(byDate.get(date))
    }
    res.json({
      employees: employees.map((employee) => ({
        id: employee.id, employeeCode: employee.employee_code, firstName: employee.first_name, lastName: employee.last_name,
        fullName: employee.full_name, departmentId: employee.department_id, positionId: employee.position_id, status: employee.status,
      })),
      days, rows,
    })
  } catch (error) { next(error) }
})

function mapAttendanceRecord(record: any): any {
  if (!record) return null
  return {
    id: record.id, employeeId: record.employee_id, date: record.date, shiftId: record.shift_id, shiftName: record.shift_name,
    checkInTime: record.check_in_time, checkOutTime: record.check_out_time, actualWorkHours: record.actual_work_hours,
    workHours: record.work_hours, lateMinutes: record.late_minutes, earlyLeaveMinutes: record.early_leave_minutes,
    overtimeHours: record.overtime_hours, status: record.status, mainStatus: record.main_status,
    approvalStatus: record.approval_status, issues: record.issues, notes: record.notes, isActive: !!record.is_active,
    createdAt: record.created_at, updatedAt: record.updated_at,
  }
}

timesheetRouter.post('/build-summary', requireAuth, (req: AuthedRequest, res, next) => {
  try { res.json(buildSummaryForActor(req.authorizationActor!, req.body)) } catch (error) { next(error) }
})

timesheetRouter.get('/list-summary', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    if (!canListSummaries(req.authorizationActor!)) throw httpError(403, 'Bạn không có quyền thực hiện thao tác này.')
    res.json(listSummariesForActor(req.authorizationActor!))
  } catch (error) { next(error) }
})

timesheetRouter.post('/confirm-by-hr/:id', requireAuth, (req: AuthedRequest, res, next) => {
  try { res.json(confirmSummary(req.authorizationActor!, req.params.id, req.body)) } catch (error) { next(error) }
})

timesheetRouter.post('/transfer-to-payroll/:id', requireAuth, (req: AuthedRequest, res, next) => {
  try { res.json(transferSummaryToPayroll(req.authorizationActor!, req.params.id, req.body)) } catch (error) { next(error) }
})

timesheetRouter.post('/rebuild/:id', requireAuth, (req: AuthedRequest, res, next) => {
  try { res.json(rebuildSummary(req.authorizationActor!, req.params.id, req.body)) } catch (error) { next(error) }
})

export const payrollRouter = Router()

payrollRouter.get('/sheet/:period/export-excel', requireAuth, requirePermission(PAYROLL_PERMISSIONS.SHEET_VIEW), async (req: AuthedRequest, res, next) => {
  try {
    const period = parsePeriod(req.params.period)
    const rows = (db.prepare('SELECT * FROM payslips WHERE period=? ORDER BY employee_name').all(period) as any[]).map((row) => ({
      employeeName: row.employee_name, baseSalary: row.base_salary, paidWork: row.paid_work, overtime: row.overtime,
      allowance: row.allowance, gross: row.gross, deductions: row.deductions, net: row.net,
    }))
    const file = await createTabularExcel({
      title: `Bảng lương kỳ ${period}`, subtitle: `${rows.length} nhân viên`, sheetName: 'Bảng lương', rows,
      columns: [
        { header: 'Nhân viên', key: 'employeeName', width: 28 }, { header: 'Lương cơ bản', key: 'baseSalary', width: 18, numeric: true },
        { header: 'Công hưởng', key: 'paidWork', width: 18, numeric: true }, { header: 'Làm thêm', key: 'overtime', width: 16, numeric: true },
        { header: 'Phụ cấp', key: 'allowance', width: 16, numeric: true }, { header: 'Gross', key: 'gross', width: 18, numeric: true },
        { header: 'Khấu trừ', key: 'deductions', width: 16, numeric: true }, { header: 'Thực lĩnh', key: 'net', width: 18, numeric: true },
      ],
    })
    res.setHeader('Content-Type', XLSX_MIME); res.setHeader('Content-Disposition', `attachment; filename="bang-luong-${period}.xlsx"`)
    pushAudit(req.user!.id, req.user!.email, 6, 'PayrollExport', null, `Xuất bảng lương ${period}`)
    res.send(file)
  } catch (error) { next(error) }
})

payrollRouter.get('/payslip/:id/export-pdf', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const row = db.prepare('SELECT * FROM payslips WHERE id=?').get(req.params.id) as any
    if (!row) throw httpError(404, 'Không tìm thấy phiếu lương.')
    const actor = req.authorizationActor!
    if (!actor.permissions.has(PAYROLL_PERMISSIONS.SHEET_VIEW) && !canViewOwnPayslip(actor, row.employee_id)) throw httpError(404, 'Không tìm thấy phiếu lương.')
    const components = (() => { try { return JSON.parse(row.components ?? '[]') as any[] } catch { return [] } })()
    const document = {
      title: `Phiếu lương - ${row.employee_name}`, subtitle: `Kỳ lương ${row.period}`, sheetName: 'Phiếu lương',
      rows: [
        { item: 'Lương cơ bản', amount: row.base_salary }, { item: 'Công hưởng', amount: row.paid_work },
        { item: 'Làm thêm', amount: row.overtime }, { item: 'Phụ cấp', amount: row.allowance },
        ...components.map((component) => ({ item: component.name ?? `Khoản ${component.type}`, amount: component.amount })),
        { item: 'Tổng Gross', amount: row.gross }, { item: 'Tổng khấu trừ', amount: -Math.abs(row.deductions) },
        { item: 'THỰC LĨNH', amount: row.net },
      ],
      columns: [{ header: 'Khoản lương', key: 'item', width: 34 }, { header: 'Số tiền (VNĐ)', key: 'amount', width: 22, numeric: true }],
    }
    const file = await createTabularPdf(document)
    res.setHeader('Content-Type', PDF_MIME); res.setHeader('Content-Disposition', `attachment; filename="phieu-luong-${row.period}-${row.id}.pdf"`)
    pushAudit(req.user!.id, req.user!.email, 6, 'PayslipExport', row.id, `Xuất phiếu lương ${row.period}`)
    res.send(file)
  } catch (error) { next(error) }
})

payrollRouter.get('/mine', requireAuth, requirePermission(PAYROLL_PERMISSIONS.PAYSLIP_VIEW_SELF), (req: AuthedRequest, res) => {
  const list = (db.prepare('SELECT * FROM payslips WHERE employee_id=?').all(req.user!.employeeId) as any[])
    .sort((a, b) => b.period.localeCompare(a.period)).map(mapPayslip)
  res.json({ list, latest: list[0] ?? null })
})

payrollRouter.get('/by-period/:period', requireAuth, requirePermission(PAYROLL_PERMISSIONS.PAYSLIP_VIEW_SELF), (req: AuthedRequest, res, next) => {
  try {
    const period = parsePeriod(req.params.period)
    const row = db.prepare('SELECT * FROM payslips WHERE employee_id=? AND period=?').get(req.user!.employeeId, period) as any
    res.json(row ? mapPayslip(row) : null)
  } catch (error) { next(error) }
})

payrollRouter.get('/sheet/:period', requireAuth, requirePermission(PAYROLL_PERMISSIONS.SHEET_VIEW), (req: AuthedRequest, res, next) => {
  try {
    const period = parsePeriod(req.params.period)
    const summaryRow = db.prepare('SELECT * FROM summary_timesheets WHERE period=?').get(period) as any
    if (!summaryRow) throw httpError(404, 'Không tìm thấy kỳ lương.')
    const summary = projectSummaryForActor(req.authorizationActor!, mapSummaryTimesheet(summaryRow))
    const payslips = (db.prepare('SELECT * FROM payslips WHERE period=?').all(period) as any[])
      .sort((a, b) => a.employee_name.localeCompare(b.employee_name)).map(mapPayslip)
    res.json({ period, status: summary.status, version: summary.version, payslips, capabilities: summary.capabilities })
  } catch (error) { next(error) }
})

payrollRouter.get('/periods', requireAuth, requirePermission(PAYROLL_PERMISSIONS.SHEET_VIEW), (_req, res) => {
  res.json((db.prepare('SELECT period FROM summary_timesheets WHERE status>=4 ORDER BY period DESC').all() as any[]).map((row) => row.period))
})

payrollRouter.post('/approve-payroll/:period', requireAuth, (req: AuthedRequest, res, next) => {
  try { res.json(approvePayrollPeriod(req.authorizationActor!, req.params.period, req.body)) } catch (error) { next(error) }
})
