// ============================================================================
// API — Cấu hình & quy định (§11) + Role/permission (§11.3) + Profile (§9) — HTTP.
// ============================================================================
import { api, downloadFile } from './http'
import type { AttendanceRegulation, LeaveType, User, Employee, EmployeeProfile, RoleCode, PermissionMatrixSnapshot } from '@/types'
import { isLegacyAuthorizationUser, normalizeAuthorizationUser, normalizePermissionMatrixResponse } from '@/lib/authorizationApiCompatibility'

let legacyAuthorizationApi = false

export const regulationsApi = {
  attendance(): Promise<AttendanceRegulation> { return api.get('/config/regulations/attendance') },
  updateAttendance(payload: Partial<AttendanceRegulation>): Promise<AttendanceRegulation> {
    return api.put('/config/regulations/attendance', payload)
  },
  leaveTypes(): Promise<LeaveType[]> { return api.get('/config/leave-types') },
  updateLeaveType(id: string, payload: Partial<LeaveType>): Promise<LeaveType> {
    return api.put(`/config/leave-types/${id}`, payload)
  },
}

export const rolesApi = {
  async matrix(): Promise<PermissionMatrixSnapshot> {
    const response = await api.get<unknown>('/config/roles/matrix')
    legacyAuthorizationApi = Array.isArray(response)
    return normalizePermissionMatrixResponse(response)
  },
  updateMatrix(expectedVersion: number, permissions: PermissionMatrixSnapshot['permissions']): Promise<PermissionMatrixSnapshot> {
    if (legacyAuthorizationApi) return Promise.reject(new Error('Backend hiện tại chỉ hỗ trợ xem ma trận quyền.'))
    return api.put('/config/roles/matrix', { expectedVersion, permissions })
  },
  async users(): Promise<User[]> {
    const response = await api.get<unknown[]>('/config/roles/users')
    legacyAuthorizationApi ||= response.some(isLegacyAuthorizationUser)
    return response.map(normalizeAuthorizationUser)
  },
  async updateUserAuthorization(userId: string, payload: Pick<User, 'roles' | 'isActive' | 'departmentScopes' | 'authorizationVersion'>): Promise<User> {
    const body = legacyAuthorizationApi ? payload.roles : { ...payload, expectedVersion: payload.authorizationVersion }
    return normalizeAuthorizationUser(await api.put(`/config/roles/users/${userId}`, body))
  },
  async createUser(payload: { email: string; employeeId: string; roles: RoleCode[] }): Promise<User> {
    return normalizeAuthorizationUser(await api.post('/config/roles/users', payload))
  },
  exportExcel(): Promise<void> { return downloadFile('/config/roles/export-excel', 'tai-khoan-phan-quyen.xlsx') },
}

export const profileApi = {
  get(): Promise<EmployeeProfile> { return api.get('/config/profile') },
  update(payload: Partial<Employee>): Promise<EmployeeProfile> { return api.put('/config/profile', payload) },
}
