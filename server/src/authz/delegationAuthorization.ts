import type { AuthorizationActor } from './authorizationActor.js'
import { REQUEST_PERMISSIONS } from './requestAuthorization.js'

export const DELEGATION_PERMISSIONS = {
  CREATE: 'delegation.create',
  REVOKE_OWN: 'delegation.revoke_own',
  REVOKE_ANY: 'delegation.revoke_any',
  VIEW_ALL: 'delegation.view_all',
} as const

export interface DelegationAuthorizationTarget {
  delegatorUserId: string
}

export function hasApprovalAuthority(actor: AuthorizationActor): boolean {
  return actor.permissions.has(REQUEST_PERMISSIONS.APPROVE_ASSIGNED)
    || actor.permissions.has(REQUEST_PERMISSIONS.REJECT_ASSIGNED)
}

export function canCreateDelegation(actor: AuthorizationActor): boolean {
  return actor.permissions.has(DELEGATION_PERMISSIONS.CREATE) && hasApprovalAuthority(actor)
}

export function canRevokeDelegation(actor: AuthorizationActor, target: DelegationAuthorizationTarget): boolean {
  if (actor.permissions.has(DELEGATION_PERMISSIONS.REVOKE_ANY)) return true
  return target.delegatorUserId === actor.userId && actor.permissions.has(DELEGATION_PERMISSIONS.REVOKE_OWN)
}

export function canViewAllDelegations(actor: AuthorizationActor): boolean {
  return actor.permissions.has(DELEGATION_PERMISSIONS.VIEW_ALL)
}
