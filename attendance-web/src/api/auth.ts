// ============================================================================
// API — Auth (§14.1) — gọi backend thật qua HTTP.
// ============================================================================
import { api } from './http'
import type { AuthResult, User } from '@/types'

export const authApi = {
  login(email: string, password: string): Promise<AuthResult> {
    return api.post<AuthResult>('/auth/login', { email, password })
  },

  logout(): Promise<{ ok: true }> {
    return api.post('/auth/logout')
  },

  me(): Promise<User> {
    return api.get<User>('/auth/me')
  },

  forgotPassword(email: string): Promise<{ ok: true; message: string }> {
    return api.post('/auth/forgot-password', { email })
  },
}