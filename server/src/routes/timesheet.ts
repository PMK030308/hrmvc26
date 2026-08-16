// Timesheet + Payroll routes (§8 / §8.5)
import { Router } from 'express'
import { db } from '../db.js'
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.js'
import { mapSummaryTimesheet, getSummary, getSummaryByPeriod, mapPayslip, allEmployees, uid } from '../repo.js'
import { httpError } from '../types.js'
import { pushAudit } from '../helpers.js'
import { ymd, eachDayOfInterval, halfMonthRange, isoNow } from '../lib/date.js'
import { buildPayslip } from '../lib/payroll.js'

export const timesheetRouter = Router()

timesheetRouter.get('/detailed', requireAuth, requireRole('HR', 'Admin', 'Manager', 'Director', 'Accountant'), (req, res) => {
  const year = Number(req.query.year), month = Number(req.query.month)
  const rng = halfMonthRange(year, month, (Number(req.query.half) || 1) as 1 | 2)
  const days = eachDayOfInterval({ start: rng.from, end: rng.to }).map((d) => ymd(d))
  let emps = (db.prepare('SELECT * FROM employees WHERE status=2').all() as any[])
  if (req.query.departmentId) emps = emps.filter((e) => e.department_id === req.query.departmentId)
  const rows: Record<string, Record<string, any>> = {}
  for (const e of emps) {
    rows[e.id] = {}
    for (const d of days) {
      const r = db.prepare('SELECT * FROM attendance_records WHERE employee_id=? AND date=?').get(e.id, d) as any
      rows[e.id][d] = r ? {
        id: r.id, employeeId: r.employee_id, date: r.date, shiftId: r.shift_id, shiftName: r.shift_name,
        checkInTime: r.check_in_time, checkOutTime: r.check_out_time, actualWorkHours: r.actual_work_hours,
        workHours: r.work_hours, lateMinutes: r.late_minutes, earlyLeaveMinutes: r.early_leave_minutes,
        overtimeHours: r.overtime_hours, status: r.status, mainStatus: r.main_status,
        approvalStatus: r.approval_status, issues: r.issues, notes: r.notes, isActive: !!r.is_active,
        createdAt: r.created_at, updatedAt: r.updated_at,
      } : null
    }
  }
  res.json({
    employees: emps.map((e) => ({
      id: e.id, employeeCode: e.employee_code, firstName: e.first_name, lastName: e.last_name,
      fullName: e.full_name, departmentId: e.department_id, positionId: e.position_id, status: e.status,
    })),
    days, rows,
  })
})

timesheetRouter.post('/build-summary', requireAuth, requireRole('HR', 'Admin'), (req, res) => {
  const year = Number(req.body.year), month = Number(req.body.month), half = req.body.half as 1 | 2
  const rng = halfMonthRange(year, month, half)
  const from = ymd(rng.from), to = ymd(rng.to)
  const period = `${year}${String(month).padStart(2, '0')}${half}`
  const existing = getSummaryByPeriod(period)
  if (existing) return res.json(existing)
  const id = uid('st')
  db.prepare('INSERT INTO summary_timesheets (id, period, status, from_date, to_date) VALUES (?,?,?,?,?)').run(id, period, 2, from, to)
  for (const e of allEmployees().filter((x) => x.status === 2)) {
    const recs = (db.prepare('SELECT * FROM attendance_records WHERE employee_id=? AND date>=? AND date<=?').all(e.id, from, to) as any[])
    db.prepare(`INSERT INTO summary_timesheet_details (id, summary_timesheet_id, employee_id, employee_name, employee_code,
      paid_units, ot_hours, late_early_count, work_hours, ot_weekday_hours, ot_weekend_hours, ot_holiday_hours, night_hours, night_ot_hours,
      confirmation_status, confirmation_comment)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,NULL)`).run(
      uid('std'), id, e.id, e.fullName, e.employeeCode,
      recs.reduce((s, r) => s + (r.status === 4 ? 0 : r.work_hours), 0),
      recs.reduce((s, r) => s + r.overtime_hours, 0),
      recs.filter((r) => r.late_minutes > 0 || r.early_leave_minutes > 0).length,
      recs.reduce((s, r) => s + r.actual_work_hours, 0),
      recs.reduce((s, r) => s + (r.ot_weekday_hours ?? 0), 0),
      recs.reduce((s, r) => s + (r.ot_weekend_hours ?? 0), 0),
      recs.reduce((s, r) => s + (r.ot_holiday_hours ?? 0), 0),
      recs.reduce((s, r) => s + (r.night_hours ?? 0), 0),
      recs.reduce((s, r) => s + (r.night_ot_hours ?? 0), 0))
  }
  pushAudit((req as AuthedRequest).user!.id, (req as AuthedRequest).user!.email, 1, 'SummaryTimesheet', id, `Tạo bảng công tổng hợp ${period}`)
  res.json(getSummary(id))
})

timesheetRouter.get('/list-summary', requireAuth, requireRole('HR', 'Admin', 'Manager', 'Director', 'Accountant'), (_req, res) => {
  res.json((db.prepare('SELECT * FROM summary_timesheets').all() as any[]).sort((a, b) => b.period.localeCompare(a.period)).map(mapSummaryTimesheet))
})

