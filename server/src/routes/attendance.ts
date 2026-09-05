// Attendance routes (§14.2 / §14.3 / §14.4)
import express, { Router } from 'express'
import { db } from '../db.js'
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js'
import { getEmployee, getSchedule, getShift, punchesOfDay, getRecord, mapPunch, mapShift, mapShiftSchedule, mapNotification } from '../repo.js'
import { pushAudit } from '../helpers.js'
import { processPunch, proxyPunch } from '../engines/attendance.js'
import { ymd, nowVn, addDays, endOfMonth, eachDayOfInterval, parseISO, yearsOfService, isoNow } from '../lib/date.js'
import { loadAuthorizationActor, matchesEffectiveEmployeeScope } from '../authz/authorizationActor.js'
import { ATTENDANCE_PERMISSIONS, canProxyPunch, canViewAttendance } from '../authz/attendanceAuthorization.js'
import { authenticateAttendanceDevice, createAttendanceDevice, revokeAttendanceDevice, rotateAttendanceDeviceCredential } from '../services/deviceAuthService.js'
import { httpError } from '../types.js'
import { getClientIp } from '../lib/clientIp.js'
import { createRateLimitMiddleware } from '../middleware/rateLimit.js'
import {
  BULK_EXCEL_MAX_BYTES, createAttendanceExport, createAttendanceTemplate, importAttendancePunches,
} from '../services/bulkExcelService.js'
import { XLSX_MIME } from '../services/tabularDocumentService.js'

export const attendanceRouter = Router()

attendanceRouter.get('/import-template', requireAuth, requirePermission(ATTENDANCE_PERMISSIONS.PROXY_PUNCH), async (_req, res, next) => {
  try {
    const file = await createAttendanceTemplate()
    res.setHeader('Content-Type', XLSX_MIME)
    res.setHeader('Content-Disposition', 'attachment; filename="mau-du-lieu-cham-cong.xlsx"')
    res.send(file)
  } catch (error) { next(error) }
})

attendanceRouter.get('/export-excel', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const from = String(req.query.from ?? ''), to = String(req.query.to ?? '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw httpError(400, 'Khoảng ngày không hợp lệ.')
    const file = await createAttendanceExport(req.authorizationActor!, from, to, req.query.departmentId ? String(req.query.departmentId) : undefined)
    res.setHeader('Content-Type', XLSX_MIME)
    res.setHeader('Content-Disposition', `attachment; filename="cham-cong-${from}_${to}.xlsx"`)
    pushAudit(req.user!.id, req.user!.email, 6, 'AttendanceExport', null, `Xuất chấm công ${from} đến ${to}`)
    res.send(file)
  } catch (error) { next(error) }
})

attendanceRouter.post('/import-excel', requireAuth, requirePermission(ATTENDANCE_PERMISSIONS.PROXY_PUNCH),
  express.raw({ type: XLSX_MIME, limit: BULK_EXCEL_MAX_BYTES }), async (req: AuthedRequest, res, next) => {
    try {
      if (!Buffer.isBuffer(req.body)) throw httpError(415, 'Chỉ chấp nhận file Excel định dạng .xlsx.')
      res.json(await importAttendancePunches(req.body, req.authorizationActor!))
    } catch (error) { next(error) }
  })

const devicePunchRateLimit = createRateLimitMiddleware({
  windowMs: Number(process.env.DEVICE_PUNCH_RATE_LIMIT_WINDOW_MS) || 60_000,
  maxAttempts: Number(process.env.DEVICE_PUNCH_RATE_LIMIT_MAX) || 120,
  key: (request) => `${request.ip}:${request.header('X-Device-Id') ?? 'missing'}`,
})

attendanceRouter.get('/devices', requireAuth, requirePermission(ATTENDANCE_PERMISSIONS.DEVICE_MANAGE), (_req, res) => {
  res.json(db.prepare(`SELECT id, name, is_active isActive, created_at createdAt, updated_at updatedAt,
    revoked_at revokedAt, last_used_at lastUsedAt FROM attendance_devices ORDER BY name`).all())
})

