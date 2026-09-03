// ============================================================================
// API — Cấu hình & quy định (§11) + Role/permission (§11.3) + Profile (§9) — HTTP.
// ============================================================================
import { api } from './http'
import type { AttendanceRegulation, LeaveType, User, Employee, EmployeeProfile, RoleCode, PermissionFlag } from '@/types'

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
  matrix(): Promise<{ feature: string; perms: { role: RoleCode; flags: PermissionFlag[] }[] }[]> {
    return api.get('/config/roles/matrix')
  },
  users(): Promise<User[]> { return api.get('/config/roles/users') },
  updateUserRoles(userId: string, roles: RoleCode[]): Promise<User> {
    return api.put(`/config/roles/users/${userId}`, roles)
  },
  createUser(payload: { email: string; employeeId: string; roles: RoleCode[] }): Promise<User> {
    return api.post('/config/roles/users', payload)
  },
}

export const profileApi = {
  get(): Promise<EmployeeProfile> { return api.get('/config/profile') },
  update(payload: Partial<Employee>): Promise<EmployeeProfile> { return api.put('/config/profile', payload) },
}
