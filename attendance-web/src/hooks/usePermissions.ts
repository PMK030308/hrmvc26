import { useAuthStore } from '@/stores/authStore'
import type { RoleCode, PermissionFlag } from '@/types'
import { FEATURE_PERMS } from '@/constants/enums'

/**
 * Kiểm tra quyền theo catalog feature (FE ẩn UI). BE chặn API độc lập.
 * Kế thừa: Admin ← HR ← Manager ← Employee (đặc tả §2.1).
 */
export function usePermissions() {
  const user = useAuthStore((s) => s.user)

  const inherits: Record<RoleCode, RoleCode[]> = {
    Admin: ['HR', 'Manager', 'Employee'],
    HR: ['Manager', 'Employee'],
    Manager: ['Employee'],
    Employee: [],
    Accountant: [],
    Director: [],
    Guest: [],
  }
  const effectiveRoles = new Set<RoleCode>(user ? [...user.roles, ...user.roles.flatMap((r) => inherits[r] ?? [])] : [])

  function can(feature: string, perm: PermissionFlag): boolean {
    if (!user) return false
    const fp = FEATURE_PERMS.find((f) => f.feature === feature)
    if (!fp) return user.permissions.includes(perm)
    return user.roles.some((r) => fp.perms[r]?.includes(perm))
  }

  function hasPermission(permission: string): boolean {
    return user?.effectivePermissions?.includes(permission) ?? false
  }

  function hasRole(role: RoleCode): boolean {
    return effectiveRoles.has(role)
  }

  function hasAnyRole(...roles: RoleCode[]): boolean {
    return roles.some((r) => effectiveRoles.has(r))
  }

  return { can, hasPermission, hasRole, hasAnyRole, roles: user?.roles ?? [] }
}
