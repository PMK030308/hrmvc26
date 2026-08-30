import { type ReactNode, useEffect } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { homeForRoles } from '@/components/layout/nav'
import type { RoleCode } from '@/types'
import { Spinner } from '@/components/ui'

/** Yêu cầu đã đăng nhập; khởi tạo auth từ token. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const initialized = useAuthStore((s) => s.initialized)
  const user = useAuthStore((s) => s.user)
  const bootstrap = useAuthStore((s) => s.bootstrap)
  const location = useLocation()

  useEffect(() => { if (!initialized) bootstrap() }, [initialized, bootstrap])

  if (!initialized) {
    return <div className="grid min-h-screen place-items-center"><Spinner className="h-8 w-8" /></div>
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }
  return <>{children}</>
}

/** Yêu cầu có 1 trong các role. */
export function RequireRole({ roles, children }: { roles: RoleCode[]; children: ReactNode }) {
  const user = useAuthStore((s) => s.user)!
  if (!user.roles.some((r) => roles.includes(r))) {
    return <Navigate to={homeForRoles(user.roles)} replace />
  }
  return <>{children}</>
}

/** Guest-only (login page): nếu đã đăng nhập → redirect theo role. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const initialized = useAuthStore((s) => s.initialized)
  const user = useAuthStore((s) => s.user)
  const bootstrap = useAuthStore((s) => s.bootstrap)
  useEffect(() => { if (!initialized) bootstrap() }, [initialized, bootstrap])
  if (!initialized) return <div className="grid min-h-screen place-items-center"><Spinner className="h-8 w-8" /></div>
  if (user) return <Navigate to={homeForRoles(user.roles)} replace />
  return <>{children}</>
}

/** Presentation guard theo capability DB-fresh; backend vẫn là nơi quyết định quyền. */
export function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const user = useAuthStore((s) => s.user)!
  if (!user.effectivePermissions?.includes(permission)) {
    return <Navigate to={homeForRoles(user.roles)} replace />
  }
  return <>{children}</>
}
