// ============================================================================
// API — Quản lý nhân viên / phòng ban / vị trí (Admin/HR) — HTTP.
// ============================================================================
import { api, ApiError, http } from './http'
import type { Employee, EmployeeProjection, Department, Position, Branch } from '@/types'

export interface EmployeeImportError {
  row: number
  field: string
  message: string
}

export interface EmployeeImportResult {
  totalRows: number
  importedCount: number
  errors: EmployeeImportError[]
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export const orgApi = {
  branches(): Promise<Branch[]> { return api.get('/org/branches') },
  departments(): Promise<Department[]> { return api.get('/org/departments') },
  positions(): Promise<Position[]> { return api.get('/org/positions') },

  employees(params?: { departmentId?: string; search?: string }): Promise<EmployeeProjection[]> {
    return api.get('/org/employees', params)
  },

  employee(id: string): Promise<EmployeeProjection> { return api.get(`/org/employees/${id}`) },

  createEmployee(payload: Partial<Employee>): Promise<EmployeeProjection> {
    return api.post('/org/employees', payload)
  },

  updateEmployee(id: string, payload: Partial<Employee>): Promise<EmployeeProjection> {
    return api.put(`/org/employees/${id}`, payload)
  },

  deactivateEmployee(id: string): Promise<{ ok: true }> {
    return api.del(`/org/employees/${id}`)
  },

  async downloadEmployeeTemplate(): Promise<void> {
    const response = await http.get<Blob>('/org/employees/import-template', { responseType: 'blob' })
    saveBlob(response.data, 'mau-nhap-nhan-vien.xlsx')
  },

  async exportEmployees(): Promise<void> {
    const response = await http.get<Blob>('/org/employees/export-excel', { responseType: 'blob' })
    saveBlob(response.data, `danh-sach-nhan-vien-${new Date().toISOString().slice(0, 10)}.xlsx`)
  },

  async importEmployees(file: File): Promise<EmployeeImportResult> {
    try {
      const response = await http.post<EmployeeImportResult>('/org/employees/import-excel', file, {
        headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      })
      return response.data
    } catch (error) {
      if (error instanceof ApiError && error.status === 422 && error.details) return error.details as EmployeeImportResult
      throw error
    }
  },

  resetDemo(): Promise<{ ok: true }> {
    return api.post('/org/reset-demo', { confirmation: 'RESET_DEMO_DATA' })
  },
}
