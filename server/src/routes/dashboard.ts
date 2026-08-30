// Dashboard routes (Admin/HR/Director) (§10 / §14.7)
import { Router } from 'express'
import { db } from '../db.js'
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.js'
import { pendingApprovals } from '../engines/request.js'
import { mapPayslip } from '../repo.js'
import { ymd, eachDayOfInterval, addDays, nowVn, parseISO } from '../lib/date.js'

export const dashboardRouter = Router()

dashboardRouter.get('/admin', requireAuth, requireRole('HR', 'Admin', 'Director'), (req: AuthedRequest, res) => {
  const today = ymd(nowVn())
  const activeEmps = (db.prepare('SELECT * FROM employees WHERE status=2').all() as any[])
  const todayRecs = (db.prepare('SELECT * FROM attendance_records WHERE date=?').all(today) as any[])
  const checkedIn = todayRecs.filter((r) => r.check_in_time != null).length
  const onTime = todayRecs.filter((r) => r.status === 1).length
  const late = todayRecs.filter((r) => r.late_minutes > 0).length
  const absent = activeEmps.length - todayRecs.filter((r) => r.check_in_time != null).length

  const byDepartment = (db.prepare('SELECT * FROM departments').all() as any[]).map((d) => {
    const total = activeEmps.filter((e) => e.department_id === d.id).length
    const present = todayRecs.filter((r) => {
      const emp = (db.prepare('SELECT department_id FROM employees WHERE id=?').get(r.employee_id) as any)
      return r.check_in_time != null && emp?.department_id === d.id
    }).length
    return { name: d.name, present, total }
  })

  const punchHourDistribution: { hour: string; count: number }[] = []
  for (let h = 6; h <= 22; h++) {
    const count = (db.prepare('SELECT * FROM punches WHERE date=?').all(today) as any[]).filter((p) => {
      const hh = parseISO(p.punched_at).getHours()
      return hh === h
    }).length
    punchHourDistribution.push({ hour: `${String(h).padStart(2, '0')}:00`, count })
  }

  const onTimeTrend = eachDayOfInterval({ start: addDays(nowVn(), -6), end: nowVn() }).map((d) => {
    const date = ymd(d)
    const recs = (db.prepare('SELECT * FROM attendance_records WHERE date=?').all(date) as any[])
    return { day: `${d.getDate()}/${d.getMonth() + 1}`, onTime: recs.filter((r) => r.status === 1).length, late: recs.filter((r) => r.late_minutes > 0).length }
  })

  const activityFeed = req.authorizationActor?.permissions.has('audit.view')
    ? (db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 12').all() as any[]).map((a) => ({
      kind: 'punch', title: a.detail, message: a.entity, actorName: a.user_name, timestamp: a.created_at,
    }))
    : []

  res.json({
    kpi: {
      employeesCheckedInToday: checkedIn, totalEmployees: activeEmps.length,
      pendingApprovals: pendingApprovals(req.user!.id).length,
      pendingPayrolls: (db.prepare('SELECT COUNT(*) c FROM summary_timesheets WHERE status=2 OR status=4').get() as any).c,
      onTimeRate: checkedIn ? Math.round((onTime / checkedIn) * 100) : 0,
      lateToday: late, absentToday: Math.max(0, absent),
    },
    byDepartment, punchHourDistribution, onTimeTrend, activityFeed,
  })
})

dashboardRouter.get('/director-approvals', requireAuth, requireRole('Director', 'Admin'), (req: AuthedRequest, res) => {
  res.json(pendingApprovals(req.user!.id))
})

dashboardRouter.get('/director-payrolls', requireAuth, requireRole('Director', 'Admin'), (_req, res) => {
  const periods = Array.from(new Set((db.prepare('SELECT period FROM payslips').all() as any[]).map((p) => p.period))).sort((a, b) => b.localeCompare(a))
  if (!periods.length) return res.json([])
  res.json((db.prepare('SELECT * FROM payslips WHERE period=?').all(periods[0]) as any[]).map(mapPayslip))
})

dashboardRouter.get('/director-reports', requireAuth, requireRole('Director', 'Admin', 'HR'), (req, res) => {
  const from = String(req.query.from), to = String(req.query.to)
  const recs = (db.prepare('SELECT * FROM attendance_records WHERE date>=? AND date<=?').all(from, to) as any[])
  const pays = (db.prepare('SELECT * FROM payslips').all() as any[])
  const rows = (db.prepare('SELECT * FROM employees WHERE status=2').all() as any[]).map((e) => {
    const er = recs.filter((r) => r.employee_id === e.id)
    return {
      name: e.full_name,
      paidUnits: er.reduce((s, r) => s + (r.status === 4 ? 0 : r.work_hours), 0),
      otHours: er.reduce((s, r) => s + r.overtime_hours, 0),
      late: er.filter((r) => r.late_minutes > 0).length,
      net: pays.filter((p) => p.employee_id === e.id).reduce((s, p) => s + p.net, 0),
    }
  })
  res.json({ employees: rows })
})

