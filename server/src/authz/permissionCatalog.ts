import type { RoleCode } from '../types.js'
import { REQUEST_PERMISSIONS } from './requestAuthorization.js'
import { ATTENDANCE_PERMISSIONS } from './attendanceAuthorization.js'
import { DELEGATION_PERMISSIONS } from './delegationAuthorization.js'
import { ORGANIZATION_PERMISSIONS } from './organizationAuthorization.js'
import { CHATBOT_PERMISSIONS } from './chatbotAuthorization.js'

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
  { key: 'config.regulation.view', module: 'config', label: 'Xem quy định chấm công', enforced: true, defaultRoles: ['Manager', 'HR', 'Admin'] },
  { key: 'config.regulation.manage', module: 'config', label: 'Cập nhật quy định chấm công', enforced: true, defaultRoles: ['HR', 'Admin'] },
  { key: 'config.leave_type.view', module: 'config', label: 'Xem cấu hình loại nghỉ', enforced: true, defaultRoles: ['HR', 'Admin'] },
  { key: 'config.leave_type.manage', module: 'config', label: 'Cập nhật cấu hình loại nghỉ', enforced: true, defaultRoles: ['HR', 'Admin'] },
  { key: 'system.demo_reset', module: 'system', label: 'Khôi phục dữ liệu demo', enforced: true, defaultRoles: ['Admin'] },
  { key: ATTENDANCE_PERMISSIONS.PUNCH_SELF, module: 'attendance', label: 'Chấm công cho chính mình', enforced: true, defaultRoles: employee },
  { key: ATTENDANCE_PERMISSIONS.VIEW_SELF, module: 'attendance', label: 'Xem công của chính mình', enforced: true, defaultRoles: employee },
  { key: ATTENDANCE_PERMISSIONS.VIEW_SCOPED, module: 'attendance', label: 'Xem công theo effective scope', enforced: true, defaultRoles: ['Manager', 'HR'] },
  { key: ATTENDANCE_PERMISSIONS.VIEW_ALL, module: 'attendance', label: 'Xem công toàn công ty', enforced: true, defaultRoles: ['Admin'] },
  { key: ATTENDANCE_PERMISSIONS.PROXY_PUNCH, module: 'attendance', label: 'Chấm công hộ trong effective scope', enforced: true, defaultRoles: ['HR', 'Admin'] },
  { key: ATTENDANCE_PERMISSIONS.CONFIRM_SELF, module: 'attendance', label: 'Xác nhận bảng công của mình', enforced: true, defaultRoles: employee },
  { key: ATTENDANCE_PERMISSIONS.LEAVE_PLAN_SELF, module: 'attendance', label: 'Xem kế hoạch nghỉ của mình', enforced: true, defaultRoles: employee },
  { key: ATTENDANCE_PERMISSIONS.LEAVERS_SCOPED, module: 'attendance', label: 'Xem người nghỉ theo effective scope', enforced: true, defaultRoles: ['Manager', 'HR', 'Admin'] },
  { key: ATTENDANCE_PERMISSIONS.EVIDENCE_VIEW, module: 'attendance', label: 'Xem bằng chứng chấm công nhạy cảm', enforced: true, defaultRoles: ['HR', 'Admin'] },
  { key: ATTENDANCE_PERMISSIONS.DEVICE_MANAGE, module: 'attendance', label: 'Quản lý thiết bị chấm công', enforced: true, defaultRoles: ['Admin'] },
  { key: 'face.manage.self', module: 'face', label: 'Quản lý khuôn mặt của chính mình', enforced: true, defaultRoles: employee },
  { key: 'shifts.catalog.view', module: 'shifts', label: 'Xem danh mục ca', enforced: true, defaultRoles: employee },
  { key: 'shifts.catalog.manage', module: 'shifts', label: 'Quản lý danh mục ca', enforced: true, defaultRoles: ['HR', 'Admin'] },
  { key: 'shifts.schedule.view_self', module: 'shifts', label: 'Xem lịch làm việc của mình', enforced: true, defaultRoles: employee },
  { key: 'shifts.schedule.view_scoped', module: 'shifts', label: 'Xem lịch làm việc theo effective scope', enforced: true, defaultRoles: ['Manager', 'HR'] },
  { key: 'shifts.schedule.view_all', module: 'shifts', label: 'Xem lịch làm việc toàn công ty', enforced: true, defaultRoles: ['Admin'] },
  { key: 'shifts.schedule.manage_scoped', module: 'shifts', label: 'Phân ca theo effective scope', enforced: true, defaultRoles: ['HR'] },
  { key: 'shifts.schedule.manage_all', module: 'shifts', label: 'Phân ca toàn công ty', enforced: true, defaultRoles: ['Admin'] },
  { key: ORGANIZATION_PERMISSIONS.CATALOG_VIEW, module: 'org', label: 'Xem danh mục tổ chức', enforced: true, defaultRoles: ['Manager', 'Accountant', 'HR', 'Director', 'Admin'] },
  { key: ORGANIZATION_PERMISSIONS.EMPLOYEE_VIEW_SCOPED, module: 'org', label: 'Xem nhân viên theo effective scope', enforced: true, defaultRoles: ['Manager', 'HR'] },
  { key: ORGANIZATION_PERMISSIONS.EMPLOYEE_VIEW_ALL, module: 'org', label: 'Xem toàn bộ nhân viên', enforced: true, defaultRoles: ['Accountant', 'Director', 'Admin'] },
  { key: ORGANIZATION_PERMISSIONS.EMPLOYEE_VIEW_PRIVATE, module: 'org', label: 'Xem thông tin nhân sự riêng tư', enforced: true, defaultRoles: ['HR', 'Admin'] },
  { key: ORGANIZATION_PERMISSIONS.EMPLOYEE_VIEW_COMPENSATION, module: 'org', label: 'Xem thông tin lương nhân viên', enforced: true, defaultRoles: ['Accountant', 'Admin'] },
  { key: ORGANIZATION_PERMISSIONS.EMPLOYEE_MANAGE_SCOPED, module: 'org', label: 'Quản lý nhân viên theo effective scope', enforced: true, defaultRoles: ['HR'] },
  { key: ORGANIZATION_PERMISSIONS.EMPLOYEE_MANAGE_ALL, module: 'org', label: 'Quản lý toàn bộ nhân viên', enforced: true, defaultRoles: ['Admin'] },
  { key: DELEGATION_PERMISSIONS.CREATE, module: 'delegation', label: 'Tạo ủy quyền duyệt', enforced: true, defaultRoles: approver },
  { key: DELEGATION_PERMISSIONS.REVOKE_OWN, module: 'delegation', label: 'Thu hồi ủy quyền do mình tạo', enforced: true, defaultRoles: approver },
  { key: DELEGATION_PERMISSIONS.REVOKE_ANY, module: 'delegation', label: 'Thu hồi ủy quyền của người khác', enforced: true, defaultRoles: ['Admin'] },
  { key: DELEGATION_PERMISSIONS.VIEW_ALL, module: 'delegation', label: 'Xem tất cả ủy quyền', enforced: true, defaultRoles: ['HR', 'Admin'] },
  { key: 'timesheet.detail.view_self', module: 'timesheet', label: 'Xem bảng công chi tiết của mình', enforced: true, defaultRoles: employee },
  { key: 'timesheet.detail.view_scoped', module: 'timesheet', label: 'Xem bảng công chi tiết theo effective scope', enforced: true, defaultRoles: ['Manager', 'HR'] },
  { key: 'timesheet.detail.view_all', module: 'timesheet', label: 'Xem bảng công chi tiết toàn công ty', enforced: true, defaultRoles: ['Admin'] },
  { key: 'timesheet.summary.view_scoped', module: 'timesheet', label: 'Xem bảng công tổng hợp theo effective scope', enforced: true, defaultRoles: ['Manager', 'HR'] },
  { key: 'timesheet.summary.view_all', module: 'timesheet', label: 'Xem bảng công tổng hợp toàn công ty', enforced: true, defaultRoles: ['Accountant', 'Director', 'Admin'] },
  { key: 'timesheet.summary.build', module: 'timesheet', label: 'Tạo bảng công tổng hợp', enforced: true, defaultRoles: ['HR', 'Admin'] },
  { key: 'timesheet.summary.confirm_hr', module: 'timesheet', label: 'HR xác nhận bảng công tổng hợp', enforced: true, defaultRoles: ['HR', 'Admin'] },
  { key: 'timesheet.summary.rebuild', module: 'timesheet', label: 'Tính lại bảng công tổng hợp', enforced: true, defaultRoles: ['HR', 'Admin'] },
  { key: 'timesheet.summary.transfer_payroll', module: 'timesheet', label: 'Chuyển bảng công sang lương', enforced: true, defaultRoles: ['HR', 'Accountant', 'Admin'] },
  { key: 'payroll.payslip.view_self', module: 'payroll', label: 'Xem phiếu lương của mình', enforced: true, defaultRoles: employee },
  { key: 'payroll.sheet.view', module: 'payroll', label: 'Xem chi tiết bảng lương', enforced: true, defaultRoles: ['Accountant', 'Admin'] },
  { key: 'payroll.sheet.approve', module: 'payroll', label: 'Duyệt kỳ lương đã chuyển', enforced: true, defaultRoles: ['Director', 'Admin'] },
  { key: 'reports.attendance.view_scoped', module: 'reports', label: 'Xem báo cáo chấm công theo effective scope', enforced: true, defaultRoles: ['Manager', 'HR'] },
  { key: 'reports.attendance.view_all', module: 'reports', label: 'Xem báo cáo chấm công toàn công ty', enforced: true, defaultRoles: ['Director', 'Admin'] },
  { key: 'reports.payroll.view_aggregate', module: 'reports', label: 'Xem báo cáo lương tổng hợp', enforced: true, defaultRoles: ['Accountant', 'HR', 'Director', 'Admin'] },
  { key: 'reports.payroll.view_detail', module: 'reports', label: 'Xem báo cáo lương từng nhân viên', enforced: true, defaultRoles: ['Accountant', 'Admin'] },
  { key: 'audit.view', module: 'audit', label: 'Xem nhật ký hệ thống', enforced: false, defaultRoles: ['Admin'] },
  { key: CHATBOT_PERMISSIONS.USE, module: 'chatbot', label: 'Sử dụng chatbot', enforced: true, defaultRoles: employee },
  { key: CHATBOT_PERMISSIONS.REQUEST_CREATE_SELF, module: 'chatbot', label: 'Tạo đơn của mình qua chatbot', enforced: true, defaultRoles: employee },
  { key: CHATBOT_PERMISSIONS.EMPLOYEE_SEARCH_SCOPED, module: 'chatbot', label: 'Tra cứu nhân viên trong effective scope qua chatbot', enforced: true, defaultRoles: ['Manager', 'HR', 'Admin'] },
  { key: CHATBOT_PERMISSIONS.ATTENDANCE_VIEW_SELF, module: 'chatbot', label: 'Xem chấm công của mình qua chatbot', enforced: true, defaultRoles: employee },
  { key: CHATBOT_PERMISSIONS.ATTENDANCE_VIEW_SCOPED, module: 'chatbot', label: 'Xem chấm công theo effective scope qua chatbot', enforced: true, defaultRoles: ['Manager', 'HR', 'Admin'] },
  { key: CHATBOT_PERMISSIONS.REQUEST_VIEW_SELF, module: 'chatbot', label: 'Xem đơn của mình qua chatbot', enforced: true, defaultRoles: employee },
  { key: CHATBOT_PERMISSIONS.REQUEST_VIEW_SCOPED, module: 'chatbot', label: 'Xem đơn theo effective scope qua chatbot', enforced: true, defaultRoles: ['Manager', 'HR', 'Admin'] },
  { key: CHATBOT_PERMISSIONS.LEAVE_BALANCE_VIEW_SELF, module: 'chatbot', label: 'Xem quỹ phép của mình qua chatbot', enforced: true, defaultRoles: employee },
  { key: CHATBOT_PERMISSIONS.REPORT_VIEW_AGGREGATE, module: 'chatbot', label: 'Xem báo cáo tổng hợp qua chatbot', enforced: true, defaultRoles: ['HR', 'Director', 'Admin'] },
] as const

const keys = new Set<string>()
for (const permission of PERMISSION_CATALOG) {
  if (keys.has(permission.key)) throw new Error(`Permission catalog bị trùng key: ${permission.key}`)
  keys.add(permission.key)
}

export const ALL_PERMISSION_KEYS = PERMISSION_CATALOG.map((permission) => permission.key)
export const PERMISSION_BY_KEY = new Map(PERMISSION_CATALOG.map((permission) => [permission.key, permission]))