attendanceRouter.post('/devices', requireAuth, requirePermission(ATTENDANCE_PERMISSIONS.DEVICE_MANAGE), (req: AuthedRequest, res, next) => {
  try {
    createAttendanceDevice(req.body ?? {})
    pushAudit(req.user!.id, req.user!.email, 1, 'AttendanceDevice', req.body?.id ?? null, `Tạo thiết bị ${req.body?.id ?? ''}`)
    res.status(201).json({ ok: true })
  } catch (error) { next(error) }
})

attendanceRouter.post('/devices/:id/rotate', requireAuth, requirePermission(ATTENDANCE_PERMISSIONS.DEVICE_MANAGE), (req: AuthedRequest, res, next) => {
  try {
    rotateAttendanceDeviceCredential(req.params.id, req.body?.credential)
    pushAudit(req.user!.id, req.user!.email, 2, 'AttendanceDevice', req.params.id, `Xoay credential thiết bị ${req.params.id}`)
    res.json({ ok: true })
  } catch (error) { next(error) }
})

attendanceRouter.post('/devices/:id/revoke', requireAuth, requirePermission(ATTENDANCE_PERMISSIONS.DEVICE_MANAGE), (req: AuthedRequest, res, next) => {
  try {
    revokeAttendanceDevice(req.params.id)
    pushAudit(req.user!.id, req.user!.email, 2, 'AttendanceDevice', req.params.id, `Thu hồi thiết bị ${req.params.id}`)
    res.json({ ok: true })
  } catch (error) { next(error) }
})

attendanceRouter.post('/punch', requireAuth, requirePermission(ATTENDANCE_PERMISSIONS.PUNCH_SELF), (req: AuthedRequest, res, next) => {
  try {
    const emp = getEmployee(req.user!.employeeId)!
    const p = req.body ?? {}
    // Chấm bằng khuôn mặt (source=1) BẮT BUỘC qua /api/face/verify (quét mặt thật + so khớp descriptor).
    // Chặn chấm "source=Face" trực tiếp tại /punch để chống chấm hộ (không cần mặt thật).
    if (p.source === 1) {
      res.status(400).json({ status: 400, message: 'Chấm công bằng khuôn mặt phải quét mặt thật tại trang Chấm công khuôn mặt. Không được chấm trực tiếp.' })
      return
    }
    p.ipAddress = getClientIp(req)
    const result = processPunch(emp.id, p.source, p)
    pushAudit(req.user!.id, emp.fullName, 1, 'AttendancePunch', null, `Chấm công (${p.source}) — ${result.message}`)
    res.json(result)
  } catch (e) { next(e) }
})

// Webhook máy chấm công vật lý (vân tay/khuôn mặt/thẻ từ) — ưu tiên nguồn vật lý (source=1).
// Xác thực bằng header X-Device-Key (shared secret qua env DEVICE_KEY, mặc định "technova-device").
attendanceRouter.post('/device-punch', devicePunchRateLimit, (req, res, next) => {
  try {
    const device = authenticateAttendanceDevice(req.header('X-Device-Id') ?? undefined, req.header('X-Device-Key') ?? undefined)
    if (!device) { res.status(401).json({ status: 401, message: 'Thiết bị không hợp lệ.' }); return }
    const { employeeCode, punchedAt, latitude, longitude, wifiSsid } = req.body ?? {}
    if (!employeeCode) { res.status(400).json({ status: 400, message: 'Thiếu mã nhân viên.' }); return }
    if (punchedAt) {
      const timestamp = new Date(punchedAt).getTime()
      if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) {
        res.status(400).json({ status: 400, message: 'Thời gian chấm công của thiết bị không hợp lệ hoặc đã quá hạn.' })
        return
      }
    }
    const emp = (db.prepare('SELECT * FROM employees WHERE employee_code=? AND status=2').get(employeeCode) as any)
    if (!emp) { res.status(404).json({ status: 404, message: `Không tìm thấy nhân viên ${employeeCode}.` }); return }
    // punchedAt do máy đẩy (ISO giờ VN); nếu không có thì để engine dùng nowVn()
    const payload: any = {
      latitude, longitude, wifiSsid, ipAddress: getClientIp(req),
      deviceId: device.id, deviceInfo: `Device:${device.id}`,
    }
    if (punchedAt) payload.fixedPunchedAt = punchedAt
    const result = processPunch(emp.id, 1, payload) // source=1 device (vật lý)
    pushAudit(`device:${device.id}`, device.name, 1, 'AttendanceDevicePunch', null,
      `device=${device.id}; employee=${emp.id}; ${result.message}`, getClientIp(req))
    res.json(result)
  } catch (e) { next(e) }
})

