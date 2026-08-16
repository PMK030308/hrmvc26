// Config routes: quy định chấm công, loại nghỉ, role/permission, profile (§9/§11)
import { Router } from 'express'
import { db } from '../db.js'
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.js'
import { getRegulation, mapRegulation, getEmployee, mapUser, uid } from '../repo.js'
import { httpError } from '../types.js'
import { pushAudit } from '../helpers.js'

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
const FEATURE_PERMS = [
  { feature: 'attendance.punch', perms: { Employee: ['View'], Manager: ['View'], HR: ['View'], Admin: ['View'] } },
  { feature: 'requests.create', perms: { Employee: ['Create'], Manager: ['Create'], HR: ['Create'], Admin: ['Create'] } },
  { feature: 'requests.approve', perms: { Manager: ['Approve'], HR: ['Approve'], Director: ['Approve'], Admin: ['Approve'] } },
  { feature: 'attendance.proxy', perms: { Manager: ['Create'], HR: ['Create'], Admin: ['Create'] } },
  { feature: 'timesheet.view', perms: { Employee: ['View'], Manager: ['View'], HR: ['View'], Director: ['View'], Admin: ['View'] } },
  { feature: 'payroll.manage', perms: { Accountant: ['View', 'Edit'], HR: ['View'], Director: ['Approve'], Admin: ['View'] } },
  { feature: 'regulations.edit', perms: { HR: ['Edit'], Admin: ['Edit'] } },
  { feature: 'roles.manage', perms: { Admin: ['View', 'Edit'] } },
  { feature: 'audit.view', perms: { Admin: ['View'] } },
  { feature: 'reports.view', perms: { Manager: ['View'], Accountant: ['View'], HR: ['View'], Director: ['View'], Admin: ['View'] } },
]

configRouter.get('/roles/matrix', requireAuth, requireRole('Admin'), (_req, res) => {
  res.json(FEATURE_PERMS.map((f) => ({
    feature: f.feature,
    perms: Object.entries(f.perms).map(([role, flags]) => ({ role, flags })),
  })))
})

configRouter.get('/roles/users', requireAuth, requireRole('Admin'), (_req, res) => {
  res.json((db.prepare('SELECT * FROM users').all() as any[]).map(mapUser))
})

configRouter.put('/roles/users/:userId', requireAuth, requireRole('Admin'), (req: AuthedRequest, res, next) => {
  try {
    const row = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.userId) as any
    if (!row) throw httpError(404, 'Không tìm thấy user.')
    const roles = req.body ?? []
    db.prepare('UPDATE users SET roles=? WHERE id=?').run(JSON.stringify(roles), req.params.userId)
    pushAudit(req.user!.id, req.user!.email, 2, 'User', req.params.userId, `Cập nhật role cho ${row.email}: ${roles.join(', ')}`)
    res.json(mapUser({ ...row, roles: JSON.stringify(roles) }))
  } catch (e) { next(e) }
})

configRouter.post('/roles/users', requireAuth, requireRole('Admin'), (req: AuthedRequest, res, next) => {
  try {
    const { email, employeeId, roles } = req.body ?? {}
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
    const allowed = ['firstName', 'lastName', 'phone', 'address', 'maritalStatus', 'avatarData', 'dateOfBirth']
    const colMap: Record<string, string> = { firstName: 'first_name', lastName: 'last_name', phone: 'phone', address: 'address', maritalStatus: 'marital_status', avatarData: 'avatar_data', dateOfBirth: 'date_of_birth' }
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