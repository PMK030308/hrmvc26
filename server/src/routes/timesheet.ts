import { Router } from 'express'
import { db } from '../db.js'
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js'
import { mapPayslip, mapSummaryTimesheet } from '../repo.js'
import { httpError } from '../types.js'
import { eachDayOfInterval, halfMonthRange, ymd } from '../lib/date.js'
import { canListSummaries, canListTimesheetDetail, canViewTimesheetEmployee } from '../authz/timesheetAuthorization.js'
import { PAYROLL_PERMISSIONS } from '../authz/payrollAuthorization.js'
import {
  approvePayrollPeriod, buildSummaryForActor, confirmSummary, listSummariesForActor, parsePeriod,
  projectSummaryForActor, rebuildSummary, transferSummaryToPayroll,
} from '../services/timesheetService.js'

export const timesheetRouter = Router()

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
