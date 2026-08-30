// Config routes: quy định chấm công, loại nghỉ, role/permission, profile (§9/§11)
import { Router } from 'express'
import { db } from '../db.js'
import { requireAuth, requirePermission, requireRole, type AuthedRequest } from '../middleware/auth.js'
import { getRegulation, mapRegulation, getEmployee, getUserById, mapUser, uid } from '../repo.js'
import { httpError } from '../types.js'
import { pushAudit } from '../helpers.js'
import {
  getPermissionMatrixSnapshot, replacePermissionMatrix, updateAuthorizationUser, validateGenericPermissionMatrix,
  ALL_ROLES, type PermissionMatrixEntry,
} from '../services/permissionService.js'

export const configRouter = Router()

/* ------------------------------ Quy định ---------------------------------- */
configRouter.get('/regulations/attendance', requireAuth, requireRole('HR', 'Admin', 'Manager'), (_req, res) => {
  res.json(getRegulation())
})

configRouter.put('/regulations/attendance', requireAuth, requireRole('HR', 'Admin'), (req: AuthedRequest, res, next) => {
  try {
    const reg = db.prepare('SELECT * FROM regulation LIMIT 1').get() as any
    if (!reg) throw httpError(404, 'Chưa có quy định.')
    const p = req.body ?? {}
    const map: Record<string, string> = {
      enablePunchFace: 'enable_punch_face', enablePunchGps: 'enable_punch_gps', enablePunchWifi: 'enable_punch_wifi',
      enablePunchIp: 'enable_punch_ip', enablePunchQr: 'enable_punch_qr', requireLivenessCheck: 'require_liveness_check',
      livenessStrictness: 'liveness_strictness', alternativePunchMethod: 'alternative_punch_method',
      canEmployeeTrackWorkHours: 'can_employee_track_work_hours',
      allowEmployeeShiftRegistration: 'allow_employee_shift_registration',
      allowEmployeeViewDetailTimesheetDaily: 'allow_employee_view_detail_timesheet_daily',
      duplicateWindowSeconds: 'duplicate_window_seconds',
      otMonthlyCapHours: 'ot_monthly_cap_hours',
      otYearlyCapHours: 'ot_yearly_cap_hours',
      weekdayOtCoeff: 'weekday_ot_coeff',
      weekendOtCoeff: 'weekend_ot_coeff',
      holidayOtCoeff: 'holiday_ot_coeff',
      nightCoeff: 'night_coeff',
      nightOtExtra: 'night_ot_extra',
      standardMonthlyHours: 'standard_monthly_hours',
    }
    const sets: string[] = [], vals: any[] = []
    for (const k of Object.keys(map)) {
      if (k in p) {
        const col = map[k]
        if (col.startsWith('enable_') || col.startsWith('require_') || col.startsWith('can_') || col.startsWith('allow_')) {
          sets.push(`${col}=?`); vals.push(p[k] ? 1 : 0)
        } else { sets.push(`${col}=?`); vals.push(p[k]) }
      }
    }
    if (sets.length) { vals.push(reg.id); db.prepare(`UPDATE regulation SET ${sets.join(',')} WHERE id=?`).run(...vals) }
    // Catalogs
    if (Array.isArray(p.gpsCatalog)) {
      db.prepare('DELETE FROM gps_catalog WHERE regulation_id=?').run(reg.id)
      p.gpsCatalog.forEach((g: any) => db.prepare('INSERT INTO gps_catalog (id, regulation_id, name, lat, lng, radius_meters) VALUES (?,?,?,?,?,?)').run(g.id ?? uid('gps'), reg.id, g.name, g.lat, g.lng, g.radiusMeters))
    }
    if (Array.isArray(p.wifiCatalog)) {
      db.prepare('DELETE FROM wifi_catalog WHERE regulation_id=?').run(reg.id)
      p.wifiCatalog.forEach((w: any) => db.prepare('INSERT INTO wifi_catalog (id, regulation_id, ssid, bssid) VALUES (?,?,?,?)').run(w.id ?? uid('wifi'), reg.id, w.ssid, w.bssid ?? null))
    }
    if (Array.isArray(p.ipCatalog)) {
      db.prepare('DELETE FROM ip_catalog WHERE regulation_id=?').run(reg.id)
      p.ipCatalog.forEach((i: any) => db.prepare('INSERT INTO ip_catalog (id, regulation_id, ip_address, subnet_bits) VALUES (?,?,?,?)').run(i.id ?? uid('ip'), reg.id, i.ipAddress, i.subnetBits))
    }
    pushAudit(req.user!.id, req.user!.email, 2, 'Regulation', null, 'Cập nhật quy định chấm công')
    res.json(getRegulation())
  } catch (e) { next(e) }
})

/* ------------------------------- Loại nghỉ -------------------------------- */
configRouter.get('/leave-types', requireAuth, requireRole('HR', 'Admin'), (_req, res) => {
  res.json((db.prepare('SELECT * FROM leave_types').all() as any[]).map((r) => ({
    id: r.id, name: r.name, category: r.category, fundType: r.fund_type, maxDays: r.max_days,
    requireAttachment: !!r.require_attachment, requireReason: !!r.require_reason, dayCalculationType: r.day_calculation_type,
  })))
})

