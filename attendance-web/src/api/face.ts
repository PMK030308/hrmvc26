// API — Chấm công khuôn mặt (§14.3)
import { api } from './http'
import type { FaceStatus, FaceRegisterPayload, FaceAttempt, FaceVerifyPayload, PunchResponse } from '@/types'

export const faceApi = {
  status(): Promise<FaceStatus> { return api.get('/face/status') },

  register(payload: FaceRegisterPayload): Promise<{ ok: true; capturedCount: number }> {
    return api.post('/face/register', payload)
  },

  attempt(): Promise<FaceAttempt> { return api.get('/face/attempt') },

  verify(payload: FaceVerifyPayload): Promise<PunchResponse> {
    return api.post('/face/verify', payload)
  },
}