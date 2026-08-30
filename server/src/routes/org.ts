// Org routes: branches / departments / positions / employees (Admin/HR)
import { Router } from 'express'
import { db } from '../db.js'
import { requireAuth, requireRole, type AuthedRequest } from '../middleware/auth.js'
import { allEmployees, getEmployee, mapEmployee, mapBranch, mapDepartment, mapPosition, uid } from '../repo.js'
import { httpError } from '../types.js'
import { applyEmployeeStatusAuthorizationChange } from '../services/permissionService.js'
import { pushAudit } from '../helpers.js'
import { isoNow } from '../lib/date.js'
import { truncateAndSeed } from '../seed.js'

export const orgRouter = Router()

orgRouter.get('/branches', requireAuth, requireRole('HR', 'Admin'), (_req, res) => {
  res.json((db.prepare('SELECT * FROM branches').all() as any[]).map(mapBranch))
})
orgRouter.get('/departments', requireAuth, requireRole('HR', 'Admin', 'Manager'), (_req, res) => {
  res.json((db.prepare('SELECT * FROM departments').all() as any[]).map(mapDepartment))
})
orgRouter.get('/positions', requireAuth, requireRole('HR', 'Admin'), (_req, res) => {
  res.json((db.prepare('SELECT * FROM positions').all() as any[]).map(mapPosition))
})

orgRouter.get('/employees', requireAuth, requireRole('HR', 'Admin', 'Manager', 'Director', 'Accountant'), (req, res) => {
  let list = allEmployees()
  if (req.query.departmentId) list = list.filter((e) => e.departmentId === req.query.departmentId)
  if (req.query.search) {
    const q = String(req.query.search).toLowerCase()
    list = list.filter((e) => e.fullName.toLowerCase().includes(q) || e.employeeCode.toLowerCase().includes(q) || e.email.toLowerCase().includes(q))
  }
  res.json(list)
})

orgRouter.get('/employees/:id', requireAuth, requireRole('HR', 'Admin', 'Manager', 'Director'), (req, res, next) => {
  try {
    const e = getEmployee(req.params.id)
    if (!e) throw httpError(404, 'Không tìm thấy nhân viên.')
    res.json(e)
  } catch (e) { next(e) }
})

orgRouter.post('/employees', requireAuth, requireRole('HR', 'Admin'), (req: AuthedRequest, res, next) => {
  try {
    const p = req.body ?? {}
    const id = uid('emp')
    const count = (db.prepare('SELECT COUNT(*) c FROM employees').get() as any).c
    const code = p.employeeCode ?? `NV${String(count + 1).padStart(3, '0')}`
    const firstName = p.firstName ?? '', lastName = p.lastName ?? ''
    db.prepare(`INSERT INTO employees (id, employee_code, first_name, last_name, full_name, gender, date_of_birth,
      email, phone, address, marital_status, status, avatar_data, manager_id, department_id, position_id,
      branch_id, hire_date, work_nature, contract_type, wage, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, code, firstName, lastName, `${lastName} ${firstName}`.trim(), p.gender ?? 1, p.dateOfBirth ?? null,
      p.email ?? '', p.phone ?? '', p.address ?? '', p.maritalStatus ?? 'Single', p.status ?? 1, p.avatarData ?? null,
      p.managerId ?? null, p.departmentId ?? '', p.positionId ?? '', p.branchId ?? null,
      p.hireDate ?? new Date().toISOString().slice(0, 10), p.workNature ?? 1, p.contractType ?? 2, p.wage ?? 0, isoNow())
    const e = getEmployee(id)!
    pushAudit(req.user!.id, req.user!.email, 1, 'Employee', e.id, `Tạo NV ${e.fullName} (${e.employeeCode})`)
    res.json(e)
  } catch (e) { next(e) }
})

orgRouter.put('/employees/:id', requireAuth, requireRole('HR', 'Admin'), (req: AuthedRequest, res, next) => {
  try {
    const e = getEmployee(req.params.id)
    if (!e) throw httpError(404, 'Không tìm thấy nhân viên.')
    const p = req.body ?? {}
    const firstName = p.firstName ?? e.firstName, lastName = p.lastName ?? e.lastName
    const sets: string[] = []
    const vals: any[] = []
    const map: Record<string, string> = {
      firstName: 'first_name', lastName: 'last_name', gender: 'gender', dateOfBirth: 'date_of_birth',
      email: 'email', phone: 'phone', address: 'address', maritalStatus: 'marital_status', status: 'status',
      avatarData: 'avatar_data', managerId: 'manager_id', departmentId: 'department_id', positionId: 'position_id',
      branchId: 'branch_id', hireDate: 'hire_date', workNature: 'work_nature', contractType: 'contract_type', wage: 'wage',
    }
    for (const k of Object.keys(map)) if (k in p) { sets.push(`${map[k]}=?`); vals.push(p[k]) }
    sets.push('full_name=?'); vals.push(`${lastName} ${firstName}`.trim())
    vals.push(req.params.id)
    const updateEmployee = db.transaction(() => {
      if ('status' in p) applyEmployeeStatusAuthorizationChange(req.params.id, e.status, Number(p.status))
      db.prepare(`UPDATE employees SET ${sets.join(',')} WHERE id=?`).run(...vals)
      pushAudit(req.user!.id, req.user!.email, 2, 'Employee', req.params.id, `Cập nhật NV ${lastName} ${firstName}`.trim())
      return getEmployee(req.params.id)
    })
    res.json(updateEmployee.immediate())
  } catch (e) { next(e) }
})

orgRouter.delete('/employees/:id', requireAuth, requireRole('Admin'), (req: AuthedRequest, res, next) => {
  try {
    if (db.prepare('SELECT 1 FROM users WHERE employee_id=?').get(req.params.id)) {
      throw httpError(409, 'Không thể xóa nhân viên đang liên kết với tài khoản. Hãy xử lý tài khoản trước.')
    }
    db.prepare('DELETE FROM employees WHERE id=?').run(req.params.id)
    pushAudit(req.user!.id, req.user!.email, 3, 'Employee', req.params.id, `Xóa NV ${req.params.id}`)
    res.json({ ok: true })
  } catch (e) { next(e) }
})

orgRouter.post('/reset-demo', requireAuth, requireRole('Admin'), (_req, res, next) => {
  try { truncateAndSeed(); res.json({ ok: true }) } catch (e) { next(e) }
})
