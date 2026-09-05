import { Router } from 'express'
import { db } from '../db.js'
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.js'
import { pendingApprovals } from '../engines/request.js'
import { ymd, eachDayOfInterval, addDays, nowVn, parseISO } from '../lib/date.js'
import { httpError } from '../types.js'
import {
  canViewAttendanceReportEmployee, canViewAttendanceReports, reportProjectionFor, REPORT_PERMISSIONS,
} from '../authz/reportAuthorization.js'
import { parseIsoDate, parsePeriod } from '../services/timesheetService.js'
import { createTabularExcel, createTabularPdf, PDF_MIME, XLSX_MIME } from '../services/tabularDocumentService.js'
import { pushAudit } from '../helpers.js'

export const dashboardRouter = Router()

function employeesForReport(req: AuthedRequest): any[] {
  const actor = req.authorizationActor!
  return (db.prepare('SELECT * FROM employees WHERE status=2').all() as any[])
    .filter((employee) => canViewAttendanceReportEmployee(actor, { id: employee.id, departmentId: employee.department_id }))
}

function requireAttendanceReport(req: AuthedRequest): void {
  if (!canViewAttendanceReports(req.authorizationActor!)) throw httpError(403, 'Bạn không có quyền xem báo cáo chấm công.')
}

function validateRange(req: AuthedRequest, defaults?: { from: string; to: string }): { from: string; to: string } {
  const from = parseIsoDate(req.query.from ?? defaults?.from, 'Từ ngày')
  const to = parseIsoDate(req.query.to ?? defaults?.to, 'Đến ngày')
  if (from > to) throw httpError(400, 'Khoảng ngày không hợp lệ.')
  return { from, to }
}

function buildReportDocument(req: AuthedRequest) {
  requireAttendanceReport(req)
  const { from, to } = validateRange(req)
  const employees = employeesForReport(req)
  const employeeIds = new Set(employees.map((employee) => employee.id))
  const records = (db.prepare('SELECT * FROM attendance_records WHERE date>=? AND date<=?').all(from, to) as any[])
    .filter((record) => employeeIds.has(record.employee_id))
  const payslips = db.prepare(`SELECT payslip.* FROM payslips payslip
    JOIN summary_timesheets summary ON summary.period=payslip.period
    WHERE summary.from_date<=? AND summary.to_date>=?`).all(to, from) as any[]
  const projection = reportProjectionFor(req.authorizationActor!)
  const rows = employees.map((employee) => {
    const employeeRecords = records.filter((record) => record.employee_id === employee.id)
    return {
      employeeCode: employee.employee_code, employeeName: employee.full_name,
      paidUnits: employeeRecords.reduce((sum, record) => sum + (record.status === 4 ? 0 : record.work_hours), 0),
      overtimeHours: employeeRecords.reduce((sum, record) => sum + record.overtime_hours, 0),
      lateCount: employeeRecords.filter((record) => record.late_minutes > 0).length,
      net: projection === 'detail' ? payslips.filter((payslip) => payslip.employee_id === employee.id).reduce((sum, payslip) => sum + payslip.net, 0) : undefined,
    }
  })
  const totalNet = projection === 'attendance' ? null : payslips.reduce((sum, payslip) => sum + payslip.net, 0)
  return {
    title: 'Báo cáo chấm công và lương',
    subtitle: `${from} đến ${to} · ${rows.length} nhân viên${totalNet === null ? '' : ` · Tổng thực lĩnh ${new Intl.NumberFormat('vi-VN').format(totalNet)} VNĐ`}`,
    sheetName: 'Báo cáo', rows,
    columns: [
      { header: 'Mã NV', key: 'employeeCode', width: 14 }, { header: 'Họ tên', key: 'employeeName', width: 28 },
      { header: 'Công hưởng', key: 'paidUnits', width: 16, numeric: true }, { header: 'Giờ OT', key: 'overtimeHours', width: 14, numeric: true },
      { header: 'Số ngày muộn', key: 'lateCount', width: 16, numeric: true },
      ...(projection === 'detail' ? [{ header: 'Thực lĩnh', key: 'net', width: 18, numeric: true }] : []),
    ],
  }
}

dashboardRouter.get('/director-reports/export-excel', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const document = buildReportDocument(req)
    const file = await createTabularExcel(document)
    const { from, to } = validateRange(req)
    res.setHeader('Content-Type', XLSX_MIME)
    res.setHeader('Content-Disposition', `attachment; filename="bao-cao-${from}_${to}.xlsx"`)
    pushAudit(req.user!.id, req.user!.email, 6, 'ReportExport', null, `Xuất Excel báo cáo ${from} đến ${to}`)
    res.send(file)
  } catch (error) { next(error) }
})

dashboardRouter.get('/director-reports/export-pdf', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const document = buildReportDocument(req)
    const file = await createTabularPdf(document)
    const { from, to } = validateRange(req)
    res.setHeader('Content-Type', PDF_MIME)
    res.setHeader('Content-Disposition', `attachment; filename="bao-cao-${from}_${to}.pdf"`)
    pushAudit(req.user!.id, req.user!.email, 6, 'ReportExport', null, `Xuất PDF báo cáo ${from} đến ${to}`)
    res.send(file)
  } catch (error) { next(error) }
})

