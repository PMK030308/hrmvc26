import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db.js'
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js'
import { getEmployee, mapBranch, mapDepartment, mapEmployee, mapPosition, uid } from '../repo.js'
import { httpError } from '../types.js'
import { applyEmployeeStatusAuthorizationChange } from '../services/permissionService.js'
import { pushAudit } from '../helpers.js'
import { isoNow } from '../lib/date.js'
import { truncateAndSeed } from '../seed.js'
import { validateAvatarData } from '../services/mediaValidation.js'
import { loadAuthorizationActor } from '../authz/authorizationActor.js'
import {
  canCreateEmployeeInDepartment,
  canCreateEmployees,
  canListEmployees,
  canManageEmployee,
  canViewEmployee,
  ORGANIZATION_PERMISSIONS,
  projectEmployee,
} from '../authz/organizationAuthorization.js'

export const orgRouter = Router()

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const employeeFields = {
  employeeCode: z.string().trim().min(1).max(50).optional(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  gender: z.number().int().min(1).max(3).optional(),
  dateOfBirth: dateOnly.nullable().optional(),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(500).optional(),
  maritalStatus: z.string().trim().max(50).optional(),
  status: z.number().int().min(1).max(5).optional(),
  avatarData: z.string().nullable().optional(),
  managerId: z.string().min(1).nullable().optional(),
  departmentId: z.string().min(1),
  positionId: z.string().min(1),
  branchId: z.string().min(1).nullable().optional(),
  hireDate: dateOnly.optional(),
  workNature: z.number().int().min(1).max(10).optional(),
  contractType: z.number().int().min(1).max(10).optional(),
  wage: z.number().finite().nonnegative().optional(),
}
const createEmployeeSchema = z.object(employeeFields)
const updateEmployeeSchema = z.object({
  ...employeeFields,
  firstName: employeeFields.firstName.optional(),
  lastName: employeeFields.lastName.optional(),
  email: employeeFields.email.optional(),
  departmentId: employeeFields.departmentId.optional(),
  positionId: employeeFields.positionId.optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'Không có dữ liệu cần cập nhật.' })

type EmployeeInput = z.infer<typeof createEmployeeSchema>
type EmployeeUpdate = z.infer<typeof updateEmployeeSchema>

function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Dữ liệu nhân viên không hợp lệ.')
  return parsed.data
}

function requireExistingReference(table: 'departments' | 'positions' | 'branches' | 'employees', id: string | null | undefined, label: string): void {
  if (id == null) return
  if (!db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(id)) throw httpError(400, `${label} không tồn tại.`)
}

function validateEmployeeReferences(input: Partial<EmployeeInput>, targetId?: string): void {
  requireExistingReference('departments', input.departmentId, 'Phòng ban')
  requireExistingReference('positions', input.positionId, 'Vị trí')
  requireExistingReference('branches', input.branchId, 'Chi nhánh')
  requireExistingReference('employees', input.managerId, 'Quản lý trực tiếp')
  if (input.managerId && input.managerId === targetId) throw httpError(400, 'Nhân viên không thể tự quản lý chính mình.')
}

function validateEmployeeUniqueness(employeeCode: string | undefined, email: string | undefined, excludeId?: string): void {
  if (employeeCode) {
    const duplicate = db.prepare('SELECT id FROM employees WHERE LOWER(employee_code)=LOWER(?) AND (? IS NULL OR id<>?)')
      .get(employeeCode, excludeId ?? null, excludeId ?? null) as any
    if (duplicate) throw httpError(409, 'Mã nhân viên đã tồn tại.')
  }
  if (email) {
    const duplicate = db.prepare('SELECT id FROM employees WHERE LOWER(email)=LOWER(?) AND (? IS NULL OR id<>?)')
      .get(email, excludeId ?? null, excludeId ?? null) as any
    if (duplicate) throw httpError(409, 'Email nhân viên đã tồn tại.')
  }
}

