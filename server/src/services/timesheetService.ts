import { db } from '../db.js'
import { canTransitionSummary, canViewSummaryEmployee, TIMESHEET_PERMISSIONS } from '../authz/timesheetAuthorization.js'
import { canApprovePayroll } from '../authz/payrollAuthorization.js'
import type { AuthorizationActor } from '../authz/authorizationActor.js'
import { allEmployees, getSummary, getSummaryByPeriod, mapSummaryTimesheet, uid } from '../repo.js'
import { pushAudit } from '../helpers.js'
import { halfMonthRange, isoNow, ymd } from '../lib/date.js'
import { buildPayslip } from '../lib/payroll.js'
import { httpError } from '../types.js'

export function parsePeriod(value: unknown): string {
  const period = String(value ?? '')
  if (!/^\d{4}(0[1-9]|1[0-2])[12]$/.test(period)) throw httpError(400, 'Kỳ dữ liệu không hợp lệ.')
  return period
}

export function parseIsoDate(value: unknown, field: string): string {
  const date = String(value ?? '')
  const parsed = new Date(`${date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw httpError(400, `${field} không hợp lệ.`)
  }
  return date
}

export function parseSummaryPeriodInput(body: any): { year: number; month: number; half: 1 | 2; period: string; from: string; to: string } {
  const year = Number(body?.year)
  const month = Number(body?.month)
  const half = Number(body?.half)
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12 || (half !== 1 && half !== 2)) {
    throw httpError(400, 'Kỳ bảng công không hợp lệ.')
  }
  const range = halfMonthRange(year, month, half as 1 | 2)
  return {
    year, month, half: half as 1 | 2,
    period: `${year}${String(month).padStart(2, '0')}${half}`,
    from: ymd(range.from), to: ymd(range.to),
  }
}

function expectedVersion(body: any): number {
  const version = Number(body?.expectedVersion)
  if (!Number.isInteger(version) || version < 1) throw httpError(400, 'expectedVersion không hợp lệ.')
  return version
}

function summaryCapabilities(actor: AuthorizationActor, summary: any) {
  return {
    canRebuild: summary.status === 2 && canTransitionSummary(actor, 'rebuild'),
    canConfirmHr: summary.status === 2 && canTransitionSummary(actor, 'confirm'),
    canTransferPayroll: summary.status === 3 && canTransitionSummary(actor, 'transfer'),
    canApprovePayroll: summary.status === 4 && canApprovePayroll(actor),
  }
}

export function projectSummaryForActor(actor: AuthorizationActor, summary: any): any {
  const details = summary.details.filter((detail: any) => {
    const employee = db.prepare('SELECT id, department_id FROM employees WHERE id=?').get(detail.employeeId) as any
    return employee && canViewSummaryEmployee(actor, { id: employee.id, departmentId: employee.department_id })
  })
  return { ...summary, details, capabilities: summaryCapabilities(actor, summary) }
}

export function listSummariesForActor(actor: AuthorizationActor): any[] {
  return (db.prepare('SELECT * FROM summary_timesheets').all() as any[])
    .sort((a, b) => b.period.localeCompare(a.period))
    .map(mapSummaryTimesheet)
    .map((summary) => projectSummaryForActor(actor, summary))
}

export function buildSummaryForActor(actor: AuthorizationActor, body: any): any {
  if (!actor.permissions.has(TIMESHEET_PERMISSIONS.SUMMARY_BUILD)) throw httpError(403, 'Bạn không có quyền thực hiện thao tác này.')
  const input = parseSummaryPeriodInput(body)
  return db.transaction(() => {
    const existing = getSummaryByPeriod(input.period)
    if (existing) return projectSummaryForActor(actor, existing)
    const id = uid('st')
    db.prepare(`INSERT INTO summary_timesheets (id, period, status, from_date, to_date, version)
      VALUES (?, ?, 2, ?, ?, 1)`).run(id, input.period, input.from, input.to)
    for (const employee of allEmployees().filter((item) => item.status === 2)) {
      const records = db.prepare(`SELECT * FROM attendance_records WHERE employee_id=? AND date>=? AND date<=?`)
        .all(employee.id, input.from, input.to) as any[]
      insertSummaryDetail(id, employee, records)
    }
    pushAudit(actor.userId, actor.email, 1, 'SummaryTimesheet', id, `Tạo bảng công tổng hợp ${input.period}`)
    return projectSummaryForActor(actor, getSummary(id))
  }).immediate()
}

function insertSummaryDetail(summaryId: string, employee: any, records: any[]): void {
  db.prepare(`INSERT INTO summary_timesheet_details (id, summary_timesheet_id, employee_id, employee_name, employee_code,
    paid_units, ot_hours, late_early_count, work_hours, ot_weekday_hours, ot_weekend_hours, ot_holiday_hours, night_hours, night_ot_hours,
    confirmation_status, confirmation_comment) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,NULL)`).run(
    uid('std'), summaryId, employee.id, employee.fullName, employee.employeeCode,
    records.reduce((sum, row) => sum + (row.status === 4 ? 0 : row.work_hours), 0),
    records.reduce((sum, row) => sum + row.overtime_hours, 0),
    records.filter((row) => row.late_minutes > 0 || row.early_leave_minutes > 0).length,
    records.reduce((sum, row) => sum + row.actual_work_hours, 0),
    records.reduce((sum, row) => sum + (row.ot_weekday_hours ?? 0), 0),
    records.reduce((sum, row) => sum + (row.ot_weekend_hours ?? 0), 0),
    records.reduce((sum, row) => sum + (row.ot_holiday_hours ?? 0), 0),
    records.reduce((sum, row) => sum + (row.night_hours ?? 0), 0),
    records.reduce((sum, row) => sum + (row.night_ot_hours ?? 0), 0))
}

function loadSummaryForMutation(id: string, version: number): any {
  const summary = getSummary(id)
  if (!summary) throw httpError(404, 'Không tìm thấy bảng công.')
  if (summary.version !== version) throw httpError(409, 'Dữ liệu đã thay đổi. Vui lòng tải lại.')
  return summary
}

export function confirmSummary(actor: AuthorizationActor, id: string, body: any): any {
  if (!canTransitionSummary(actor, 'confirm')) throw httpError(403, 'Bạn không có quyền thực hiện thao tác này.')
  const version = expectedVersion(body)
  return db.transaction(() => {
    const summary = loadSummaryForMutation(id, version)
    if (summary.status !== 2) throw httpError(409, 'Bảng công không ở trạng thái chờ HR xác nhận.')
    const now = isoNow()
    const update = db.prepare(`UPDATE summary_timesheets SET status=3, version=version+1, confirmed_by=?, confirmed_at=?
      WHERE id=? AND version=? AND status=2`).run(actor.userId, now, id, version)
    if (update.changes !== 1) throw httpError(409, 'Dữ liệu đã thay đổi. Vui lòng tải lại.')
    pushAudit(actor.userId, actor.email, 2, 'SummaryTimesheet', id, 'HR xác nhận bảng công')
    return projectSummaryForActor(actor, getSummary(id))
  }).immediate()
}

export function rebuildSummary(actor: AuthorizationActor, id: string, body: any): any {
  if (!canTransitionSummary(actor, 'rebuild')) throw httpError(403, 'Bạn không có quyền thực hiện thao tác này.')
  const version = expectedVersion(body)
  return db.transaction(() => {
    const summary = loadSummaryForMutation(id, version)
    if (summary.status !== 2) throw httpError(409, 'Chỉ được tính lại bảng công đang ở trạng thái mới tạo.')
    const update = db.prepare('UPDATE summary_timesheets SET version=version+1 WHERE id=? AND version=? AND status=2').run(id, version)
    if (update.changes !== 1) throw httpError(409, 'Dữ liệu đã thay đổi. Vui lòng tải lại.')
    for (const detail of summary.details) {
      const records = db.prepare('SELECT * FROM attendance_records WHERE employee_id=? AND date>=? AND date<=?')
        .all(detail.employeeId, summary.from, summary.to) as any[]
      updateSummaryDetail(detail.id, records)
    }
    pushAudit(actor.userId, actor.email, 2, 'SummaryTimesheet', id, 'Tính lại bảng công')
    return projectSummaryForActor(actor, getSummary(id))
  }).immediate()
}

function updateSummaryDetail(id: string, records: any[]): void {
  db.prepare(`UPDATE summary_timesheet_details SET paid_units=?, ot_hours=?, late_early_count=?, work_hours=?,
    ot_weekday_hours=?, ot_weekend_hours=?, ot_holiday_hours=?, night_hours=?, night_ot_hours=? WHERE id=?`).run(
    records.reduce((sum, row) => sum + (row.status === 4 ? 0 : row.work_hours), 0),
    records.reduce((sum, row) => sum + row.overtime_hours, 0),
    records.filter((row) => row.late_minutes > 0 || row.early_leave_minutes > 0).length,
    records.reduce((sum, row) => sum + row.actual_work_hours, 0),
    records.reduce((sum, row) => sum + (row.ot_weekday_hours ?? 0), 0),
    records.reduce((sum, row) => sum + (row.ot_weekend_hours ?? 0), 0),
    records.reduce((sum, row) => sum + (row.ot_holiday_hours ?? 0), 0),
    records.reduce((sum, row) => sum + (row.night_hours ?? 0), 0),
    records.reduce((sum, row) => sum + (row.night_ot_hours ?? 0), 0), id)
}

export function transferSummaryToPayroll(actor: AuthorizationActor, id: string, body: any): any {
  if (!canTransitionSummary(actor, 'transfer')) throw httpError(403, 'Bạn không có quyền thực hiện thao tác này.')
  const version = expectedVersion(body)
  return db.transaction(() => {
    const summary = loadSummaryForMutation(id, version)
    if (summary.status !== 3) throw httpError(409, 'Bảng công chưa được HR xác nhận hoặc đã chuyển sang lương.')
    const existing = db.prepare('SELECT 1 FROM payslips WHERE period=? LIMIT 1').get(summary.period)
    if (existing) throw httpError(409, 'Kỳ lương đã được tạo. Vui lòng tải lại.')
    const now = isoNow()
    const update = db.prepare(`UPDATE summary_timesheets SET status=4, version=version+1, transferred_by=?, transferred_at=?
      WHERE id=? AND version=? AND status=3`).run(actor.userId, now, id, version)
    if (update.changes !== 1) throw httpError(409, 'Dữ liệu đã thay đổi. Vui lòng tải lại.')
    for (const detail of summary.details) createPayslip(summary.period, detail)
    pushAudit(actor.userId, actor.email, 2, 'SummaryTimesheet', id, 'Chuyển bảng công sang lương')
    return projectSummaryForActor(actor, getSummary(id))
  }).immediate()
}

function createPayslip(period: string, detail: any): void {
  const employee = db.prepare('SELECT * FROM employees WHERE id=? AND status=2').get(detail.employeeId) as any
  if (!employee) throw httpError(409, 'Nhân viên trong bảng công không còn hợp lệ.')
  const slip = buildPayslip({
    monthlyWage: employee.wage, paidUnits: detail.paidUnits, actualWorkHours: detail.workHours,
    breakdown: { otWeekday: detail.otWeekdayHours, otWeekend: detail.otWeekendHours, otHoliday: detail.otHolidayHours, night: detail.nightHours, nightOt: detail.nightOtHours },
  })
  db.prepare(`INSERT INTO payslips (id, period, employee_id, employee_name, base_salary, paid_work, overtime, allowance, gross, deductions, net, components)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(uid('ps'), period, employee.id, employee.full_name, slip.base, slip.paidWork,
    slip.overtime, slip.allowance, slip.gross, slip.deductions, slip.net, JSON.stringify(slip.components))
}

