import type { PermissionFlag, PermissionMatrixEntry, PermissionMatrixSnapshot, RoleCode, User } from '@/types'

const MATRIX_ROLES: RoleCode[] = ['Guest', 'Employee', 'Manager', 'Accountant', 'HR', 'Director', 'Admin']

interface LegacyPermissionRow {
  feature?: unknown
  perms?: Array<{ role?: unknown; flags?: unknown }>
}

export function normalizePermissionMatrixResponse(value: unknown): PermissionMatrixSnapshot {
  if (value && !Array.isArray(value) && typeof value === 'object') {
    const snapshot = value as PermissionMatrixSnapshot
    if (Number.isFinite(snapshot.version) && Array.isArray(snapshot.permissions)) return snapshot
  }

  const permissions: PermissionMatrixEntry[] = []
  for (const item of Array.isArray(value) ? value as LegacyPermissionRow[] : []) {
    if (typeof item.feature !== 'string' || !Array.isArray(item.perms)) continue
    const flags = [...new Set(item.perms.flatMap((entry) => Array.isArray(entry.flags) ? entry.flags.filter((flag): flag is string => typeof flag === 'string') : []))]
    for (const flag of flags) {
      const roles = Object.fromEntries(MATRIX_ROLES.map((role) => [role, item.perms!.some((entry) => entry.role === role && Array.isArray(entry.flags) && entry.flags.includes(flag))])) as Record<RoleCode, boolean>
      permissions.push({
        key: `${item.feature}.${flag.toLowerCase()}`,
        module: item.feature.split('.')[0] || 'legacy',
        label: `${item.feature} · ${flag}`,
        enforced: false,
        roles,
      })
    }
  }
  return { version: 0, permissions, readOnly: true }
}

export function isLegacyAuthorizationUser(value: unknown): boolean {
  return !!value && typeof value === 'object' && !('authorizationVersion' in value)
}

export function normalizeAuthorizationUser(value: unknown): User {
  const user = value as Partial<User>
  return {
    ...user,
    id: String(user.id ?? ''),
    email: String(user.email ?? ''),
    employeeId: String(user.employeeId ?? ''),
    roles: Array.isArray(user.roles) ? user.roles : [],
    permissions: Array.isArray(user.permissions) ? user.permissions as PermissionFlag[] : [],
    departmentScopes: Array.isArray(user.departmentScopes) ? user.departmentScopes : [],
    isActive: user.isActive ?? true,
    authorizationVersion: user.authorizationVersion ?? 1,
  } as User
}

