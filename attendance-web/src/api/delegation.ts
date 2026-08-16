// ============================================================================
// API — Ủy quyền duyệt (Delegation). Quản lý cài người ủy quyền + khoảng vắng
// mặt; trong khoảng đó đơn tự chuyển sang người được ủy quyền + ghi vết "thay mặt".
// ============================================================================
import { api } from './http'
import type { Delegation, DelegationRich, DelegatableUser } from '@/types'

export const delegationApi = {
  /** Ủy quyền của tôi (tôi ủy quyền) + tôi là người được ủy quyền. */
  mine(): Promise<{ asDelegator: DelegationRich[]; asDelegate: DelegationRich[] }> {
    return api.get('/delegation')
  },
  /** Danh sách người có thể được ủy quyền (approver roles). */
  approvers(): Promise<DelegatableUser[]> { return api.get('/delegation/approvers') },
  /** Tạo ủy quyền. */
  create(payload: { delegateUserId: string; fromDate: string; toDate: string; reason?: string }): Promise<Delegation & { delegatorName: string; delegateName: string }> {
    return api.post('/delegation', payload)
  },
  /** Hủy ủy quyền (đặt is_active=0). */
  remove(id: string): Promise<{ ok: true }> { return api.del(`/delegation/${id}`) },
  /** (HR/Admin) tất cả ủy quyền trong hệ thống. */
  all(): Promise<DelegationRich[]> { return api.get('/delegation/all') },
}