configRouter.put('/leave-types/:id', requireAuth, requireRole('HR', 'Admin'), (req: AuthedRequest, res, next) => {
  try {
    const row = db.prepare('SELECT * FROM leave_types WHERE id=?').get(req.params.id) as any
    if (!row) throw httpError(404, 'Không tìm thấy loại nghỉ.')
    const p = req.body ?? {}
    const map: Record<string, string> = {
      name: 'name', category: 'category', fundType: 'fund_type', maxDays: 'max_days',
      requireReason: 'require_reason', dayCalculationType: 'day_calculation_type',
    }
    const sets: string[] = [], vals: any[] = []
    for (const k of Object.keys(map)) if (k in p) { sets.push(`${map[k]}=?`); vals.push(p[k]) }
    if ('requireAttachment' in p) { sets.push('require_attachment=?'); vals.push(p.requireAttachment ? 1 : 0) }
    if (sets.length) { vals.push(req.params.id); db.prepare(`UPDATE leave_types SET ${sets.join(',')} WHERE id=?`).run(...vals) }
    pushAudit(req.user!.id, req.user!.email, 2, 'LeaveType', req.params.id, `Cập nhật loại nghỉ ${p.name ?? row.name}`)
    res.json({ ...row, ...p })
  } catch (e) { next(e) }
})

/* ----------------------------- Role / permission -------------------------- */
configRouter.get('/roles/matrix', requireAuth, requirePermission('config.permission.manage'), (_req, res, next) => {
  try { res.json(getPermissionMatrixSnapshot()) }
  catch (e) { next(e) }
})

configRouter.put('/roles/matrix', requireAuth, requirePermission('config.permission.manage'), (req: AuthedRequest, res, next) => {
  try {
    const body = req.body ?? {}
    try { validateGenericPermissionMatrix(body.permissions as PermissionMatrixEntry[]) }
    catch { throw httpError(400, 'Ma trận quyền không hợp lệ hoặc không đầy đủ.') }
    res.json(replacePermissionMatrix({
      expectedVersion: Number(body.expectedVersion),
      permissions: body.permissions,
    }, req.user!.id))
  } catch (e) { next(e) }
})

configRouter.get('/roles/users', requireAuth, requirePermission('config.user.manage'), (_req, res) => {
  res.json((db.prepare('SELECT * FROM users').all() as any[]).map(mapUser))
})

configRouter.put('/roles/users/:userId', requireAuth, requirePermission('config.user.manage'), (req: AuthedRequest, res, next) => {
  try {
    const { roles, isActive, departmentScopes, expectedVersion } = req.body ?? {}
    res.json(updateAuthorizationUser({
      actorId: req.user!.id,
      targetUserId: req.params.userId,
      roles,
      isActive,
      departmentScopes,
      expectedVersion: Number(expectedVersion),
    }))
  } catch (e) { next(e) }
})

configRouter.post('/roles/users', requireAuth, requirePermission('config.user.manage'), (req: AuthedRequest, res, next) => {
  try {
    const { email, employeeId, roles } = req.body ?? {}
    if (typeof email !== 'string' || !email.includes('@') || typeof employeeId !== 'string') {
      throw httpError(400, 'Thông tin tài khoản không hợp lệ.')
    }
    if (!Array.isArray(roles) || roles.length === 0 || new Set(roles).size !== roles.length || roles.some((role) => !ALL_ROLES.includes(role))) {
      throw httpError(400, 'Danh sách vai trò không hợp lệ.')
    }
    if (!getEmployee(employeeId)) throw httpError(404, 'Không tìm thấy nhân viên liên kết.')
    const id = uid('usr')
    const perms = ['View']
    db.prepare('INSERT INTO users (id, email, employee_id, password_hash, roles, permissions, department_scopes) VALUES (?,?,?,?,?,?,?)')
      .run(id, email, employeeId, '$2a$10$placeholderhashforcreateduser000000000000000000000', JSON.stringify(roles), JSON.stringify(perms), '[]')
    pushAudit(req.user!.id, req.user!.email, 1, 'User', id, `Tạo tài khoản ${email}`)
    res.json(mapUser(db.prepare('SELECT * FROM users WHERE id=?').get(id) as any))
  } catch (e) { next(e) }
})

/* ------------------------------- Profile ---------------------------------- */
configRouter.get('/profile', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const e = getEmployee(req.user!.employeeId)
    if (!e) throw httpError(404, 'Không tìm thấy hồ sơ.')
    res.json(e)
  } catch (e) { next(e) }
})

configRouter.put('/profile', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const e = getEmployee(req.user!.employeeId)
    if (!e) throw httpError(404, 'Không tìm thấy hồ sơ.')
    const allowed = ['firstName', 'lastName', 'phone', 'address', 'maritalStatus', 'avatarData', 'dateOfBirth', 'gender']
    const colMap: Record<string, string> = { firstName: 'first_name', lastName: 'last_name', phone: 'phone', address: 'address', maritalStatus: 'marital_status', avatarData: 'avatar_data', dateOfBirth: 'date_of_birth', gender: 'gender' }
    const sets: string[] = [], vals: any[] = []
    for (const k of allowed) if (k in req.body) { sets.push(`${colMap[k]}=?`); vals.push(req.body[k]) }
    if ('firstName' in req.body || 'lastName' in req.body) {
      const fn = req.body.firstName ?? e.firstName, ln = req.body.lastName ?? e.lastName
      sets.push('full_name=?'); vals.push(`${ln} ${fn}`.trim())
    }
    if (sets.length) { vals.push(e.id); db.prepare(`UPDATE employees SET ${sets.join(',')} WHERE id=?`).run(...vals) }
    pushAudit(req.user!.id, req.user!.email, 2, 'Employee', e.id, 'Tự cập nhật hồ sơ')
    res.json(getEmployee(e.id))
  } catch (e) { next(e) }
})
