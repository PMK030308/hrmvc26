export function organizationCapabilities(effectivePermissions: readonly string[]) {
  const permissions = new Set(effectivePermissions)
  return {
    canViewCatalog: permissions.has('org.catalog.view'),
    canViewEmployees: permissions.has('org.employee.view_scoped') || permissions.has('org.employee.view_all'),
    canManageEmployees: permissions.has('org.employee.manage_scoped') || permissions.has('org.employee.manage_all'),
    canViewPrivate: permissions.has('org.employee.view_private'),
    canViewCompensation: permissions.has('org.employee.view_compensation'),
    canCreateDelegation: permissions.has('delegation.create'),
    canRevokeOwnDelegation: permissions.has('delegation.revoke_own'),
    canRevokeAnyDelegation: permissions.has('delegation.revoke_any'),
    canViewAllDelegations: permissions.has('delegation.view_all'),
    canViewRegulations: permissions.has('config.regulation.view'),
    canManageRegulations: permissions.has('config.regulation.manage'),
    canViewLeaveTypes: permissions.has('config.leave_type.view'),
    canManageLeaveTypes: permissions.has('config.leave_type.manage'),
    canViewAudit: permissions.has('audit.view'),
    canResetDemo: permissions.has('system.demo_reset'),
  }
}
