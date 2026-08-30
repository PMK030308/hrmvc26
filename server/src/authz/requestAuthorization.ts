import type { RoleCode } from '../types.js'

export const REQUEST_PERMISSIONS = {
  CREATE_OWN: 'requests.request.create_own',
  VIEW_OWN: 'requests.request.view_own',
  VIEW_RELATED: 'requests.request.view_related',
  VIEW_SCOPED: 'requests.request.view_scoped',
  VIEW_ALL: 'requests.request.view_all',
  MODIFY_OWN: 'requests.request.modify_own',
  CANCEL_OWN: 'requests.request.cancel_own',
  APPROVE_ASSIGNED: 'requests.approval.approve_assigned',
  REJECT_ASSIGNED: 'requests.approval.reject_assigned',
  ATTACHMENT_READ: 'requests.attachment.read_related',
  ATTACHMENT_UPLOAD_OWN: 'requests.attachment.upload_own',
  ATTACHMENT_UPLOAD_RELATED: 'requests.attachment.upload_related',
  ATTACHMENT_DELETE_OWN: 'requests.attachment.delete_own',
  SHIFT_SWAP_RESPOND: 'requests.shift_swap.respond_as_partner',
} as const

export type RequestPermission = typeof REQUEST_PERMISSIONS[keyof typeof REQUEST_PERMISSIONS]
export type AttachmentAction = 'read' | 'upload' | 'delete'

export interface RequestActor {
  userId: string
  employeeId: string
  roles: RoleCode[]
  departmentScopes: string[]
  permissions: Set<string>
}

export interface AuthorizationRequest {
  id: string
  type: string
  employeeId: string
  departmentId: string | null
  status: number
  requestVersion: number
  currentLevel: number
  suggestedSwapPartnerId: string | null
  swapPartnerStatus: number
}

export interface AuthorizationApproval {
  level: number
  status: number
  approverUserId: string | null
  onBehalfOfUserId: string | null
}

export interface RequestAuthorizationContext {
  request: AuthorizationRequest
  approvals: AuthorizationApproval[]
  currentApproval: AuthorizationApproval | null
  delegationActive: boolean
}

function has(actor: RequestActor, permission: RequestPermission): boolean {
  return actor.permissions.has(permission)
}

function isOwner(actor: RequestActor, context: RequestAuthorizationContext): boolean {
  return actor.employeeId === context.request.employeeId
}

function isRelatedApprover(actor: RequestActor, context: RequestAuthorizationContext): boolean {
  return context.approvals.some((approval) =>
    approval.approverUserId === actor.userId || approval.onBehalfOfUserId === actor.userId,
  )
}

function isCurrentStepActor(actor: RequestActor, context: RequestAuthorizationContext): boolean {
  const approval = context.currentApproval
  if (!approval || approval.status !== 2 || approval.level !== context.request.currentLevel) return false
  if (!approval.onBehalfOfUserId) return approval.approverUserId === actor.userId
  return context.delegationActive
    ? approval.approverUserId === actor.userId
    : approval.onBehalfOfUserId === actor.userId
}

export function canViewRequest(actor: RequestActor, context: RequestAuthorizationContext): boolean {
  if (isOwner(actor, context) && has(actor, REQUEST_PERMISSIONS.VIEW_OWN)) return true
  if (isRelatedApprover(actor, context) && has(actor, REQUEST_PERMISSIONS.VIEW_RELATED)) return true
  if (context.request.suggestedSwapPartnerId === actor.employeeId && has(actor, REQUEST_PERMISSIONS.VIEW_RELATED)) return true
  if (context.request.departmentId && actor.departmentScopes.includes(context.request.departmentId) && has(actor, REQUEST_PERMISSIONS.VIEW_SCOPED)) return true
  return has(actor, REQUEST_PERMISSIONS.VIEW_ALL)
}

export function canModifyRequest(actor: RequestActor, context: RequestAuthorizationContext): boolean {
  if (!isOwner(actor, context) || !has(actor, REQUEST_PERMISSIONS.MODIFY_OWN)) return false
  if (context.approvals.length > 0) return false
  return context.request.status === 1 || context.request.status === 2 || context.request.status === 6
}

export function canCancelRequest(actor: RequestActor, context: RequestAuthorizationContext): boolean {
  if (!isOwner(actor, context) || !has(actor, REQUEST_PERMISSIONS.CANCEL_OWN)) return false
  return [1, 2, 6, 8, 9].includes(context.request.status)
}

export function canApproveCurrentStep(actor: RequestActor, context: RequestAuthorizationContext, action: 'approve' | 'reject' = 'approve'): boolean {
  const permission = action === 'approve' ? REQUEST_PERMISSIONS.APPROVE_ASSIGNED : REQUEST_PERMISSIONS.REJECT_ASSIGNED
  if (!has(actor, permission)) return false
  if (context.request.status !== 2 && context.request.status !== 8) return false
  return isCurrentStepActor(actor, context)
}

export function canManageRequestAttachment(actor: RequestActor, context: RequestAuthorizationContext, action: AttachmentAction): boolean {
  if (action === 'read') return canViewRequest(actor, context) && has(actor, REQUEST_PERMISSIONS.ATTACHMENT_READ)
  if (action === 'upload') {
    if (isOwner(actor, context)) return has(actor, REQUEST_PERMISSIONS.ATTACHMENT_UPLOAD_OWN) && canModifyRequest(actor, context)
    return has(actor, REQUEST_PERMISSIONS.ATTACHMENT_UPLOAD_RELATED) && isCurrentStepActor(actor, context)
  }
  return isOwner(actor, context) && has(actor, REQUEST_PERMISSIONS.ATTACHMENT_DELETE_OWN) && canModifyRequest(actor, context)
}

export function canRespondToShiftSwap(actor: RequestActor, context: RequestAuthorizationContext): boolean {
  return has(actor, REQUEST_PERMISSIONS.SHIFT_SWAP_RESPOND)
    && context.request.type === 'shift-swaps'
    && context.request.status === 6
    && context.request.swapPartnerStatus === 1
    && context.request.suggestedSwapPartnerId === actor.employeeId
}
