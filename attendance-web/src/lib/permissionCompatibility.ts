import type { RoleCode } from '@/types'

const LEGACY_ADMIN_ONLY_PERMISSIONS = new Set([
  'config.permission.manage',
  'config.user.manage',
  'audit.view',
])

export function allowsUiPermission(
  effectivePermissions: readonly string[] | null | undefined,
  permission: string,
  roles: readonly RoleCode[] = [],
): boolean {
  if (Array.isArray(effectivePermissions)) return effectivePermissions.includes(permission)
  return roles.includes('Admin') || !LEGACY_ADMIN_ONLY_PERMISSIONS.has(permission)
}

export function allowsAnyUiPermission(
  effectivePermissions: readonly string[] | null | undefined,
  permissions: readonly string[],
  roles: readonly RoleCode[] = [],
): boolean {
  return permissions.some((permission) => allowsUiPermission(effectivePermissions, permission, roles))
}

