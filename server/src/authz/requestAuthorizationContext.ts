import { db } from '../db.js'
import { ymd, nowVn } from '../lib/date.js'
import { httpError } from '../types.js'
import { loadAuthorizationActor } from './authorizationActor.js'
import {
  canViewRequest,
  type AuthorizationApproval,
  type RequestActor,
  type RequestAuthorizationContext,
} from './requestAuthorization.js'

function mapApproval(row: any): AuthorizationApproval {
  return {
    level: row.level,
    status: row.status,
    approverUserId: row.approver_user_id ?? null,
    onBehalfOfUserId: row.on_behalf_of_user_id ?? null,
  }
}

export function loadRequestActor(userId: string): RequestActor {
  const user = loadAuthorizationActor(userId)
  return {
    userId: user.userId,
    employeeId: user.employeeId,
    roles: user.roles,
    departmentScopes: user.departmentScopes,
    permissions: user.permissions,
  }
}

export function loadRequestAuthorizationContext(type: string, requestId: string): RequestAuthorizationContext | null {
  const requestRow = db.prepare(`SELECT r.*, e.department_id
    FROM requests r JOIN employees e ON e.id=r.employee_id
    WHERE r.id=? AND r.type=?`).get(requestId, type) as any
  if (!requestRow) return null

  const approvalRows = db.prepare('SELECT * FROM request_approvals WHERE request_id=? ORDER BY level ASC').all(requestId) as any[]
  const approvals = approvalRows.map(mapApproval)
  const currentRow = approvalRows.find((row) => row.level === requestRow.current_level && row.status === 2) ?? null
  let delegationActive = false
  if (currentRow?.on_behalf_of_user_id && currentRow?.approver_user_id) {
    const today = ymd(nowVn())
    delegationActive = !!db.prepare(`SELECT 1 FROM delegations
      WHERE delegator_user_id=? AND delegate_user_id=? AND is_active=1
        AND ? >= from_date AND ? <= to_date LIMIT 1`)
      .get(currentRow.on_behalf_of_user_id, currentRow.approver_user_id, today, today)
  }

  return {
    request: {
      id: requestRow.id,
      type: requestRow.type,
      employeeId: requestRow.employee_id,
      departmentId: requestRow.department_id ?? null,
      status: requestRow.status,
      requestVersion: requestRow.request_version,
      currentLevel: requestRow.current_level,
      suggestedSwapPartnerId: requestRow.suggested_swap_partner_id ?? null,
      swapPartnerStatus: requestRow.swap_partner_status ?? 0,
    },
    approvals,
    currentApproval: currentRow ? mapApproval(currentRow) : null,
    delegationActive,
  }
}

export function requireViewableRequest(actor: RequestActor, type: string, requestId: string): RequestAuthorizationContext {
  const context = loadRequestAuthorizationContext(type, requestId)
  if (!context || !canViewRequest(actor, context)) throw httpError(404, 'Không tìm thấy đơn.')
  return context
}

export function assertViewableActionTarget(actor: RequestActor, context: RequestAuthorizationContext): void {
  if (!canViewRequest(actor, context)) throw httpError(404, 'Không tìm thấy đơn.')
}

export function assertAuthorizedAction(actor: RequestActor, context: RequestAuthorizationContext, allowed: boolean): void {
  assertViewableActionTarget(actor, context)
  if (!allowed) throw httpError(403, 'Bạn không có quyền thực hiện thao tác này.')
}