attendanceRouter.get('/today', requireAuth, requirePermission(ATTENDANCE_PERMISSIONS.VIEW_SELF), (req: AuthedRequest, res) => {
  const date = ymd(nowVn())
  const sched = getSchedule(req.user!.employeeId, date)
  const shift = sched ? getShift(sched.shiftId) : null
  const record = getRecord(req.user!.employeeId, date)
  const punches = punchesOfDay(req.user!.employeeId, date)
  res.json({ record, punches, todayShift: sched, shift })
})

attendanceRouter.get('/detail/:date', requireAuth, requirePermission(ATTENDANCE_PERMISSIONS.VIEW_SELF), (req: AuthedRequest, res) => {
  const date = req.params.date
  const sched = getSchedule(req.user!.employeeId, date)
  const shift = sched ? getShift(sched.shiftId) : null
  const record = getRecord(req.user!.employeeId, date)
  const punches = punchesOfDay(req.user!.employeeId, date)
  res.json({ record, punches, shift })
})

attendanceRouter.get('/timesheet', requireAuth, requirePermission(ATTENDANCE_PERMISSIONS.VIEW_SELF), (req: AuthedRequest, res) => {
  const year = Number(req.query.year), month = Number(req.query.month)
  const from = new Date(year, month - 1, 1)
  const to = endOfMonth(from)
  const days = eachDayOfInterval({ start: from, end: to }).map((d) => {
    const date = ymd(d)
    const sched = getSchedule(req.user!.employeeId, date)
    const shift = sched ? getShift(sched.shiftId) : null
    const record = getRecord(req.user!.employeeId, date)
    return { date, record, shift }
  })
  const recs = days.map((d) => d.record).filter(Boolean) as any[]
  res.json({
    days,
    summary: {
      totalPaidUnits: recs.reduce((s, r) => s + (r.status === 4 ? 0 : r.workHours), 0),
      totalOtHours: recs.reduce((s, r) => s + r.overtimeHours, 0),
      lateEarlyCount: recs.filter((r) => r.lateMinutes > 0 || r.earlyLeaveMinutes > 0).length,
      totalOffOrAbsent: recs.filter((r) => r.status === 4).length,
      workHours: recs.reduce((s, r) => s + r.actualWorkHours, 0),
    },
  })
})

attendanceRouter.get('/shift-schedule', requireAuth, requirePermission('shifts.schedule.view_self'), (req: AuthedRequest, res) => {
  const year = Number(req.query.year), month = Number(req.query.month)
  const from = new Date(year, month - 1, 1)
  const to = endOfMonth(from)
  res.json(eachDayOfInterval({ start: from, end: to }).map((d) => {
    const date = ymd(d)
    const sched = getSchedule(req.user!.employeeId, date)
    const shift = sched ? getShift(sched.shiftId) : null
    return { date, shift }
  }))
})

