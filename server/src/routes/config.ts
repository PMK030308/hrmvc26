// Config routes: quy định chấm công, loại nghỉ, role/permission, profile (§9/§11)
import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db.js'
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js'
import { getRegulation, mapRegulation, getEmployee, getUserById, mapUser, uid } from '../repo.js'
import { httpError } from '../types.js'
import { pushAudit } from '../helpers.js'
import {
  getPermissionMatrixSnapshot, replacePermissionMatrix, updateAuthorizationUser, validateGenericPermissionMatrix,
  ALL_ROLES, type PermissionMatrixEntry,
} from '../services/permissionService.js'
import { loadAuthorizationActor } from '../authz/authorizationActor.js'

export const configRouter = Router()

const gpsCatalogSchema = z.object({
  id: z.string().min(1).optional(), name: z.string().trim().min(1).max(100),
  lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180),
  radiusMeters: z.number().int().positive().max(100000),
})
const wifiCatalogSchema = z.object({
  id: z.string().min(1).optional(), ssid: z.string().trim().min(1).max(100), bssid: z.string().trim().max(100).nullable().optional(),
})
const ipCatalogSchema = z.object({
  id: z.string().min(1).optional(), ipAddress: z.string().trim().min(1).max(100), subnetBits: z.number().int().min(0).max(128),
})
const regulationSchema = z.object({
  enablePunchFace: z.boolean().optional(), enablePunchGps: z.boolean().optional(), enablePunchWifi: z.boolean().optional(),
  enablePunchIp: z.boolean().optional(), enablePunchQr: z.boolean().optional(), requireLivenessCheck: z.boolean().optional(),
  livenessStrictness: z.number().int().min(0).max(10).optional(), alternativePunchMethod: z.number().int().nullable().optional(),
  canEmployeeTrackWorkHours: z.boolean().optional(), allowEmployeeShiftRegistration: z.boolean().optional(),
  allowEmployeeViewDetailTimesheetDaily: z.boolean().optional(), duplicateWindowSeconds: z.number().int().nonnegative().optional(),
  otMonthlyCapHours: z.number().nonnegative().optional(), otYearlyCapHours: z.number().nonnegative().optional(),
  weekdayOtCoeff: z.number().nonnegative().optional(), weekendOtCoeff: z.number().nonnegative().optional(),
  holidayOtCoeff: z.number().nonnegative().optional(), nightCoeff: z.number().nonnegative().optional(),
  nightOtExtra: z.number().nonnegative().optional(), standardMonthlyHours: z.number().positive().optional(),
  gpsCatalog: z.array(gpsCatalogSchema).max(500).optional(), wifiCatalog: z.array(wifiCatalogSchema).max(500).optional(),
  ipCatalog: z.array(ipCatalogSchema).max(500).optional(),
})
const leaveTypeSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(), category: z.number().int().positive().optional(),
  fundType: z.number().int().positive().optional(), maxDays: z.number().int().nonnegative().nullable().optional(),
  requireAttachment: z.boolean().optional(), requireReason: z.boolean().optional(),
  dayCalculationType: z.number().int().positive().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'Không có dữ liệu cần cập nhật.' })
const createUserSchema = z.object({
  email: z.string().trim().email().max(200), employeeId: z.string().min(1),
  roles: z.array(z.string().min(1)).min(1),
})

/* ------------------------------ Quy định ---------------------------------- */
configRouter.get('/regulations/attendance', requireAuth, requirePermission('config.regulation.view'), (_req, res) => {
  res.json(getRegulation())
})

configRouter.put('/regulations/attendance', requireAuth, requirePermission('config.regulation.manage'), (req: AuthedRequest, res, next) => {
  try {
    const parsed = regulationSchema.safeParse(req.body ?? {})
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Quy định không hợp lệ.')
    const p = parsed.data
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
    const save = db.transaction(() => {
      const actor = loadAuthorizationActor(req.user!.id)
      if (!actor.permissions.has('config.regulation.manage')) throw httpError(403, 'Bạn không có quyền cập nhật quy định.')
      const reg = db.prepare('SELECT * FROM regulation LIMIT 1').get() as any
      if (!reg) throw httpError(404, 'Chưa có quy định.')
      const sets: string[] = [], vals: any[] = []
      for (const k of Object.keys(map)) {
        if (k in p) {
          const col = map[k]
          if (col.startsWith('enable_') || col.startsWith('require_') || col.startsWith('can_') || col.startsWith('allow_')) {
            sets.push(`${col}=?`); vals.push((p as any)[k] ? 1 : 0)
          } else { sets.push(`${col}=?`); vals.push((p as any)[k]) }
        }
      }
      if (sets.length) { vals.push(reg.id); db.prepare(`UPDATE regulation SET ${sets.join(',')} WHERE id=?`).run(...vals) }
      if (p.gpsCatalog) {
        db.prepare('DELETE FROM gps_catalog WHERE regulation_id=?').run(reg.id)
        for (const g of p.gpsCatalog) db.prepare('INSERT INTO gps_catalog (id, regulation_id, name, lat, lng, radius_meters) VALUES (?,?,?,?,?,?)')
          .run(g.id ?? uid('gps'), reg.id, g.name, g.lat, g.lng, g.radiusMeters)
      }
      if (p.wifiCatalog) {
        db.prepare('DELETE FROM wifi_catalog WHERE regulation_id=?').run(reg.id)
        for (const w of p.wifiCatalog) db.prepare('INSERT INTO wifi_catalog (id, regulation_id, ssid, bssid) VALUES (?,?,?,?)')
          .run(w.id ?? uid('wifi'), reg.id, w.ssid, w.bssid ?? null)
      }
      if (p.ipCatalog) {
        db.prepare('DELETE FROM ip_catalog WHERE regulation_id=?').run(reg.id)
        for (const item of p.ipCatalog) db.prepare('INSERT INTO ip_catalog (id, regulation_id, ip_address, subnet_bits) VALUES (?,?,?,?)')
          .run(item.id ?? uid('ip'), reg.id, item.ipAddress, item.subnetBits)
      }
      pushAudit(actor.userId, actor.email, 2, 'Regulation', null, 'Cập nhật quy định chấm công')
      return getRegulation()
    })
    res.json(save.immediate())
  } catch (e) { next(e) }
})