/* --------- Dashboard mới: quỹ lương, giờ công TB, so sánh tháng --------- */

// Quỹ lương theo phòng ban (kỳ payslip cho trước, mặc định kỳ mới nhất)
dashboardRouter.get('/salary-fund', requireAuth, requireRole('HR', 'Admin', 'Director', 'Accountant'), (req, res) => {
  let period = String(req.query.period ?? '')
  if (!period) {
    const periods = (db.prepare('SELECT DISTINCT period FROM payslips').all() as any[]).map((p) => p.period).sort((a, b) => b.localeCompare(a))
    period = periods[0] ?? ''
  }
  const payslips = period ? (db.prepare('SELECT * FROM payslips WHERE period=?').all(period) as any[]) : []
  const emps = (db.prepare('SELECT * FROM employees WHERE status=2').all() as any[])
  const depts = (db.prepare('SELECT * FROM departments').all() as any[])
  const byDepartment = depts.map((d) => {
    const empIds = new Set(emps.filter((e) => e.department_id === d.id).map((e) => e.id))
    const ps = payslips.filter((p) => empIds.has(p.employee_id))
    return { name: d.name, net: ps.reduce((s, p) => s + p.net, 0), gross: ps.reduce((s, p) => s + p.gross, 0), headcount: empIds.size }
  })
  res.json({
    period, byDepartment,
    totalNet: payslips.reduce((s, p) => s + p.net, 0),
    totalGross: payslips.reduce((s, p) => s + p.gross, 0),
    totalBase: payslips.reduce((s, p) => s + p.base_salary, 0),
    totalOt: payslips.reduce((s, p) => s + p.overtime, 0),
  })
})

// Giờ công trung bình mỗi nhân viên (theo khoảng ngày)
dashboardRouter.get('/work-hours-avg', requireAuth, requireRole('HR', 'Admin', 'Director', 'Accountant', 'Manager'), (req, res) => {
  const today = ymd(nowVn())
  const from = String(req.query.from ?? ymd(addDays(nowVn(), -29)))
  const to = String(req.query.to ?? today)
  const activeEmps = (db.prepare('SELECT * FROM employees WHERE status=2').all() as any[])
  const recs = (db.prepare('SELECT * FROM attendance_records WHERE date>=? AND date<=?').all(from, to) as any[])
  const depts = (db.prepare('SELECT * FROM departments').all() as any[])
  const byDepartment = depts.map((d) => {
    const empIds = activeEmps.filter((e) => e.department_id === d.id).map((e) => e.id)
    if (empIds.length === 0) return { name: d.name, avgHours: 0, headcount: 0 }
    const total = recs.filter((r) => empIds.includes(r.employee_id)).reduce((s, r) => s + r.actual_work_hours, 0)
    return { name: d.name, avgHours: Math.round((total / empIds.length) * 10) / 10, headcount: empIds.length }
  })
  const overallTotal = recs.reduce((s, r) => s + r.actual_work_hours, 0)
  res.json({
    from, to,
    overall: activeEmps.length ? Math.round((overallTotal / activeEmps.length) * 10) / 10 : 0,
    byDepartment,
  })
})

// So sánh quỹ lương các kỳ (nửa tháng) — giải thích tháng nhiều/tháng ít do OT
dashboardRouter.get('/salary-monthly', requireAuth, requireRole('HR', 'Admin', 'Director', 'Accountant'), (_req, res) => {
  const periods = Array.from(new Set((db.prepare('SELECT period FROM payslips').all() as any[]).map((p) => p.period))).sort((a, b) => a.localeCompare(b))
  const data = periods.map((period) => {
    const ps = (db.prepare('SELECT * FROM payslips WHERE period=?').all(period) as any[])
    return {
      period,
      totalNet: ps.reduce((s, p) => s + p.net, 0),
      totalBase: ps.reduce((s, p) => s + p.base_salary, 0),
      totalOt: ps.reduce((s, p) => s + p.overtime, 0),
      label: `${period.slice(0, 4)}/${period.slice(4, 6)}/${period.slice(6, 7) === '1' ? 'H1' : 'H2'}`,
    }
  })
  res.json({ periods: data })
})
