// ============================================================================
// HTTP client (axios) — gọi backend thật tại /api (proxy Vite → :4000).
// Thay thế mock `run()`. Giữ shape lỗi: ApiError kế thừa Error (e.message dùng được).
// ============================================================================
import axios, { type InternalAxiosRequestConfig } from 'axios'
import { resolveApiBase } from '@/lib/runtimeConfig'

const TOKEN_KEY = 'hrm-token'
const REFRESH_TOKEN_KEY = 'hrm-refresh-token'

/** Lỗi API — kế thừa Error để các catch (e) => toast.error(e.message) hoạt động y nguyên. */
export class ApiError extends Error {
  status: number
  code?: string
  fieldErrors?: Record<string, string>
  details?: unknown
  constructor(status: number, message: string, code?: string, fieldErrors?: Record<string, string>, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fieldErrors = fieldErrors
    this.details = details
  }
}

// Chuẩn hoá baseURL: luôn đảm bảo kết thúc bằng '/api'.
//   - '/api'                              → '/api'        (dev, dùng Vite proxy)
//   - 'https://...onrender.com'           → '.../api'     (env set thiếu /api)
//   - 'https://...onrender.com/api'        → '.../api'     (env set đúng)
//   - 'https://...onrender.com/api/'       → '.../api'     (có dấu / cuối)
const API_BASE = resolveApiBase(import.meta.env.VITE_API_URL, import.meta.env.PROD)

export const http = axios.create({
  // Dev: '/api' → Vite proxy → backend :4000 (xem vite.config.ts).
  // Production: ưu tiên env VITE_API_URL; nếu chưa set thì dùng backend Render thật.
  //   (Vite proxy KHÔNG chạy ở bản build tĩnh, nên '/api' sẽ 404 → phải có URL thật.)
  baseURL: API_BASE,
  timeout: 30_000,
})

let refreshPromise: Promise<string> | null = null

async function refreshAccessToken(): Promise<string> {
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY)
  if (!refreshToken) throw new Error('Missing refresh token')
  const response = await axios.post<{ token: string; refreshToken: string }>(
    `${API_BASE}/auth/refresh`, { refreshToken }, { timeout: 30_000 },
  )
  localStorage.setItem(TOKEN_KEY, response.data.token)
  localStorage.setItem(REFRESH_TOKEN_KEY, response.data.refreshToken)
  return response.data.token
}

// Gắn token
http.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Map lỗi → ApiError
http.interceptors.response.use(
  (resp) => resp,
  async (error) => {
    if (error.response) {
      const { status, data } = error.response
      const message = data?.message ?? `Lỗi ${status}`
      const request = error.config as (InternalAxiosRequestConfig & { _sessionRefreshAttempted?: boolean }) | undefined
      if (status === 401 && request && !request._sessionRefreshAttempted && !String(request.url).includes('/auth/refresh')) {
        request._sessionRefreshAttempted = true
        try {
          refreshPromise ??= refreshAccessToken().finally(() => { refreshPromise = null })
          const token = await refreshPromise
          request.headers.Authorization = `Bearer ${token}`
          return http.request(request)
        } catch { /* clear the invalid session below */ }
      }
      if (status === 401) {
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(REFRESH_TOKEN_KEY)
      }
      return Promise.reject(new ApiError(status, message, data?.code, data?.fieldErrors, data))
    }
    // Lỗi mạng / timeout
    return Promise.reject(new ApiError(0, error.message ?? 'Không kết nối được đến máy chủ.'))
  },
)

/** Helper POST/PUT mặc định trả data; GET trả data. */
export const api = {
  get: <T = any>(url: string, params?: Record<string, any>) => http.get<T>(url, { params }).then((r) => r.data),
  post: <T = any>(url: string, body?: any) => http.post<T>(url, body).then((r) => r.data),
  put: <T = any>(url: string, body?: any) => http.put<T>(url, body).then((r) => r.data),
  del: <T = any>(url: string) => http.delete<T>(url).then((r) => r.data),
}