dashboardRouter.get('/admin', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    requireAttendanceReport(req)
    const today = ymd(nowVn())
    const activeEmployees = employeesForReport(req)
    const employeeIds = new Set(activeEmployees.map((employee) => employee.id))
    const todayRecords = (db.prepare('SELECT * FROM attendance_records WHERE date=?').all(today) as any[])
      .filter((record) => employeeIds.has(record.employee_id))
    const checkedIn = todayRecords.filter((record) => record.check_in_time != null).length
    const onTime = todayRecords.filter((record) => record.status === 1).length
    const departments = db.prepare('SELECT * FROM departments').all() as any[]
    const byDepartment = departments.map((department) => {
      const departmentEmployees = activeEmployees.filter((employee) => employee.department_id === department.id)
      const ids = new Set(departmentEmployees.map((employee) => employee.id))
      return { name: department.name, present: todayRecords.filter((record) => ids.has(record.employee_id) && record.check_in_time != null).length, total: ids.size }
    }).filter((department) => department.total > 0)
    const punches = (db.prepare('SELECT * FROM punches WHERE date=?').all(today) as any[])
      .filter((punch) => employeeIds.has(punch.employee_id))
    const punchHourDistribution = Array.from({ length: 17 }, (_, index) => index + 6).map((hour) => ({
      hour: `${String(hour).padStart(2, '0')}:00`,
      count: punches.filter((punch) => parseISO(punch.punched_at).getHours() === hour).length,
    }))
    const onTimeTrend = eachDayOfInterval({ start: addDays(nowVn(), -6), end: nowVn() }).map((dateValue) => {
      const date = ymd(dateValue)
      const records = (db.prepare('SELECT * FROM attendance_records WHERE date=?').all(date) as any[])
        .filter((record) => employeeIds.has(record.employee_id))
      return { day: `${dateValue.getDate()}/${dateValue.getMonth() + 1}`, onTime: records.filter((record) => record.status === 1).length, late: records.filter((record) => record.late_minutes > 0).length }
    })
    const activityFeed = req.authorizationActor!.permissions.has('audit.view')
      ? (db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 12').all() as any[]).map((audit) => ({
        kind: 'punch', title: audit.detail, message: audit.entity, actorName: audit.user_name, timestamp: audit.created_at,
      })) : []
    res.json({
      kpi: {
        employeesCheckedInToday: checkedIn, totalEmployees: activeEmployees.length,
        pendingApprovals: pendingApprovals(req.user!.id).length,
        pendingPayrolls: req.authorizationActor!.permissions.has(REPORT_PERMISSIONS.PAYROLL_VIEW_AGGREGATE)
          ? (db.prepare('SELECT COUNT(*) count FROM summary_timesheets WHERE status IN (2,3,4)').get() as any).count : 0,
        onTimeRate: checkedIn ? Math.round((onTime / checkedIn) * 100) : 0,
        lateToday: todayRecords.filter((record) => record.late_minutes > 0).length,
        absentToday: Math.max(0, activeEmployees.length - checkedIn),
      },
      byDepartment, punchHourDistribution, onTimeTrend, activityFeed,
    })
  } catch (error) { next(error) }
})

dashboardRouter.get('/director-approvals', requireAuth, requireRole('Director', 'Admin'), (req: AuthedRequest, res) => {
  res.json(pendingApprovals(req.user!.id))
})

dashboardRouter.get('/director-payrolls', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    if (!req.authorizationActor!.permissions.has(REPORT_PERMISSIONS.PAYROLL_VIEW_AGGREGATE)) throw httpError(403, 'Bạn không có quyền xem báo cáo lương.')
    const summary = db.prepare('SELECT * FROM summary_timesheets WHERE status>=4 ORDER BY period DESC LIMIT 1').get() as any
    if (!summary) return res.json(null)
    const payslips = db.prepare('SELECT * FROM payslips WHERE period=?').all(summary.period) as any[]
    res.json({
      period: summary.period, status: summary.status, version: Number(summary.version ?? 1), headcount: payslips.length,
      totalGross: payslips.reduce((sum, payslip) => sum + payslip.gross, 0),
      totalNet: payslips.reduce((sum, payslip) => sum + payslip.net, 0),
      canApprove: summary.status === 4 && req.authorizationActor!.permissions.has('payroll.sheet.approve'),
    })
  } catch (error) { next(error) }
})