attendanceRouter.get('/leave-plan', requireAuth, requirePermission(ATTENDANCE_PERMISSIONS.LEAVE_PLAN_SELF), (req: AuthedRequest, res) => {
  const year = nowVn().getFullYear()
  const balances = (db.prepare('SELECT * FROM leave_balances WHERE employee_id=? AND year=?').all(req.user!.employeeId, year) as any[]).map((r) => ({
    id: r.id, employeeId: r.employee_id, year: r.year, leaveTypeCategory: r.leave_type_category,
    leaveTypeName: r.leave_type_name, allocatedDays: r.allocated_days, usedDays: r.used_days, pendingDays: r.pending_days,
  }))
  const today = nowVn()
  const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const upcoming: any[] = []
  ;(db.prepare(`SELECT * FROM requests WHERE type='leaves' AND employee_id=? AND status=3`).all(req.user!.employeeId) as any[]).forEach((r) => {
    const fromD = parseISO(r.start_date), toD = parseISO(r.end_date)
    eachDayOfInterval({ start: fromD, end: toD }).filter((d) => d >= today0).forEach((d) => {
      upcoming.push({ date: ymd(d), type: 'approved_leave', label: r.leave_type_name })
    })
  })
  upcoming.sort((a, b) => a.date.localeCompare(b.date))
  res.json({ balances, upcoming })
})

attendanceRouter.get('/leavers-today', requireAuth, (req: AuthedRequest, res) => {
  const actor = req.authorizationActor!
  const viewAll = actor.permissions.has(ATTENDANCE_PERMISSIONS.VIEW_ALL)
  if (!viewAll && !actor.permissions.has(ATTENDANCE_PERMISSIONS.LEAVERS_SCOPED)) {
    res.status(403).json({ status: 403, message: 'Bạn không có quyền xem danh sách nghỉ.' })
    return
  }
  const today = ymd(nowVn())
  const leavers = (db.prepare(`SELECT * FROM requests WHERE type='leaves' AND status=3`).all() as any[]).filter((r) => {
    return today >= r.start_date && today <= r.end_date
  })
  res.json(leavers.map((r) => {
    const e = getEmployee(r.employee_id)!
    return { employee: { id: e.id, fullName: e.fullName, employeeCode: e.employeeCode }, leaveType: r.leave_type_name }
  }).filter((x) => {
    const employee = getEmployee(x.employee.id)!
    return viewAll || matchesEffectiveEmployeeScope(actor, { id: employee.id, departmentId: employee.departmentId })
  }))
})

attendanceRouter.get('/punch-options', requireAuth, requirePermission(ATTENDANCE_PERMISSIONS.PUNCH_SELF), (_req, res) => {
  const reg = db.prepare('SELECT * FROM regulation LIMIT 1').get() as any
  const gps = db.prepare('SELECT * FROM gps_catalog WHERE regulation_id=?').all(reg.id) as any[]
  const wifi = db.prepare('SELECT * FROM wifi_catalog WHERE regulation_id=?').all(reg.id) as any[]
  const ip = db.prepare('SELECT * FROM ip_catalog WHERE regulation_id=?').all(reg.id) as any[]
  res.json({
    regulation: {
      id: reg.id, enablePunchFace: !!reg.enable_punch_face, enablePunchGps: !!reg.enable_punch_gps,
      enablePunchWifi: !!reg.enable_punch_wifi, enablePunchIp: !!reg.enable_punch_ip, enablePunchQr: !!reg.enable_punch_qr,
      requireLivenessCheck: !!reg.require_liveness_check, livenessStrictness: reg.liveness_strictness,
      alternativePunchMethod: reg.alternative_punch_method, canEmployeeTrackWorkHours: !!reg.can_employee_track_work_hours,
      allowEmployeeShiftRegistration: !!reg.allow_employee_shift_registration,
      allowEmployeeViewDetailTimesheetDaily: !!reg.allow_employee_view_detail_timesheet_daily,
      gpsCatalog: gps.map((g) => ({ id: g.id, name: g.name, lat: g.lat, lng: g.lng, radiusMeters: g.radius_meters })),
      wifiCatalog: wifi.map((w) => ({ id: w.id, ssid: w.ssid, bssid: w.bssid })),
      ipCatalog: ip.map((i) => ({ id: i.id, ipAddress: i.ip_address, subnetBits: i.subnet_bits })),
    },
  })
})

