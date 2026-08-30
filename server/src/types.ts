// ============================================================================
// Hằng số enum + bitmask (port từ frontend src/types/index.ts).
// Backend không cần đầy đủ interface — chỉ những hằng số dùng trong engine.
// ============================================================================
export const AttendanceIssue = {
  Late: 1 << 0,
  EarlyLeave: 1 << 1,
  MissingCheckIn: 1 << 2,
  MissingCheckOut: 1 << 3,
  CheckInOutOfWindow: 1 << 4,
  CheckOutOutOfWindow: 1 << 5,
  NoShift: 1 << 6,
  InvalidPunchOrder: 1 << 7,
  OvernightMismatch: 1 << 8,
  AmbiguousShift: 1 << 9,
  LeaveWithPunchConflict: 1 << 10,
} as const

export type RoleCode = 'Guest' | 'Employee' | 'Manager' | 'Accountant' | 'HR' | 'Director' | 'Admin'

/** Lớp lỗi HTTP统一 — map ra envelope { status, message, code }. */
export class HttpError extends Error {
  status: number
  code?: string
  fieldErrors?: Record<string, string>
  constructor(status: number, message: string, code?: string, fieldErrors?: Record<string, string>) {
    super(message)
    this.status = status
    this.code = code
    this.fieldErrors = fieldErrors
  }
}
export function httpError(status: number, message: string, code?: string): HttpError {
  return new HttpError(status, message, code)
}

/** User hiện tại (giải từ JWT). */
export interface AuthUser {
  id: string
  email: string
  employeeId: string
  roles: string[]
  permissions: string[]
  departmentScopes: string[]
  isActive?: boolean
  authorizationVersion?: number
}
