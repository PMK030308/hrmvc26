import { httpError } from '../types.js'
import { hasPermission, type AuthorizationActor } from './authorizationActor.js'

export function assertResourceVisible(visible: boolean, message = 'Không tìm thấy dữ liệu.'): void {
  if (!visible) throw httpError(404, message)
}

export function assertActionAllowed(allowed: boolean, message = 'Bạn không có quyền thực hiện thao tác này.'): void {
  if (!allowed) throw httpError(403, message)
}

export function assertActorPermission(actor: AuthorizationActor, permission: string): void {
  assertActionAllowed(hasPermission(actor, permission))
}