attendanceRouter.post('/proxy-punch', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const p = req.body ?? {}
    const reason = typeof p.reason === 'string' ? p.reason.trim() : ''
    if (reason.length < 5) throw httpError(400, 'Lý do chấm công hộ phải có nội dung cụ thể.')
    if (!p.targetEmployeeId) throw httpError(400, 'Thiếu nhân viên cần chấm công hộ.')
    if (p.targetEmployeeId === req.user!.employeeId) throw httpError(400, 'Tự chấm công phải sử dụng luồng chấm công thông thường.')
    // QL chấm hộ cũng không được dùng source=Face — khuôn mặt phải do NV tự quét hoặc qua máy vật lý.
    if (p.source === 1) {
      res.status(400).json({ status: 400, message: 'Không thể chấm hộ bằng khuôn mặt. Khuôn mặt phải do nhân viên tự quét.' })
      return
    }
    const result = db.transaction(() => {
      const actor = loadAuthorizationActor(req.user!.id)
      const target = getEmployee(p.targetEmployeeId)
      if (!target || ![1, 2, 3].includes(target.status)) throw httpError(404, 'Không tìm thấy nhân viên.')
      if (!canProxyPunch(actor, { id: target.id, departmentId: target.departmentId })) {
        if (!actor.permissions.has('attendance.proxy_punch')) throw httpError(403, 'Bạn không có quyền chấm công hộ.')
        throw httpError(404, 'Không tìm thấy nhân viên.')
      }
      const ipAddress = getClientIp(req)
      const output = proxyPunch(target.id, 99, {
        ...p, source: undefined, reason: undefined, ipAddress, deviceInfo: 'Proxy',
        proxyActorUserId: actor.userId, proxyReason: reason, notes: `Proxy: ${reason}`,
      })
      const punch = db.prepare(`SELECT is_check_in, punched_at, created_at FROM punches
        WHERE employee_id=? ORDER BY created_at DESC LIMIT 1`).get(target.id) as any
      const direction = punch?.is_check_in ? 'IN' : 'OUT'
      pushAudit(actor.userId, actor.email, 1, 'AttendanceProxyPunch', null,
        `actor=${actor.userId}; target=${target.id}; actual=${punch?.punched_at ?? ''}; recorded=${punch?.created_at ?? isoNow()}; type=${direction}; reason=${reason}; requestedSource=${p.source ?? ''}; ip=${ipAddress}`,
        ipAddress)
      return output
    })()
    res.json(result)
  } catch (e) { next(e) }
})

attendanceRouter.post('/confirm-timesheet', requireAuth, requirePermission(ATTENDANCE_PERMISSIONS.CONFIRM_SELF), (req: AuthedRequest, res, next) => {
  try {
    const detailId = typeof req.body?.summaryTimesheetDetailId === 'string' ? req.body.summaryTimesheetDetailId : ''
    const status = Number(req.body?.status)
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() || null : null
    if (!detailId || (status !== 2 && status !== 3)) throw httpError(400, 'Dữ liệu xác nhận bảng công không hợp lệ.')
    const result = db.transaction(() => {
      const row = db.prepare(`SELECT detail.*, summary.status summary_status
        FROM summary_timesheet_details detail
        JOIN summary_timesheets summary ON summary.id=detail.summary_timesheet_id
        WHERE detail.id=?`).get(detailId) as any
      if (!row || row.employee_id !== req.user!.employeeId) throw httpError(404, 'Không tìm thấy dòng bảng công để xác nhận.')
      if (row.summary_status !== 2 || row.confirmation_status !== 1) throw httpError(409, 'Dòng bảng công đã được xử lý hoặc kỳ công không còn cho phép xác nhận.')
      const update = db.prepare(`UPDATE summary_timesheet_details SET confirmation_status=?, confirmation_comment=?
        WHERE id=? AND confirmation_status=1`).run(status, comment, detailId)
      if (update.changes !== 1) throw httpError(409, 'Dòng bảng công đã được xử lý. Vui lòng tải lại.')
      db.prepare('UPDATE summary_timesheets SET version=version+1 WHERE id=? AND status=2').run(row.summary_timesheet_id)
      pushAudit(req.user!.id, req.user!.email, 2, 'SummaryTimesheetDetail', detailId, `Nhân viên xác nhận bảng công trạng thái ${status}`)
      return { ok: true }
    }).immediate()
    res.json(result)
  } catch (e) { next(e) }
})