/* ------------------------------- Loại nghỉ -------------------------------- */
configRouter.get('/leave-types', requireAuth, requirePermission('config.leave_type.view'), (_req, res) => {
  res.json((db.prepare('SELECT * FROM leave_types').all() as any[]).map((r) => ({
    id: r.id, name: r.name, category: r.category, fundType: r.fund_type, maxDays: r.max_days,
    requireAttachment: !!r.require_attachment, requireReason: !!r.require_reason, dayCalculationType: r.day_calculation_type,
  })))
})

configRouter.put('/leave-types/:id', requireAuth, requirePermission('config.leave_type.manage'), (req: AuthedRequest, res, next) => {
  try {
    const parsed = leaveTypeSchema.safeParse(req.body ?? {})
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Loại nghỉ không hợp lệ.')
    const p = parsed.data
    const map: Record<string, string> = {
      name: 'name', category: 'category', fundType: 'fund_type', maxDays: 'max_days',
      requireReason: 'require_reason', dayCalculationType: 'day_calculation_type',
    }
    const save = db.transaction(() => {
      const actor = loadAuthorizationActor(req.user!.id)
      if (!actor.permissions.has('config.leave_type.manage')) throw httpError(403, 'Bạn không có quyền cập nhật loại nghỉ.')
      const row = db.prepare('SELECT * FROM leave_types WHERE id=?').get(req.params.id) as any
      if (!row) throw httpError(404, 'Không tìm thấy loại nghỉ.')
      const sets: string[] = [], vals: any[] = []
      for (const k of Object.keys(map)) if (k in p) { sets.push(`${map[k]}=?`); vals.push((p as any)[k]) }
      if ('requireAttachment' in p) { sets.push('require_attachment=?'); vals.push(p.requireAttachment ? 1 : 0) }
      vals.push(req.params.id)
      db.prepare(`UPDATE leave_types SET ${sets.join(',')} WHERE id=?`).run(...vals)
      pushAudit(actor.userId, actor.email, 2, 'LeaveType', req.params.id, `Cập nhật loại nghỉ ${p.name ?? row.name}`)
      return (db.prepare('SELECT * FROM leave_types WHERE id=?').get(req.params.id) as any)
    })
    res.json(save.immediate())
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
    const parsed = createUserSchema.safeParse(req.body ?? {})
    if (!parsed.success) throw httpError(400, 'Thông tin tài khoản không hợp lệ.')
    const { email, employeeId, roles } = parsed.data
    if (roles.length === 0 || new Set(roles).size !== roles.length || roles.some((role) => !ALL_ROLES.includes(role as any))) {
      throw httpError(400, 'Danh sách vai trò không hợp lệ.')
    }
    const create = db.transaction(() => {
      const actor = loadAuthorizationActor(req.user!.id)
      if (!actor.permissions.has('config.user.manage')) throw httpError(403, 'Bạn không có quyền tạo tài khoản.')
      if (!getEmployee(employeeId)) throw httpError(404, 'Không tìm thấy nhân viên liên kết.')
      if (db.prepare('SELECT 1 FROM users WHERE LOWER(email)=LOWER(?)').get(email)) throw httpError(409, 'Email tài khoản đã tồn tại.')
      if (db.prepare('SELECT 1 FROM users WHERE employee_id=?').get(employeeId)) throw httpError(409, 'Nhân viên đã được liên kết với tài khoản khác.')
      const id = uid('usr')
      db.prepare('INSERT INTO users (id, email, employee_id, password_hash, roles, permissions, department_scopes) VALUES (?,?,?,?,?,?,?)')
        .run(id, email.toLowerCase(), employeeId, '$2a$10$placeholderhashforcreateduser000000000000000000000', JSON.stringify(roles), '[]', '[]')
      pushAudit(actor.userId, actor.email, 1, 'User', id, `Tạo tài khoản ${email}`)
      return mapUser(db.prepare('SELECT * FROM users WHERE id=?').get(id) as any)
    })
    res.json(create.immediate())
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
