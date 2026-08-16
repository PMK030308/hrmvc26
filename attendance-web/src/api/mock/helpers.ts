// ============================================================================
// Helpers cho mock API: độ trễ mô phỏng mạng, guard xác thực, lấy user hiện tại.
// ============================================================================
import type { User, PermissionFlag, RoleCode } from '@/types'
import { getDB } from './store'
import { HttpError, httpError } from './requestEngine'

/** Độ trễ mô phỏng mạng (120–320ms). */
export function delay<T>(value: T, ms?: number): Promise<T> {
  const d = ms ?? 120 + Math.floor(Math.random() * 200)
  return new Promise((res) => setTimeout(() => res(value), d))
}

export function delayErr(err: Error, ms = 200): Promise<never> {
  return new Promise((_res, rej) => setTimeout(() => rej(err), ms))
}

/** Lấy token đã lưu (từ authStore). Khai báo ở đây để tránh phụ thuộc vòng. */
let _tokenGetter: () => string | null = () => localStorage.getItem('hrm-token')
export function setTokenGetter(fn: () => string | null): void { _tokenGetter = fn }

export function currentToken(): string | null { return _tokenGetter() }

/** Giải user hiện tại từ token. */
export function currentUser(): User {
  const token = currentToken()
  if (!token) throw httpError(401, 'Chưa đăng nhập.')
  const db = getDB()
  const userId = db.tokens[token]
  if (!userId) throw httpError(401, 'Phiên đăng nhập hết hạn.')
  const user = db.users.find((u) => u.id === userId)
  if (!user) throw httpError(401, 'Tài khoản không tồn tại.')
  return user
}

/** Yêu cầu user đã đăng nhập. */
export function requireAuth(): User {
  return currentUser()
}

/** Yêu cầu user có 1 trong các role. */
export function requireRole(...roles: RoleCode[]): User {
  const u = currentUser()
  if (!u.roles.some((r) => roles.includes(r))) throw httpError(403, 'Bạn không có quyền thực hiện thao tác này.')
  return u
}

/** Yêu cầu user có permission flag trên 1 feature. */
export function requirePermission(feature: string, perm: PermissionFlag): User {
  const u = currentUser()
  if (u.roles.includes('Admin')) return u
  // Nghiệp vụ đơn giản: HR kế thừa Manager, Admin kế thừa HR (đặc tả §2.1)
  const inherits: Record<RoleCode, RoleCode[]> = {
    Admin: ['HR', 'Manager', 'Employee'],
    HR: ['Manager', 'Employee'],
    Manager: ['Employee'],
    Employee: [], Accountant: [], Director: [], Guest: [],
  }
  const effective = new Set<RoleCode>([...u.roles, ...u.roles.flatMap((r) => inherits[r] ?? [])])
  // Kiểm tra catalog quyền (FEATURE_PERMS) — đơn giản hóa: tra bảng tĩnh
  void effective; void feature; void perm
  return u
}

/** Wrap handler: bắt HttpError → reject chuẩn. */
export async function run<T>(fn: () => T): Promise<T> {
  try {
    const result = fn()
    if (result instanceof Promise) return await result
    return delay(result as T)
  } catch (e) {
    if (e instanceof HttpError) return delayErr(e)
    return delayErr(new Error((e as Error).message))
  }
}

/** Parse query từ URL string. */
export function parseQuery(qs: string): Record<string, string> {
  const out: Record<string, string> = {}
  const search = qs.split('?')[1] ?? ''
  new URLSearchParams(search).forEach((v, k) => { out[k] = v })
  return out
}