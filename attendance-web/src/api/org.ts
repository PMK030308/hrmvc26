// ============================================================================
// API — Quản lý nhân viên / phòng ban / vị trí (Admin/HR) — HTTP.
// ============================================================================
import { api } from './http'
import type { Employee, Department, Position, Branch } from '@/types'

export const orgApi = {
  branches(): Promise<Branch[]> { return api.get('/org/branches') },
  departments(): Promise<Department[]> { return api.get('/org/departments') },
  positions(): Promise<Position[]> { return api.get('/org/positions') },

  employees(params?: { departmentId?: string; search?: string }): Promise<Employee[]> {
    return api.get('/org/employees', params)
  },

  employee(id: string): Promise<Employee> { return api.get(`/org/employees/${id}`) },

  createEmployee(payload: Partial<Employee>): Promise<Employee> {
    return api.post('/org/employees', payload)
  },

  updateEmployee(id: string, payload: Partial<Employee>): Promise<Employee> {
    return api.put(`/org/employees/${id}`, payload)
  },

  deleteEmployee(id: string): Promise<{ ok: true }> {
    return api.del(`/org/employees/${id}`)
  },

  resetDemo(): Promise<{ ok: true }> {
    return api.post('/org/reset-demo')
  },
}