export function approvePayrollPeriod(actor: AuthorizationActor, periodValue: unknown, body: any): any {
  if (!canApprovePayroll(actor)) throw httpError(403, 'Bạn không có quyền thực hiện thao tác này.')
  const period = parsePeriod(periodValue)
  const version = expectedVersion(body)
  return db.transaction(() => {
    const summary = getSummaryByPeriod(period)
    if (!summary) throw httpError(404, 'Không tìm thấy kỳ lương.')
    if (summary.version !== version) throw httpError(409, 'Dữ liệu đã thay đổi. Vui lòng tải lại.')
    if (summary.status !== 4) throw httpError(409, 'Kỳ lương không ở trạng thái chờ duyệt.')
    const now = isoNow()
    const update = db.prepare(`UPDATE summary_timesheets SET status=5, version=version+1, approved_by=?, approved_at=?
      WHERE id=? AND version=? AND status=4`).run(actor.userId, now, summary.id, version)
    if (update.changes !== 1) throw httpError(409, 'Dữ liệu đã thay đổi. Vui lòng tải lại.')
    pushAudit(actor.userId, actor.email, 2, 'Payroll', summary.id, `Duyệt kỳ lương ${period}`)
    return { ok: true, period, status: 5, version: version + 1 }
  }).immediate()
}
