// ============================================================================
// Auth store (Zustand) — user, token, permissions. Persist token vào localStorage.
// ============================================================================
import { create } from 'zustand'
import type { User, PermissionFlag, RoleCode } from '@/types'
import { authApi } from '@/api/auth'

const TOKEN_KEY = 'hrm-token'

interface AuthState {
  user: User | null
  token: string | null
  loading: boolean
  initialized: boolean
  login: (email: string, password: string) => Promise<User>
  logout: () => Promise<void>
  bootstrap: () => Promise<void>
  hasRole: (role: RoleCode) => boolean
  hasPermission: (perm: PermissionFlag) => boolean
  setUser: (u: User | null) => void
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: localStorage.getItem(TOKEN_KEY),
  loading: false,
  initialized: false,

  async login(email, password) {
    set({ loading: true })
    try {
      const { token, user } = await authApi.login(email, password)
      localStorage.setItem(TOKEN_KEY, token)
      set({ user, token, loading: false, initialized: true })
      return user
    } catch (e) {
      set({ loading: false })
      throw e
    }
  },

  async logout() {
    try { await authApi.logout() } catch { /* ignore */ }
    localStorage.removeItem(TOKEN_KEY)
    set({ user: null, token: null })
  },

  async bootstrap() {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) { set({ initialized: true }); return }
    try {
      const user = await authApi.me()
      set({ user, token, initialized: true })
    } catch {
      localStorage.removeItem(TOKEN_KEY)
      set({ user: null, token: null, initialized: true })
    }
  },

  hasRole(role) {
    const u = get().user
    return !!u && u.roles.includes(role)
  },

  hasPermission(perm) {
    const u = get().user
    if (!u) return false
    if (u.roles.includes('Admin')) return true
    return u.permissions.includes(perm)
  },

  setUser(u) { set({ user: u }) },
}))