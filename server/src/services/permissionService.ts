import { db } from '../db.js'
import { isoNow } from '../lib/date.js'
import { mapUser } from '../repo.js'
import { httpError, type RoleCode } from '../types.js'
import { ALL_PERMISSION_KEYS, PERMISSION_BY_KEY, PERMISSION_CATALOG } from '../authz/permissionCatalog.js'

export const ALL_ROLES: RoleCode[] = ['Guest', 'Employee', 'Manager', 'Accountant', 'HR', 'Director', 'Admin']
export const ALL_REQUEST_PERMISSIONS = PERMISSION_CATALOG.filter((permission) => permission.module === 'requests').map((permission) => permission.key)
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleCode, string[]> = Object.fromEntries(
  ALL_ROLES.map((role) => [role, PERMISSION_CATALOG.filter((permission) => permission.defaultRoles.includes(role)).map((permission) => permission.key)]),
) as Record<RoleCode, string[]>

function splitPermission(permission: string): { feature: string; action: string } {
  const separator = permission.lastIndexOf('.')
  if (separator <= 0 || separator === permission.length - 1) throw new Error(`Permission key không hợp lệ: ${permission}`)
  return { feature: permission.slice(0, separator), action: permission.slice(separator + 1) }
}

function parseStringArray(value: string | null | undefined): string[] {
  try {
    const parsed = value ? JSON.parse(value) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch { return [] }
}

export function mergeRolePermissions(roles: string[], source: Partial<Record<RoleCode, readonly string[]>>): Set<string> {
  const permissions = new Set<string>()
  for (const role of roles) for (const permission of source[role as RoleCode] ?? []) permissions.add(permission)
  return permissions
}

export function ensureDefaultRolePermissions(): void {
  const insert = db.prepare(`INSERT OR IGNORE INTO role_feature_permissions
    (role, feature, action, allowed, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, NULL)`)
  const seed = db.transaction(() => {
    const now = isoNow()
    for (const role of ALL_ROLES) {
      const defaults = new Set(DEFAULT_ROLE_PERMISSIONS[role])
      for (const permission of ALL_PERMISSION_KEYS) {
        const { feature, action } = splitPermission(permission)
        insert.run(role, feature, action, defaults.has(permission) ? 1 : 0, now)
      }
    }
  })
  seed.immediate()
}

export function getEffectivePermissions(roles: string[]): Set<string> {
  if (roles.length === 0) return new Set()
  const placeholders = roles.map(() => '?').join(',')
  const rows = db.prepare(`SELECT feature, action FROM role_feature_permissions
    WHERE allowed=1 AND role IN (${placeholders})`).all(...roles) as any[]
  return new Set(rows.map((row) => `${row.feature}.${row.action}`))
}

export interface PermissionMatrixEntry {
  key: string
  module: string
  label: string
  enforced: boolean
  roles: Record<RoleCode, boolean>
}
export interface PermissionMatrixSnapshot { version: number; permissions: PermissionMatrixEntry[] }
export interface ReplacePermissionMatrixInput { expectedVersion: number; permissions: PermissionMatrixEntry[] }

function matrixEntriesFromDatabase(): PermissionMatrixEntry[] {
  const rows = db.prepare('SELECT role, feature, action, allowed FROM role_feature_permissions').all() as any[]
  const allowed = new Map(rows.map((row) => [`${row.role}:${row.feature}.${row.action}`, !!row.allowed]))
  return PERMISSION_CATALOG.map((definition) => ({
    key: definition.key, module: definition.module, label: definition.label, enforced: definition.enforced,
    roles: Object.fromEntries(ALL_ROLES.map((role) => [role, allowed.get(`${role}:${definition.key}`) ?? false])) as Record<RoleCode, boolean>,
  }))
}

export function getPermissionMatrixSnapshot(): PermissionMatrixSnapshot {
  const state = db.prepare('SELECT version FROM permission_matrix_state WHERE id=1').get() as any
  if (!state) throw new Error('Permission matrix state chưa được khởi tạo migration.')
  return { version: Number(state.version), permissions: matrixEntriesFromDatabase() }
}

export function validateGenericPermissionMatrix(matrix: PermissionMatrixEntry[]): void {
  if (!Array.isArray(matrix) || matrix.length !== PERMISSION_CATALOG.length) throw new Error('Ma trận quyền phải có đầy đủ permission.')
  const validRoles = new Set<string>(ALL_ROLES)
  const seen = new Set<string>()
  for (const row of matrix) {
    if (!row || !PERMISSION_BY_KEY.has(row.key)) throw new Error('Permission không hợp lệ.')
    if (seen.has(row.key)) throw new Error(`Permission bị trùng: ${row.key}`)
    seen.add(row.key)
    if (!row.roles || typeof row.roles !== 'object') throw new Error(`Thiếu ma trận vai trò cho ${row.key}.`)
    const roleEntries = Object.entries(row.roles)
    if (roleEntries.length !== ALL_ROLES.length) throw new Error(`Ma trận vai trò không đầy đủ cho ${row.key}.`)
    for (const [role, allowed] of roleEntries) {
      if (!validRoles.has(role) || typeof allowed !== 'boolean') throw new Error(`Vai trò không hợp lệ cho ${row.key}.`)
    }
  }
}

function currentUserCanManage(userId: string, permission: 'config.permission.manage' | 'config.user.manage'): boolean {
  const row = db.prepare(`SELECT u.roles FROM users u JOIN employees e ON e.id=u.employee_id
    WHERE u.id=? AND u.is_active=1 AND e.status IN (1,2,3)`).get(userId) as any
  if (!row) return false
  const roles = parseStringArray(row.roles)
  if (roles.length === 0) return false
  const { feature, action } = splitPermission(permission)
  const placeholders = roles.map(() => '?').join(',')
  return !!db.prepare(`SELECT 1 FROM role_feature_permissions
    WHERE role IN (${placeholders}) AND feature=? AND action=? AND allowed=1 LIMIT 1`).get(...roles, feature, action)
}

function permissionManagerRoles(matrix: PermissionMatrixEntry[] | null = null): Set<string> {
  if (matrix) {
    const row = matrix.find((entry) => entry.key === 'config.permission.manage')
    return new Set(Object.entries(row?.roles ?? {}).filter(([, allowed]) => allowed).map(([role]) => role))
  }
  const { feature, action } = splitPermission('config.permission.manage')
  return new Set((db.prepare('SELECT role FROM role_feature_permissions WHERE feature=? AND action=? AND allowed=1').all(feature, action) as any[]).map((row) => row.role))
}

function hasActivePermissionManager(managerRoles: Set<string>, override?: { userId: string; roles: string[]; isActive: boolean }): boolean {
  const users = db.prepare(`SELECT u.id, u.roles, u.is_active, e.status employee_status
    FROM users u JOIN employees e ON e.id=u.employee_id`).all() as any[]
  return users.some((user) => {
    const isOverridden = !!override && override.userId === user.id
    const roles = isOverridden ? override!.roles : parseStringArray(user.roles)
    const active = isOverridden ? override!.isActive : !!user.is_active
    return active && [1, 2, 3].includes(Number(user.employee_status)) && roles.some((role) => managerRoles.has(role))
  })
}

export function applyEmployeeStatusAuthorizationChange(employeeId: string, currentStatus: number, proposedStatus: number): void {
  if (Number(currentStatus) === Number(proposedStatus)) return
  const target = db.prepare('SELECT id, roles, is_active FROM users WHERE employee_id=?').get(employeeId) as any
  if (!target) return
  if (![1, 2, 3].includes(Number(proposedStatus)) && target.is_active) {
    const managerRoles = permissionManagerRoles()
    const targetIsManager = parseStringArray(target.roles).some((role) => managerRoles.has(role))
    if (targetIsManager) {
      const others = db.prepare(`SELECT u.roles FROM users u JOIN employees e ON e.id=u.employee_id
        WHERE u.id<>? AND u.is_active=1 AND e.status IN (1,2,3)`).all(target.id) as any[]
      const anotherManagerExists = others.some((user) => parseStringArray(user.roles).some((role) => managerRoles.has(role)))
      if (!anotherManagerExists) {
        throw httpError(409, 'Không thể đổi trạng thái nhân viên vì đây là tài khoản quản lý phân quyền cuối cùng.')
      }
    }
  }
  db.prepare('UPDATE users SET authz_version=authz_version+1 WHERE id=?').run(target.id)
}

function insertAudit(actorId: string, entity: string, entityId: string | null, detail: string): void {
  const actor = db.prepare('SELECT email FROM users WHERE id=?').get(actorId) as any
  db.prepare(`INSERT INTO audit_logs
    (id, user_id, user_name, action, entity, entity_id, detail, ip_address, created_at)
    VALUES (?, ?, ?, 2, ?, ?, ?, '127.0.0.1', ?)`)
    .run(`aud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, actorId, actor?.email ?? actorId, entity, entityId, detail, isoNow())
}

export function replacePermissionMatrix(input: ReplacePermissionMatrixInput, updatedBy: string): PermissionMatrixSnapshot {
  validateGenericPermissionMatrix(input.permissions)
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw httpError(400, 'Version ma trận quyền không hợp lệ.')
  const save = db.transaction(() => {
    if (!currentUserCanManage(updatedBy, 'config.permission.manage')) throw httpError(403, 'Bạn không có quyền quản lý ma trận phân quyền.')
    const current = getPermissionMatrixSnapshot()
    if (current.version !== input.expectedVersion) throw httpError(409, 'Ma trận quyền đã thay đổi. Vui lòng tải lại.')
    for (const proposed of input.permissions) {
      const definition = PERMISSION_BY_KEY.get(proposed.key)!
      if (!definition.enforced) {
        const existing = current.permissions.find((row) => row.key === proposed.key)!
        if (ALL_ROLES.some((role) => existing.roles[role] !== proposed.roles[role])) {
          throw httpError(400, `Permission ${proposed.key} chưa được backend thực thi nên chưa thể chỉnh sửa.`)
        }
      }
    }
    if (!hasActivePermissionManager(permissionManagerRoles(input.permissions))) {
      throw httpError(409, 'Phải giữ lại ít nhất một tài khoản đang hoạt động có quyền quản lý phân quyền.')
    }
    const update = db.prepare(`UPDATE role_feature_permissions SET allowed=?, updated_at=?, updated_by=?
      WHERE role=? AND feature=? AND action=?`)
    const now = isoNow()
    for (const row of input.permissions) {
      const { feature, action } = splitPermission(row.key)
      for (const role of ALL_ROLES) update.run(row.roles[role] ? 1 : 0, now, updatedBy, role, feature, action)
    }
    const versionUpdate = db.prepare('UPDATE permission_matrix_state SET version=version+1 WHERE id=1 AND version=?').run(input.expectedVersion)
    if (versionUpdate.changes !== 1) throw httpError(409, 'Ma trận quyền đã thay đổi. Vui lòng tải lại.')
    db.prepare('UPDATE users SET authz_version=authz_version+1').run()
    insertAudit(updatedBy, 'RolePermission', null, `Cập nhật ma trận quyền phiên bản ${input.expectedVersion + 1}`)
    return getPermissionMatrixSnapshot()
  })
  return save.immediate()
}

export interface UpdateAuthorizationUserInput {
  actorId: string
  targetUserId: string
  roles: RoleCode[]
  isActive: boolean
  departmentScopes: string[]
  expectedVersion: number
}

export function updateAuthorizationUser(input: UpdateAuthorizationUserInput): ReturnType<typeof mapUser> {
  const validRoles = new Set<string>(ALL_ROLES)
  if (!Array.isArray(input.roles) || input.roles.length === 0 || new Set(input.roles).size !== input.roles.length || input.roles.some((role) => !validRoles.has(role))) {
    throw httpError(400, 'Danh sách vai trò không hợp lệ.')
  }
  if (!Array.isArray(input.departmentScopes) || input.departmentScopes.some((scope) => typeof scope !== 'string')) throw httpError(400, 'Department scope không hợp lệ.')
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw httpError(400, 'Version tài khoản không hợp lệ.')
  const save = db.transaction(() => {
    if (!currentUserCanManage(input.actorId, 'config.user.manage')) throw httpError(403, 'Bạn không có quyền quản lý tài khoản.')
    const target = db.prepare('SELECT * FROM users WHERE id=?').get(input.targetUserId) as any
    if (!target) throw httpError(404, 'Không tìm thấy user.')
    if (Number(target.authz_version) !== input.expectedVersion) throw httpError(409, 'Tài khoản đã thay đổi. Vui lòng tải lại.')
    if (input.departmentScopes.length > 0) {
      const uniqueScopes = new Set(input.departmentScopes)
      const placeholders = [...uniqueScopes].map(() => '?').join(',')
      const count = (db.prepare(`SELECT COUNT(*) count FROM departments WHERE id IN (${placeholders})`).get(...uniqueScopes) as any).count
      if (Number(count) !== uniqueScopes.size || uniqueScopes.size !== input.departmentScopes.length) throw httpError(400, 'Department scope không tồn tại hoặc bị trùng.')
    }
    if (!hasActivePermissionManager(permissionManagerRoles(), { userId: input.targetUserId, roles: input.roles, isActive: input.isActive })) {
      throw httpError(409, 'Không thể vô hiệu hóa hoặc gỡ quyền của tài khoản quản lý phân quyền cuối cùng.')
    }
    const update = db.prepare(`UPDATE users SET roles=?, is_active=?, department_scopes=?, authz_version=authz_version+1
      WHERE id=? AND authz_version=?`).run(JSON.stringify(input.roles), input.isActive ? 1 : 0, JSON.stringify(input.departmentScopes), input.targetUserId, input.expectedVersion)
    if (update.changes !== 1) throw httpError(409, 'Tài khoản đã thay đổi. Vui lòng tải lại.')
    insertAudit(input.actorId, 'User', input.targetUserId, `Cập nhật phân quyền tài khoản ${target.email}`)
    return mapUser(db.prepare('SELECT * FROM users WHERE id=?').get(input.targetUserId) as any)
  })
  return save.immediate()
}

// Compatibility contract cho Phase 1 trong lúc frontend chuyển sang matrix chung.
export interface PermissionMatrixRow { permission: string; roles: Record<RoleCode, boolean> }
export function validatePermissionMatrix(matrix: PermissionMatrixRow[]): void {
  if (!Array.isArray(matrix) || matrix.length !== ALL_REQUEST_PERMISSIONS.length) throw new Error('Ma trận quyền phải có đầy đủ permission.')
  const valid = new Set(ALL_REQUEST_PERMISSIONS)
  const seen = new Set<string>()
  for (const row of matrix) {
    if (!row || !valid.has(row.permission)) throw new Error('Permission không hợp lệ.')
    if (seen.has(row.permission)) throw new Error(`Permission bị trùng: ${row.permission}`)
    seen.add(row.permission)
    if (!row.roles || Object.keys(row.roles).length !== ALL_ROLES.length) throw new Error(`Ma trận vai trò không đầy đủ cho ${row.permission}.`)
    for (const [role, allowed] of Object.entries(row.roles)) {
      if (!ALL_ROLES.includes(role as RoleCode) || typeof allowed !== 'boolean') throw new Error(`Vai trò không hợp lệ cho ${row.permission}.`)
    }
  }
}
export function getPermissionMatrix(): PermissionMatrixRow[] {
  return matrixEntriesFromDatabase().filter((row) => row.module === 'requests').map((row) => ({ permission: row.key, roles: row.roles }))
}
