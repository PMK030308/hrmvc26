import type { PermissionMatrixEntry, RequestPermission, RequestPermissionMatrixRow, RoleCode } from '@/types'

export function toggleRequestPermission(
  matrix: RequestPermissionMatrixRow[],
  permission: RequestPermission,
  role: RoleCode,
): RequestPermissionMatrixRow[] {
  return matrix.map((row) => row.permission === permission
    ? { ...row, roles: { ...row.roles, [role]: !row.roles[role] } }
    : row)
}

export function togglePermission(
  matrix: PermissionMatrixEntry[],
  permission: string,
  role: RoleCode,
): PermissionMatrixEntry[] {
  return matrix.map((row) => row.key === permission && row.enforced
    ? { ...row, roles: { ...row.roles, [role]: !row.roles[role] } }
    : row)
}