dashboardRouter.get('/director-reports', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    requireAttendanceReport(req)
    const { from, to } = validateRange(req)
    const employees = employeesForReport(req)
    const ids = new Set(employees.map((employee) => employee.id))
    const records = (db.prepare('SELECT * FROM attendance_records WHERE date>=? AND date<=?').all(from, to) as any[])
      .filter((record) => ids.has(record.employee_id))
    const payslips = db.prepare(`SELECT payslip.* FROM payslips payslip
      JOIN summary_timesheets summary ON summary.period=payslip.period
      WHERE summary.from_date<=? AND summary.to_date>=?`).all(to, from) as any[]
    const projection = reportProjectionFor(req.authorizationActor!)
    const rows = employees.map((employee) => {
      const employeeRecords = records.filter((record) => record.employee_id === employee.id)
      const row: Record<string, any> = {
        name: employee.full_name,
        paidUnits: employeeRecords.reduce((sum, record) => sum + (record.status === 4 ? 0 : record.work_hours), 0),
        otHours: employeeRecords.reduce((sum, record) => sum + record.overtime_hours, 0),
        late: employeeRecords.filter((record) => record.late_minutes > 0).length,
      }
      if (projection === 'detail') row.net = payslips.filter((payslip) => payslip.employee_id === employee.id).reduce((sum, payslip) => sum + payslip.net, 0)
      return row
    })
    const payroll = projection === 'attendance' ? null : {
      totalNet: payslips.reduce((sum, payslip) => sum + payslip.net, 0),
      totalGross: payslips.reduce((sum, payslip) => sum + payslip.gross, 0),
    }
    res.json({ employees: rows, payroll, projection })
  } catch (error) { next(error) }
})

dashboardRouter.get('/salary-fund', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    if (!req.authorizationActor!.permissions.has(REPORT_PERMISSIONS.PAYROLL_VIEW_AGGREGATE)) throw httpError(403, 'Bạn không có quyền xem báo cáo lương.')
    let period = req.query.period ? parsePeriod(req.query.period) : ''
    if (!period) period = (db.prepare('SELECT period FROM payslips ORDER BY period DESC LIMIT 1').get() as any)?.period ?? ''
    const payslips = period ? db.prepare('SELECT * FROM payslips WHERE period=?').all(period) as any[] : []
    const employees = db.prepare('SELECT * FROM employees WHERE status=2').all() as any[]
    const departments = db.prepare('SELECT * FROM departments').all() as any[]
    const byDepartment = departments.map((department) => {
      const employeeIds = new Set(employees.filter((employee) => employee.department_id === department.id).map((employee) => employee.id))
      const rows = payslips.filter((payslip) => employeeIds.has(payslip.employee_id))
      return { name: department.name, net: rows.reduce((sum, row) => sum + row.net, 0), gross: rows.reduce((sum, row) => sum + row.gross, 0), headcount: employeeIds.size }
    })
    res.json({
      period, byDepartment,
      totalNet: payslips.reduce((sum, row) => sum + row.net, 0), totalGross: payslips.reduce((sum, row) => sum + row.gross, 0),
      totalBase: payslips.reduce((sum, row) => sum + row.base_salary, 0), totalOt: payslips.reduce((sum, row) => sum + row.overtime, 0),
    })
  } catch (error) { next(error) }
})

dashboardRouter.get('/work-hours-avg', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    requireAttendanceReport(req)
    const today = ymd(nowVn())
    const { from, to } = validateRange(req, { from: ymd(addDays(nowVn(), -29)), to: today })
    const employees = employeesForReport(req)
    const ids = new Set(employees.map((employee) => employee.id))
    const records = (db.prepare('SELECT * FROM attendance_records WHERE date>=? AND date<=?').all(from, to) as any[])
      .filter((record) => ids.has(record.employee_id))
    const departments = db.prepare('SELECT * FROM departments').all() as any[]
    const byDepartment = departments.map((department) => {
      const employeeIds = employees.filter((employee) => employee.department_id === department.id).map((employee) => employee.id)
      const total = records.filter((record) => employeeIds.includes(record.employee_id)).reduce((sum, record) => sum + record.actual_work_hours, 0)
      return { name: department.name, avgHours: employeeIds.length ? Math.round((total / employeeIds.length) * 10) / 10 : 0, headcount: employeeIds.length }
    }).filter((department) => department.headcount > 0)
    const overallTotal = records.reduce((sum, record) => sum + record.actual_work_hours, 0)
    res.json({ from, to, overall: employees.length ? Math.round((overallTotal / employees.length) * 10) / 10 : 0, byDepartment })
  } catch (error) { next(error) }
})

dashboardRouter.get('/salary-monthly', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    if (!req.authorizationActor!.permissions.has(REPORT_PERMISSIONS.PAYROLL_VIEW_AGGREGATE)) throw httpError(403, 'Bạn không có quyền xem báo cáo lương.')
    const periods = (db.prepare('SELECT DISTINCT period FROM payslips ORDER BY period ASC').all() as any[]).map((row) => row.period)
    res.json({ periods: periods.map((period) => {
      const rows = db.prepare('SELECT * FROM payslips WHERE period=?').all(period) as any[]
      return {
        period, totalNet: rows.reduce((sum, row) => sum + row.net, 0), totalBase: rows.reduce((sum, row) => sum + row.base_salary, 0),
        totalOt: rows.reduce((sum, row) => sum + row.overtime, 0),
        label: `${period.slice(0, 4)}/${period.slice(4, 6)}/${period.slice(6) === '1' ? 'H1' : 'H2'}`,
      }
    }) })
  } catch (error) { next(error) }
})