timesheetRouter.post('/confirm-by-hr/:id', requireAuth, requireRole('HR', 'Admin'), (req, res, next) => {
  const st = getSummary(req.params.id)
  if (!st) return next(httpError(404, 'Không tìm thấy bảng công.'))
  db.prepare('UPDATE summary_timesheets SET status=3 WHERE id=?').run(req.params.id)
  pushAudit((req as AuthedRequest).user!.id, (req as AuthedRequest).user!.email, 2, 'SummaryTimesheet', req.params.id, 'HR xác nhận bảng công')
  res.json(getSummary(req.params.id))
})

timesheetRouter.post('/transfer-to-payroll/:id', requireAuth, requireRole('HR', 'Admin', 'Accountant'), (req, res, next) => {
  const st = getSummary(req.params.id)
  if (!st) return next(httpError(404, 'Không tìm thấy bảng công.'))
  db.prepare('UPDATE summary_timesheets SET status=4 WHERE id=?').run(req.params.id)
  for (const d of st.details) {
    const emp = (db.prepare('SELECT * FROM employees WHERE id=?').get(d.employeeId) as any)
    const slip = buildPayslip({
      monthlyWage: emp.wage,
      paidUnits: d.paidUnits,
      actualWorkHours: d.workHours,
      breakdown: { otWeekday: d.otWeekdayHours, otWeekend: d.otWeekendHours, otHoliday: d.otHolidayHours, night: d.nightHours, nightOt: d.nightOtHours },
    })
    db.prepare(`INSERT INTO payslips (id, period, employee_id, employee_name, base_salary, paid_work, overtime, allowance, gross, deductions, net, components)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      uid('ps'), st.period, emp.id, emp.full_name, slip.base, slip.paidWork, slip.overtime, slip.allowance,
      slip.gross, slip.deductions, slip.net, JSON.stringify(slip.components))
  }
  pushAudit((req as AuthedRequest).user!.id, (req as AuthedRequest).user!.email, 2, 'SummaryTimesheet', req.params.id, 'Chuyển bảng công sang lương')
  res.json(getSummary(req.params.id))
})

timesheetRouter.post('/rebuild/:id', requireAuth, requireRole('HR', 'Admin'), (req, res, next) => {
  const st = getSummary(req.params.id)
  if (!st) return next(httpError(404, 'Không tìm thấy bảng công.'))
  for (const d of st.details) {
    const recs = (db.prepare('SELECT * FROM attendance_records WHERE employee_id=? AND date>=? AND date<=?').all(d.employeeId, st.from, st.to) as any[])
    db.prepare(`UPDATE summary_timesheet_details SET paid_units=?, ot_hours=?, late_early_count=?, work_hours=?,
      ot_weekday_hours=?, ot_weekend_hours=?, ot_holiday_hours=?, night_hours=?, night_ot_hours=? WHERE id=?`).run(
      recs.reduce((s, r) => s + (r.status === 4 ? 0 : r.work_hours), 0),
      recs.reduce((s, r) => s + r.overtime_hours, 0),
      recs.filter((r) => r.late_minutes > 0 || r.early_leave_minutes > 0).length,
      recs.reduce((s, r) => s + r.actual_work_hours, 0),
      recs.reduce((s, r) => s + (r.ot_weekday_hours ?? 0), 0),
      recs.reduce((s, r) => s + (r.ot_weekend_hours ?? 0), 0),
      recs.reduce((s, r) => s + (r.ot_holiday_hours ?? 0), 0),
      recs.reduce((s, r) => s + (r.night_hours ?? 0), 0),
      recs.reduce((s, r) => s + (r.night_ot_hours ?? 0), 0), d.id)
  }
  pushAudit((req as AuthedRequest).user!.id, (req as AuthedRequest).user!.email, 2, 'SummaryTimesheet', req.params.id, 'Tính lại bảng công')
  res.json(getSummary(req.params.id))
})

/* ------------------------------ Payroll ----------------------------------- */
export const payrollRouter = Router()

payrollRouter.get('/mine', requireAuth, requireRole('Employee', 'Manager', 'HR', 'Director', 'Admin', 'Accountant'), (req: AuthedRequest, res) => {
  const list = (db.prepare('SELECT * FROM payslips WHERE employee_id=?').all(req.user!.employeeId) as any[])
    .sort((a, b) => b.period.localeCompare(a.period)).map(mapPayslip)
  res.json({ list, latest: list[0] ?? null })
})

payrollRouter.get('/by-period/:period', requireAuth, requireRole('Employee', 'Manager', 'HR', 'Director', 'Admin', 'Accountant'), (req: AuthedRequest, res) => {
  const r = db.prepare('SELECT * FROM payslips WHERE employee_id=? AND period=?').get(req.user!.employeeId, req.params.period) as any
  res.json(r ? mapPayslip(r) : null)
})

payrollRouter.get('/sheet/:period', requireAuth, requireRole('Accountant', 'HR', 'Admin', 'Director'), (req, res) => {
  res.json((db.prepare('SELECT * FROM payslips WHERE period=?').all(req.params.period) as any[])
    .sort((a, b) => a.employee_name.localeCompare(b.employee_name)).map(mapPayslip))
})

payrollRouter.get('/periods', requireAuth, requireRole('Accountant', 'HR', 'Admin', 'Director'), (_req, res) => {
  res.json(Array.from(new Set((db.prepare('SELECT period FROM payslips').all() as any[]).map((p) => p.period))).sort((a, b) => b.localeCompare(a)))
})

payrollRouter.post('/approve-payroll/:period', requireAuth, requireRole('Director', 'Admin'), (req: AuthedRequest, res) => {
  pushAudit(req.user!.id, req.user!.email, 2, 'Payroll', null, `Duyệt kỳ lương ${req.params.period}`)
  res.json({ ok: true })
})