function nextEmployeeCode(): string {
  let sequence = Number((db.prepare('SELECT COUNT(*) count FROM employees').get() as any).count) + 1
  while (true) {
    const code = `NV${String(sequence).padStart(3, '0')}`
    if (!db.prepare('SELECT 1 FROM employees WHERE employee_code=?').get(code)) return code
    sequence += 1
  }
}

orgRouter.get('/branches', requireAuth, requirePermission(ORGANIZATION_PERMISSIONS.CATALOG_VIEW), (_req, res) => {
  res.json((db.prepare('SELECT * FROM branches').all() as any[]).map(mapBranch))
})
orgRouter.get('/departments', requireAuth, requirePermission(ORGANIZATION_PERMISSIONS.CATALOG_VIEW), (_req, res) => {
  res.json((db.prepare('SELECT * FROM departments').all() as any[]).map(mapDepartment))
})
orgRouter.get('/positions', requireAuth, requirePermission(ORGANIZATION_PERMISSIONS.CATALOG_VIEW), (_req, res) => {
  res.json((db.prepare('SELECT * FROM positions').all() as any[]).map(mapPosition))
})

orgRouter.get('/employees', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const actor = req.authorizationActor!
    if (!canListEmployees(actor)) throw httpError(403, 'Bạn không có quyền xem danh sách nhân viên.')
    let list = (db.prepare('SELECT * FROM employees').all() as any[]).map(mapEmployee)
      .filter((employee) => canViewEmployee(actor, employee))
    if (req.query.departmentId) list = list.filter((employee) => employee.departmentId === String(req.query.departmentId))
    if (req.query.search) {
      const query = String(req.query.search).trim().toLowerCase()
      list = list.filter((employee) => employee.fullName.toLowerCase().includes(query)
        || employee.employeeCode.toLowerCase().includes(query) || employee.email.toLowerCase().includes(query))
    }
    res.json(list.map((employee) => projectEmployee(employee, actor)))
  } catch (error) { next(error) }
})

orgRouter.get('/employees/:id', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const actor = req.authorizationActor!
    const employee = getEmployee(req.params.id)
    if (!employee || !canViewEmployee(actor, employee)) throw httpError(404, 'Không tìm thấy nhân viên.')
    res.json(projectEmployee(employee, actor))
  } catch (error) { next(error) }
})

