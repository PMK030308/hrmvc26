import type { RoleCode } from '@/types'

const LEGACY_ADMIN_ONLY_PERMISSIONS = new Set([
  'config.permission.manage',
  'config.user.manage',
  'audit.view',
])

const LEGACY_PERMISSION_ROLES: Partial<Record<string, readonly RoleCode[]>> = {
  'delegation.create': ['Manager', 'HR', 'Director', 'Accountant', 'Admin'],
}

export function allowsUiPermission(
  effectivePermissions: readonly string[] | null | undefined,
  permission: string,
  roles: readonly RoleCode[] = [],
): boolean {
  if (Array.isArray(effectivePermissions)) return effectivePermissions.includes(permission)
  const allowedRoles = LEGACY_PERMISSION_ROLES[permission]
  if (allowedRoles) return roles.some((role) => allowedRoles.includes(role))
  return roles.includes('Admin') || !LEGACY_ADMIN_ONLY_PERMISSIONS.has(permission)
}

export function allowsAnyUiPermission(
  effectivePermissions: readonly string[] | null | undefined,
  permissions: readonly string[],
  roles: readonly RoleCode[] = [],
): boolean {
  return permissions.some((permission) => allowsUiPermission(effectivePermissions, permission, roles))
}