attendanceRouter.get('/dashboard', requireAuth, requirePermission(ATTENDANCE_PERMISSIONS.VIEW_SELF), (req: AuthedRequest, res) => {
  const emp = getEmployee(req.user!.employeeId)!
  const today = ymd(nowVn())
  const sched = getSchedule(emp.id, today)
  const shift = sched ? getShift(sched.shiftId) : null
  const record = getRecord(emp.id, today)
  const punches = punchesOfDay(emp.id, today)

  const days30 = eachDayOfInterval({ start: addDays(nowVn(), -29), end: nowVn() })
  const recs30 = days30.map((d) => getRecord(emp.id, ymd(d))).filter(Boolean) as any[]
  const summary30 = {
    present: recs30.filter((r) => r.status !== 4 && r.status !== 6).length,
    absent: recs30.filter((r) => r.status === 4).length,
    late: recs30.filter((r) => r.lateMinutes > 0).length,
    early: recs30.filter((r) => r.earlyLeaveMinutes > 0).length,
    workHours: recs30.reduce((s, r) => s + r.actualWorkHours, 0),
    otHours: recs30.reduce((s, r) => s + r.overtimeHours, 0),
  }
  const year = nowVn().getFullYear()
  const balances = (db.prepare('SELECT * FROM leave_balances WHERE employee_id=? AND year=?').all(emp.id, year) as any[]).map((r) => ({
    id: r.id, employeeId: r.employee_id, year: r.year, leaveTypeCategory: r.leave_type_category,
    leaveTypeName: r.leave_type_name, allocatedDays: r.allocated_days, usedDays: r.used_days, pendingDays: r.pending_days,
  }))
  const annual = balances.find((b) => b.leaveTypeCategory === 1)
  const myRequests = (db.prepare('SELECT * FROM requests WHERE employee_id=?').all(emp.id) as any[]).slice(0, 5)
    .sort((a, b) => b.created_at.localeCompare(a.created_at)).map((r) => mapReq(r))
  const notifications = (db.prepare('SELECT * FROM notifications WHERE recipient_user_id=?').all(req.user!.id) as any[])
    .slice(0, 5).map(mapNotification)
  const pendingApprovalsCount = (db.prepare(`SELECT COUNT(*) c FROM requests WHERE employee_id=? AND (status=2 OR status=8)`).get(emp.id) as any).c

  const h = nowVn().getHours()
  res.json({
    greeting: h < 11 ? 'Chào buổi sáng' : h < 13 ? 'Chào buổi trưa' : h < 18 ? 'Chào buổi chiều' : 'Chào buổi tối',
    employee: { id: emp.id, fullName: emp.fullName, employeeCode: emp.employeeCode, avatarData: emp.avatarData, hireDate: emp.hireDate },
    yearsOfService: yearsOfService(emp.hireDate),
    today: { record, punches, todayShift: sched, shift },
    statCards: {
      leaveBalance: { allocated: annual?.allocatedDays ?? 0, used: annual?.usedDays ?? 0, pending: annual?.pendingDays ?? 0 },
      pendingApprovals: pendingApprovalsCount,
      monthPaidUnits: recs30.reduce((s, r) => s + (r.status === 4 ? 0 : r.workHours), 0),
      workHours30: summary30.workHours, otHours30: summary30.otHours,
    },
    summary30,
    recentAttendance: recs30.slice(-8).reverse(),
    myRequests,
    notifications,
  })
})

function mapReq(r: any): any {
  // bản đơn giản cho dashboard (chỉ trường cơ bản) — routes/requests.ts trả đầy đủ
  return {
    id: r.id, type: r.type, employeeId: r.employee_id, employeeName: r.employee_name,
    employeeCode: r.employee_code, status: r.status, requestVersion: r.request_version,
    createdAt: r.created_at, updatedAt: r.updated_at, currentLevel: r.current_level,
    capabilities: JSON.parse(r.capabilities), approvals: [], attachments: [],
    reason: r.reason,
  }
}
