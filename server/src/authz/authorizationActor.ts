import { db } from '../db.js'
import { httpError, type RoleCode } from '../types.js'

const ACTIVE_EMPLOYEE_STATUSES = new Set([1, 2, 3])

function jsonArray(value: string | null | undefined): string[] {
  try {
    const parsed = value ? JSON.parse(value) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch { return [] }
}

export interface AuthorizationActor {
  userId: string
  email: string
  employeeId: string
  employeeStatus: number
  roles: RoleCode[]
  assignedDepartmentScopes: string[]
  departmentScopes: string[]
  permissions: Set<string>
  legacyPermissions: string[]
  isActive: true
  /** Revision for conflict detection/capability refresh; authority is still loaded DB-fresh per request. */
  authorizationVersion: number
}

export function loadAuthorizationActor(userId: string): AuthorizationActor {
  const row = db.prepare(`SELECT u.*, e.status employee_status
    FROM users u JOIN employees e ON e.id=u.employee_id WHERE u.id=?`).get(userId) as any
  if (!row || !row.is_active || !ACTIVE_EMPLOYEE_STATUSES.has(Number(row.employee_status))) {
    throw httpError(401, 'Tài khoản không còn tồn tại hoặc đã bị vô hiệu hóa.')
  }
  const roles = jsonArray(row.roles) as RoleCode[]
  const assignedDepartmentScopes = jsonArray(row.department_scopes)
  const departmentScopes = new Set<string>()
  for (const scope of assignedDepartmentScopes) {
    const rows = db.prepare(`WITH RECURSIVE descendants(id) AS (
      SELECT id FROM departments WHERE id=?
      UNION ALL
      SELECT d.id FROM departments d JOIN descendants parent ON d.parent_id=parent.id
    ) SELECT id FROM descendants`).all(scope) as any[]
    for (const department of rows) departmentScopes.add(department.id)
  }
  const permissions = new Set<string>()
  if (roles.length > 0) {
    const placeholders = roles.map(() => '?').join(',')
    const permissionRows = db.prepare(`SELECT feature, action FROM role_feature_permissions
      WHERE allowed=1 AND role IN (${placeholders})`).all(...roles) as any[]
    for (const permission of permissionRows) permissions.add(`${permission.feature}.${permission.action}`)
  }
  return {
    userId: row.id,
    email: row.email,
    employeeId: row.employee_id,
    employeeStatus: Number(row.employee_status),
    roles,
    assignedDepartmentScopes,
    departmentScopes: [...departmentScopes],
    permissions,
    legacyPermissions: jsonArray(row.permissions),
    isActive: true,
    authorizationVersion: Number(row.authz_version ?? 1),
  }
}

export function hasPermission(actor: AuthorizationActor, permission: string): boolean {
  return actor.permissions.has(permission)
}

export function matchesDepartmentScope(actor: AuthorizationActor, departmentId: string | null | undefined): boolean {
  if (!departmentId || actor.departmentScopes.length === 0) return false
  const placeholders = actor.departmentScopes.map(() => '?').join(',')
  return !!db.prepare(`WITH RECURSIVE ancestors(id, parent_id) AS (
      SELECT id, parent_id FROM departments WHERE id=?
      UNION ALL
      SELECT d.id, d.parent_id FROM departments d JOIN ancestors a ON d.id=a.parent_id
    ) SELECT 1 FROM ancestors WHERE id IN (${placeholders}) LIMIT 1`)
    .get(departmentId, ...actor.departmentScopes)
}
