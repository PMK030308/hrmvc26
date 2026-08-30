import type { RoleCode } from '../types.js'
import { REQUEST_PERMISSIONS } from './requestAuthorization.js'

export interface PermissionDefinition {
  key: string
  module: string
  label: string
  enforced: boolean
  defaultRoles: readonly RoleCode[]
}

const employee = ['Employee', 'Manager', 'Accountant', 'HR', 'Director', 'Admin'] as const
const approver = ['Manager', 'Accountant', 'HR', 'Director', 'Admin'] as const

export const PERMISSION_CATALOG: readonly PermissionDefinition[] = [
  { key: REQUEST_PERMISSIONS.CREATE_OWN, module: 'requests', label: 'Tạo đơn của chính mình', enforced: true, defaultRoles: employee },
  { key: REQUEST_PERMISSIONS.VIEW_OWN, module: 'requests', label: 'Xem đơn của chính mình', enforced: true, defaultRoles: employee },
  { key: REQUEST_PERMISSIONS.VIEW_RELATED, module: 'requests', label: 'Xem đơn có liên quan', enforced: true, defaultRoles: employee },
  { key: REQUEST_PERMISSIONS.VIEW_SCOPED, module: 'requests', label: 'Xem đơn trong phòng ban được phân scope', enforced: true, defaultRoles: ['HR'] },
  { key: REQUEST_PERMISSIONS.VIEW_ALL, module: 'requests', label: 'Xem toàn bộ đơn', enforced: true, defaultRoles: ['Admin'] },
  { key: REQUEST_PERMISSIONS.MODIFY_OWN, module: 'requests', label: 'Sửa đơn của chính mình', enforced: true, defaultRoles: employee },
  { key: REQUEST_PERMISSIONS.CANCEL_OWN, module: 'requests', label: 'Hủy đơn của chính mình', enforced: true, defaultRoles: employee },
  { key: REQUEST_PERMISSIONS.APPROVE_ASSIGNED, module: 'requests', label: 'Duyệt bước được giao', enforced: true, defaultRoles: approver },
  { key: REQUEST_PERMISSIONS.REJECT_ASSIGNED, module: 'requests', label: 'Từ chối bước được giao', enforced: true, defaultRoles: approver },
  { key: REQUEST_PERMISSIONS.ATTACHMENT_READ, module: 'requests', label: 'Xem và tải tệp của đơn liên quan', enforced: true, defaultRoles: employee },
  { key: REQUEST_PERMISSIONS.ATTACHMENT_UPLOAD_OWN, module: 'requests', label: 'Tải tệp lên đơn của chính mình', enforced: true, defaultRoles: employee },
  { key: REQUEST_PERMISSIONS.ATTACHMENT_UPLOAD_RELATED, module: 'requests', label: 'Tải tệp lên đơn đang duyệt', enforced: true, defaultRoles: approver },
  { key: REQUEST_PERMISSIONS.ATTACHMENT_DELETE_OWN, module: 'requests', label: 'Xóa tệp ở đơn của chính mình', enforced: true, defaultRoles: employee },
  { key: REQUEST_PERMISSIONS.SHIFT_SWAP_RESPOND, module: 'requests', label: 'Phản hồi khi là đối tác đổi ca', enforced: true, defaultRoles: employee },
  { key: 'config.permission.manage', module: 'config', label: 'Quản lý ma trận phân quyền', enforced: true, defaultRoles: ['Admin'] },
  { key: 'config.user.manage', module: 'config', label: 'Quản lý quyền và trạng thái tài khoản', enforced: true, defaultRoles: ['Admin'] },
  { key: 'attendance.punch.own', module: 'attendance', label: 'Chấm công cho chính mình', enforced: false, defaultRoles: employee },
  { key: 'attendance.punch.proxy', module: 'attendance', label: 'Chấm công hộ', enforced: false, defaultRoles: ['HR', 'Admin'] },
  { key: 'shifts.schedule.view', module: 'shifts', label: 'Xem lịch làm việc', enforced: false, defaultRoles: employee },
  { key: 'shifts.schedule.manage', module: 'shifts', label: 'Quản lý lịch làm việc', enforced: false, defaultRoles: ['HR', 'Admin'] },
  { key: 'org.employee.view', module: 'org', label: 'Xem nhân viên', enforced: false, defaultRoles: ['Manager', 'HR', 'Admin'] },
  { key: 'org.employee.manage', module: 'org', label: 'Quản lý nhân viên', enforced: false, defaultRoles: ['HR', 'Admin'] },
  { key: 'delegation.manage_own', module: 'delegation', label: 'Quản lý ủy quyền của mình', enforced: false, defaultRoles: approver },
  { key: 'timesheet.view_own', module: 'timesheet', label: 'Xem bảng công của mình', enforced: false, defaultRoles: employee },
  { key: 'timesheet.view_scoped', module: 'timesheet', label: 'Xem bảng công theo scope', enforced: false, defaultRoles: ['Manager', 'HR', 'Admin'] },
  { key: 'payroll.view_own', module: 'payroll', label: 'Xem phiếu lương của mình', enforced: false, defaultRoles: employee },
  { key: 'payroll.manage', module: 'payroll', label: 'Quản lý bảng lương', enforced: false, defaultRoles: ['Accountant', 'Admin'] },
  { key: 'reports.view', module: 'reports', label: 'Xem báo cáo', enforced: false, defaultRoles: ['Manager', 'Accountant', 'HR', 'Director', 'Admin'] },
  { key: 'audit.view', module: 'audit', label: 'Xem nhật ký hệ thống', enforced: false, defaultRoles: ['Admin'] },
  { key: 'chatbot.use', module: 'chatbot', label: 'Sử dụng chatbot', enforced: false, defaultRoles: employee },
] as const

const keys = new Set<string>()
for (const permission of PERMISSION_CATALOG) {
  if (keys.has(permission.key)) throw new Error(`Permission catalog bị trùng key: ${permission.key}`)
  keys.add(permission.key)
}

export const ALL_PERMISSION_KEYS = PERMISSION_CATALOG.map((permission) => permission.key)
export const PERMISSION_BY_KEY = new Map(PERMISSION_CATALOG.map((permission) => [permission.key, permission]))
