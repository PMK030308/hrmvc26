// ============================================================================
// HTTP client (axios) — gọi backend thật tại /api (proxy Vite → :4000).
// Thay thế mock `run()`. Giữ shape lỗi: ApiError kế thừa Error (e.message dùng được).
// ============================================================================
import axios from 'axios'

const TOKEN_KEY = 'hrm-token'

/** Lỗi API — kế thừa Error để các catch (e) => toast.error(e.message) hoạt động y nguyên. */
export class ApiError extends Error {
  status: number
  code?: string
  fieldErrors?: Record<string, string>
  constructor(status: number, message: string, code?: string, fieldErrors?: Record<string, string>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fieldErrors = fieldErrors
  }
}

export const http = axios.create({
  // Dev: '/api' → Vite proxy → backend :4000 (xem vite.config.ts).
  // Production (Vercel): đặt env VITE_API_URL = https://<backend-cua-ban>/api
  //   để frontend gọi thẳng backend thật (proxy Vite không chạy ở bản build).
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
  timeout: 30_000,
})

// Gắn token
http.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Map lỗi → ApiError
http.interceptors.response.use(
  (resp) => resp,
  (error) => {
    if (error.response) {
      const { status, data } = error.response
      const message = data?.message ?? `Lỗi ${status}`
      // 401 → xoá token để authStore bootstrap đăng xuất
      if (status === 401) localStorage.removeItem(TOKEN_KEY)
      return Promise.reject(new ApiError(status, message, data?.code, data?.fieldErrors))
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