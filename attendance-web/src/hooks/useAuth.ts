import { useAuthStore } from '@/stores/authStore'

/** Hook tiện ích truy cập auth + permission/role checks. */
export function useAuth() {
  const store = useAuthStore()
  return {
    user: store.user,
    token: store.token,
    initialized: store.initialized,
    loading: store.loading,
    isAuthed: !!store.user,
    hasRole: store.hasRole,
    hasPermission: store.hasPermission,
    logout: store.logout,
  }
}