orgRouter.post('/employees', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const input = parseInput(createEmployeeSchema, req.body ?? {})
    if (input.avatarData !== undefined) input.avatarData = validateAvatarData(input.avatarData)
    const create = db.transaction(() => {
      const actor = loadAuthorizationActor(req.user!.id)
      if (!canCreateEmployees(actor)) throw httpError(403, 'Bạn không có quyền tạo nhân viên.')
      validateEmployeeReferences(input)
      if (!canCreateEmployeeInDepartment(actor, input.departmentId)) throw httpError(403, 'Bạn không có quyền tạo nhân viên trong phòng ban này.')
      const employeeCode = input.employeeCode ?? nextEmployeeCode()
      validateEmployeeUniqueness(employeeCode, input.email)
      const id = uid('emp')
      const fullName = `${input.lastName} ${input.firstName}`.trim()
      db.prepare(`INSERT INTO employees
        (id, employee_code, first_name, last_name, full_name, gender, date_of_birth, email, phone, address,
         marital_status, status, avatar_data, manager_id, department_id, position_id, branch_id, hire_date,
         work_nature, contract_type, wage, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, employeeCode, input.firstName, input.lastName, fullName, input.gender ?? 1,
        input.dateOfBirth ?? null, input.email, input.phone ?? '', input.address ?? '', input.maritalStatus ?? 'Single',
        input.status ?? 1, input.avatarData ?? null, input.managerId ?? null, input.departmentId, input.positionId,
        input.branchId ?? null, input.hireDate ?? new Date().toISOString().slice(0, 10), input.workNature ?? 1,
        input.contractType ?? 2, input.wage ?? 0, isoNow(),
      )
      pushAudit(actor.userId, actor.email, 1, 'Employee', id, `Tạo NV ${fullName} (${employeeCode})`)
      return projectEmployee(getEmployee(id)!, actor)
    })
    res.json(create.immediate())
  } catch (error) { next(error) }
})

orgRouter.put('/employees/:id', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const input = parseInput(updateEmployeeSchema, req.body ?? {}) as EmployeeUpdate
    if (input.avatarData !== undefined) input.avatarData = validateAvatarData(input.avatarData)
    const update = db.transaction(() => {
      const actor = loadAuthorizationActor(req.user!.id)
      const employee = getEmployee(req.params.id)
      if (!employee || !canManageEmployee(actor, employee)) throw httpError(404, 'Không tìm thấy nhân viên.')
      validateEmployeeReferences(input, employee.id)
      const nextDepartmentId = input.departmentId ?? employee.departmentId
      if (nextDepartmentId !== employee.departmentId && !canCreateEmployeeInDepartment(actor, nextDepartmentId)) {
        throw httpError(404, 'Không tìm thấy nhân viên.')
      }
      validateEmployeeUniqueness(input.employeeCode, input.email, employee.id)
      const firstName = input.firstName ?? employee.firstName
      const lastName = input.lastName ?? employee.lastName
      const columns: Record<string, string> = {
        employeeCode: 'employee_code', firstName: 'first_name', lastName: 'last_name', gender: 'gender',
        dateOfBirth: 'date_of_birth', email: 'email', phone: 'phone', address: 'address', maritalStatus: 'marital_status',
        status: 'status', avatarData: 'avatar_data', managerId: 'manager_id', departmentId: 'department_id',
        positionId: 'position_id', branchId: 'branch_id', hireDate: 'hire_date', workNature: 'work_nature',
        contractType: 'contract_type', wage: 'wage',
      }
      const sets: string[] = []
      const values: unknown[] = []
      for (const [key, column] of Object.entries(columns)) {
        if (key in input) { sets.push(`${column}=?`); values.push((input as any)[key]) }
      }
      sets.push('full_name=?')
      values.push(`${lastName} ${firstName}`.trim())
      if (input.status !== undefined) applyEmployeeStatusAuthorizationChange(employee.id, employee.status, input.status)
      values.push(employee.id)
      db.prepare(`UPDATE employees SET ${sets.join(',')} WHERE id=?`).run(...values)
      pushAudit(actor.userId, actor.email, 2, 'Employee', employee.id, `Cập nhật NV ${lastName} ${firstName}`.trim())
      return projectEmployee(getEmployee(employee.id)!, actor)
    })
    res.json(update.immediate())
  } catch (error) { next(error) }
})

orgRouter.delete('/employees/:id', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const deactivate = db.transaction(() => {
      const actor = loadAuthorizationActor(req.user!.id)
      const employee = getEmployee(req.params.id)
      if (!employee || !canManageEmployee(actor, employee)) throw httpError(404, 'Không tìm thấy nhân viên.')
      if (employee.status === 4 || employee.status === 5) throw httpError(409, 'Nhân viên đã ngừng hoạt động.')
      applyEmployeeStatusAuthorizationChange(employee.id, employee.status, 4)
      db.prepare('UPDATE employees SET status=4 WHERE id=?').run(employee.id)
      db.prepare('UPDATE users SET is_active=0 WHERE employee_id=?').run(employee.id)
      pushAudit(actor.userId, actor.email, 3, 'Employee', employee.id, `Cho nghỉ việc NV ${employee.fullName} (${employee.employeeCode})`)
    })
    deactivate.immediate()
    res.json({ ok: true })
  } catch (error) { next(error) }
})

orgRouter.post('/reset-demo', requireAuth, requirePermission('system.demo_reset'), (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production' || process.env.HRM_ALLOW_DEMO_RESET !== 'true') {
      throw httpError(404, 'Không tìm thấy endpoint.')
    }
    if (req.body?.confirmation !== 'RESET_DEMO_DATA') {
      throw httpError(400, 'Cần xác nhận chính xác để khôi phục dữ liệu demo.')
    }
    truncateAndSeed()
    res.json({ ok: true })
  } catch (error) { next(error) }
})
