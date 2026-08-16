// ============================================================================
// API — Đơn từ + duyệt (§14.5 / §14.6) — HTTP.
// ============================================================================
import { api } from './http'
import type {
  RequestType, AnyRequest, RequestCatalog, RequestAttachment, ShiftSchedule, Shift,
} from '@/types'

export const requestsApi = {
  mine(): Promise<{ mine: AnyRequest[]; pending: AnyRequest[] }> {
    return api.get('/requests/mine')
  },

  catalog(): Promise<RequestCatalog> { return api.get('/requests/catalog') },

  list(type: RequestType): Promise<AnyRequest[]> { return api.get(`/requests/${type}`) },

  detail(type: RequestType, id: string): Promise<AnyRequest> { return api.get(`/requests/${type}/${id}`) },

  create(type: RequestType, payload: any): Promise<AnyRequest> {
    return api.post(`/requests/${type}`, payload)
  },

  update(type: RequestType, id: string, payload: any, expectedVersion: number): Promise<AnyRequest> {
    return api.put(`/requests/${type}/${id}`, { ...payload, expectedVersion })
  },

  cancel(type: RequestType, id: string, expectedVersion: number): Promise<AnyRequest> {
    return api.post(`/requests/${type}/${id}/cancel`, { expectedVersion })
  },

  timeline(type: RequestType, id: string): Promise<AnyRequest['approvals']> {
    return api.get(`/requests/${type}/${id}/timeline`)
  },

  attachments(type: RequestType, id: string): Promise<RequestAttachment[]> {
    return api.get(`/requests/${type}/${id}/attachments`)
  },

  uploadAttachment(type: RequestType, id: string, file: { fileName: string; fileSize: number; mimeType: string; dataUrl: string }): Promise<RequestAttachment> {
    return api.post(`/requests/${type}/${id}/attachments`, file)
  },

  deleteAttachment(attachmentId: string): Promise<{ ok: true }> {
    return api.del(`/requests/attachments/${attachmentId}`)
  },

  myShiftOnDate(date: string): Promise<{ shift: Shift | null; schedule: ShiftSchedule | null }> {
    return api.get(`/requests/my-shift/${date}`)
  },

  partnerShift(partnerEmployeeId: string, date: string): Promise<{ shift: Shift | null }> {
    return api.get(`/requests/partner-shift/${partnerEmployeeId}/${date}`)
  },

  partnerResponse(id: string, accepted: boolean, rejectionReason: string | null, expectedVersion: number): Promise<AnyRequest> {
    return api.post(`/requests/shift-swaps/${id}/partner-response`, { accepted, rejectionReason, expectedVersion })
  },
}

export const approvalsApi = {
  list(): Promise<AnyRequest[]> { return api.get('/approvals') },

  approve(type: RequestType, id: string, comment: string, expectedVersion: number): Promise<AnyRequest> {
    return api.post(`/approvals/${type}/${id}/approve`, { comment, expectedVersion })
  },

  reject(type: RequestType, id: string, comment: string, expectedVersion: number): Promise<AnyRequest> {
    return api.post(`/approvals/${type}/${id}/reject`, { comment, expectedVersion })
  },
}