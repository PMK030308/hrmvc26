// Shifts routes (§7)
import { Router } from 'express'
import { db } from '../db.js'
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js'
import { allShifts, getEmployee, getShift, mapShift, mapShiftSchedule, uid } from '../repo.js'
import { httpError } from '../types.js'
import { pushAudit } from '../helpers.js'
import { recomputeAll } from '../engines/attendance.js'
import { ymd, eachDayOfInterval } from '../lib/date.js'
import { canManageShiftSchedule, canViewShiftSchedule, SHIFT_PERMISSIONS } from '../authz/shiftAuthorization.js'

export const shiftsRouter = Router()

shiftsRouter.get('/', requireAuth, requirePermission(SHIFT_PERMISSIONS.CATALOG_VIEW), (_req, res) => {
  res.json(allShifts())
})

shiftsRouter.post('/', requireAuth, requirePermission(SHIFT_PERMISSIONS.CATALOG_MANAGE), (req: AuthedRequest, res) => {
  const p = req.body ?? {}
  const id = uid('shift')
  db.prepare(`INSERT INTO shifts (id, code, name, start_time, end_time, break_start_time, break_end_time,
    check_in_window_from, check_in_window_to, check_out_window_from, check_out_window_to,
    late_punishment_enabled, late_punishment_times, late_punishment_minutes_each, work_days,
    is_overnight, status, holiday_coefficient, color)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, p.code ?? 'NEW', p.name ?? 'Ca mới', p.startTime ?? '08:00:00', p.endTime ?? '17:00:00',
    p.breakStartTime ?? null, p.breakEndTime ?? null, p.checkInWindowFrom ?? null, p.checkInWindowTo ?? null,
    p.checkOutWindowFrom ?? null, p.checkOutWindowTo ?? null, p.latePunishmentEnabled ? 1 : 0,
    p.latePunishmentTimes ?? 0, p.latePunishmentMinutesEach ?? 0, p.workDays ?? 1, p.isOvernight ? 1 : 0,
    p.status ?? 1, p.holidayCoefficient ?? 1, p.color ?? '#3366ff')
  const s = getShift(id)!
  pushAudit(req.user!.id, req.user!.email, 1, 'Shift', s.id, `Tạo ca ${s.name}`)
  res.json(s)
})

shiftsRouter.put('/:id', requireAuth, requirePermission(SHIFT_PERMISSIONS.CATALOG_MANAGE), (req: AuthedRequest, res, next) => {
  try {
    const updated = db.transaction(() => {
    const s = getShift(req.params.id)
    if (!s) throw httpError(404, 'Không tìm thấy ca.')
    const p = req.body ?? {}
    const map: Record<string, string> = {
      code: 'code', name: 'name', startTime: 'start_time', endTime: 'end_time',
      breakStartTime: 'break_start_time', breakEndTime: 'break_end_time',
      checkInWindowFrom: 'check_in_window_from', checkInWindowTo: 'check_in_window_to',
      checkOutWindowFrom: 'check_out_window_from', checkOutWindowTo: 'check_out_window_to',
      latePunishmentTimes: 'late_punishment_times', latePunishmentMinutesEach: 'late_punishment_minutes_each',
      workDays: 'work_days', status: 'status', holidayCoefficient: 'holiday_coefficient', color: 'color',
    }
    const sets: string[] = [], vals: any[] = []
    for (const k of Object.keys(map)) if (k in p) { sets.push(`${map[k]}=?`); vals.push(p[k]) }
    if ('latePunishmentEnabled' in p) { sets.push('late_punishment_enabled=?'); vals.push(p.latePunishmentEnabled ? 1 : 0) }
    if ('isOvernight' in p) { sets.push('is_overnight=?'); vals.push(p.isOvernight ? 1 : 0) }
    if (sets.length) { vals.push(req.params.id); db.prepare(`UPDATE shifts SET ${sets.join(',')} WHERE id=?`).run(...vals) }
    // Tính lại bản ghi của NV theo ca này
    ;(db.prepare('SELECT DISTINCT employee_id FROM shift_schedules WHERE shift_id=?').all(req.params.id) as any[])
      .forEach((r) => recomputeAll(r.employee_id))
    pushAudit(req.user!.id, req.user!.email, 2, 'Shift', req.params.id, `Cập nhật ca ${getShift(req.params.id)!.name}`)
    return getShift(req.params.id)
    })()
    res.json(updated)
  } catch (e) { next(e) }
})

shiftsRouter.delete('/:id', requireAuth, requirePermission(SHIFT_PERMISSIONS.CATALOG_MANAGE), (req: AuthedRequest, res, next) => {
  try {
    db.transaction(() => {
      if (!getShift(req.params.id)) throw httpError(404, 'Không tìm thấy ca.')
      const employeeIds = (db.prepare('SELECT DISTINCT employee_id FROM shift_schedules WHERE shift_id=?').all(req.params.id) as any[])
      db.prepare('DELETE FROM shift_schedules WHERE shift_id=?').run(req.params.id)
      db.prepare('DELETE FROM shifts WHERE id=?').run(req.params.id)
      employeeIds.forEach((row) => recomputeAll(row.employee_id))
      pushAudit(req.user!.id, req.user!.email, 3, 'Shift', req.params.id, `Xóa ca ${req.params.id}`)
    })()
    res.json({ ok: true })
  } catch (error) { next(error) }
})

shiftsRouter.get('/schedule', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const actor = req.authorizationActor!
    const year = Number(req.query.year), month = Number(req.query.month)
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw httpError(400, 'Tháng hoặc năm không hợp lệ.')
    const from = new Date(year, month - 1, 1)
    const to = new Date(year, month, 0)
    const days = eachDayOfInterval({ start: from, end: to }).map((d) => ymd(d))
    let emps = (db.prepare('SELECT * FROM employees WHERE status IN (1,2,3)').all() as any[])
      .filter((employee) => canViewShiftSchedule(actor, { id: employee.id, departmentId: employee.department_id }))
    if (req.query.departmentId) emps = emps.filter((e) => e.department_id === req.query.departmentId)
    if (emps.length === 0 && !actor.permissions.has(SHIFT_PERMISSIONS.SCHEDULE_VIEW_ALL)) {
      throw httpError(403, 'Bạn không có effective scope để xem lịch làm việc.')
    }
    const schedules: Record<string, Record<string, any>> = {}
    for (const e of emps) {
      schedules[e.id] = {}
      for (const d of days) {
        const r = db.prepare('SELECT * FROM shift_schedules WHERE employee_id=? AND date=? AND is_active=1').get(e.id, d) as any
        schedules[e.id][d] = r ? mapShiftSchedule(r) : null
      }
    }
    res.json({ employees: emps.map((e) => ({ id: e.id, employeeCode: e.employee_code, firstName: e.first_name, lastName: e.last_name, fullName: e.full_name, departmentId: e.department_id, positionId: e.position_id, status: e.status })), days, schedules })
  } catch (error) { next(error) }
})

shiftsRouter.post('/assign', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const { employeeId, date, shiftId } = req.body ?? {}
    db.transaction(() => {
      const target = getEmployee(employeeId)
      if (!target || ![1, 2, 3].includes(target.status)) throw httpError(404, 'Không tìm thấy nhân viên.')
      if (!canManageShiftSchedule(req.authorizationActor!, { id: target.id, departmentId: target.departmentId })) throw httpError(404, 'Không tìm thấy nhân viên.')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw httpError(400, 'Ngày phân ca không hợp lệ.')
      if (shiftId && !getShift(shiftId)) throw httpError(404, 'Không tìm thấy ca.')
      db.prepare('DELETE FROM shift_schedules WHERE employee_id=? AND date=?').run(employeeId, date)
      if (shiftId) db.prepare('INSERT INTO shift_schedules (id, employee_id, shift_id, date, rule_id, is_active) VALUES (?,?,?,?,NULL,1)').run(uid('sch'), employeeId, shiftId, date)
      recomputeAll(employeeId)
      pushAudit(req.user!.id, req.user!.email, 2, 'ShiftSchedule', null, `Phân ca ${employeeId} ${date}`)
    })()
    res.json({ ok: true })
  } catch (error) { next(error) }
})

shiftsRouter.post('/bulk-assign', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const { employeeIds, shiftId, dates } = req.body ?? {}
    if (!Array.isArray(employeeIds) || employeeIds.length === 0 || !Array.isArray(dates) || dates.length === 0) throw httpError(400, 'Danh sách nhân viên và ngày không hợp lệ.')
    db.transaction(() => {
      if (!getShift(shiftId)) throw httpError(404, 'Không tìm thấy ca.')
      if (dates.some((date: unknown) => !/^\d{4}-\d{2}-\d{2}$/.test(String(date)))) throw httpError(400, 'Ngày phân ca không hợp lệ.')
      const targets = employeeIds.map((employeeId: string) => getEmployee(employeeId))
      if (targets.some((target) => !target || ![1, 2, 3].includes(target.status)
        || !canManageShiftSchedule(req.authorizationActor!, { id: target.id, departmentId: target.departmentId }))) {
        throw httpError(404, 'Một hoặc nhiều nhân viên không tồn tại trong effective scope.')
      }
      for (const target of targets) {
        for (const date of dates) {
          db.prepare('DELETE FROM shift_schedules WHERE employee_id=? AND date=?').run(target!.id, date)
          db.prepare('INSERT INTO shift_schedules (id, employee_id, shift_id, date, rule_id, is_active) VALUES (?,?,?,?,NULL,1)').run(uid('sch'), target!.id, shiftId, date)
        }
        recomputeAll(target!.id)
      }
      pushAudit(req.user!.id, req.user!.email, 2, 'ShiftSchedule', null, `Phân ca hàng loạt (${employeeIds.length} NV)`)
    })()
    res.json({ ok: true })
  } catch (error) { next(error) }
})
