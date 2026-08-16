// ============================================================================
// Map enum (số) → nhãn tiếng Việt + màu sắc. Giữ giá trị số theo đặc tả §13.
// ============================================================================
import type {
  AttendanceStatus, AttendanceMainStatus, AttendanceApprovalStatus, PunchSource,
  RequestStatus, LeaveTypeCategory, LeaveFundType, LateEarlyType, AttendanceUpdateType,
  ShiftSwapMode, SwapPartnerConfirmationStatus, OvertimeCompensationType, ApprovalStatus,
  EmployeeStatus, WorkNature, ContractType, Gender, NotificationType, AuditAction,
  RoleCode, PermissionFlag, SummaryTimesheetStatus, EmployeeConfirmationStatus,
  PayrollSheetStatus, PayrollComponentType, LivenessStrictness,
} from '@/types'

export interface LabelMeta { label: string; tone: Tone }
type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'muted'

const toneClass: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700',
  brand: 'bg-brand-50 text-brand-700',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-danger-50 text-danger-700',
  info: 'bg-info-50 text-info-600',
  muted: 'bg-slate-100 text-slate-500',
}

export function badgeClass(tone: Tone): string {
  return `${toneClass[tone]}`
}

/* -------------------------------- Vai trò --------------------------------- */
export const ROLE_LABEL: Record<RoleCode, LabelMeta> = {
  Guest: { label: 'Khách', tone: 'muted' },
  Employee: { label: 'Nhân viên', tone: 'info' },
  Manager: { label: 'Quản lý', tone: 'brand' },
  Accountant: { label: 'Kế toán', tone: 'warning' },
  HR: { label: 'HR / HCNS', tone: 'success' },
  Director: { label: 'Giám đốc', tone: 'danger' },
  Admin: { label: 'Quản trị', tone: 'neutral' },
}

export const PERMISSION_LABEL: Record<PermissionFlag, string> = {
  View: 'Xem', Create: 'Tạo', Edit: 'Sửa', Delete: 'Xóa', Export: 'Xuất', Approve: 'Duyệt',
}

/** Phân quyền ma trận §2.2 — key = feature code */
export interface FeaturePerm { feature: string; perms: Partial<Record<RoleCode, PermissionFlag[]>> }
export const FEATURE_PERMS: FeaturePerm[] = [
  { feature: 'attendance.punch', perms: { Employee: ['View'], Manager: ['View'], HR: ['View'], Admin: ['View'] } },
  { feature: 'requests.create', perms: { Employee: ['Create'], Manager: ['Create'], HR: ['Create'], Admin: ['Create'] } },
  { feature: 'requests.approve', perms: { Manager: ['Approve'], HR: ['Approve'], Director: ['Approve'], Admin: ['Approve'] } },
  { feature: 'attendance.proxy', perms: { Manager: ['Create'], HR: ['Create'], Admin: ['Create'] } },
  { feature: 'timesheet.view', perms: { Employee: ['View'], Manager: ['View'], HR: ['View'], Director: ['View'], Admin: ['View'] } },
  { feature: 'payroll.manage', perms: { Accountant: ['View', 'Edit'], HR: ['View'], Director: ['Approve'], Admin: ['View'] } },
  { feature: 'regulations.edit', perms: { HR: ['Edit'], Admin: ['Edit'] } },
  { feature: 'roles.manage', perms: { Admin: ['View', 'Edit'] } },
  { feature: 'audit.view', perms: { Admin: ['View'] } },
  { feature: 'reports.view', perms: { Manager: ['View'], Accountant: ['View'], HR: ['View'], Director: ['View'], Admin: ['View'] } },
]

/* ----------------------------- Chấm công --------------------------------- */
export const PUNCH_SOURCE_LABEL: Record<PunchSource, LabelMeta> = {
  1: { label: 'Khuôn mặt', tone: 'brand' },
  2: { label: 'GPS', tone: 'info' },
  3: { label: 'Wi-Fi', tone: 'success' },
  4: { label: 'QR Code', tone: 'warning' },
  5: { label: 'IP', tone: 'muted' },
  99: { label: 'Thủ công', tone: 'neutral' },
}

export const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, LabelMeta> = {
  1: { label: 'Đúng giờ', tone: 'success' },
  2: { label: 'Đi muộn', tone: 'warning' },
  3: { label: 'Về sớm', tone: 'warning' },
  4: { label: 'Vắng mặt', tone: 'danger' },
  5: { label: 'Có mặt', tone: 'brand' },
  6: { label: 'Nửa ngày', tone: 'info' },
}

export const MAIN_STATUS_LABEL: Record<AttendanceMainStatus, LabelMeta> = {
  1: { label: 'Bình thường', tone: 'success' },
  2: { label: 'Bất thường', tone: 'danger' },
  3: { label: 'Không ca', tone: 'muted' },
  4: { label: 'Không tính', tone: 'muted' },
}

export const APPROVAL_STATUS_LABEL: Record<AttendanceApprovalStatus, LabelMeta> = {
  0: { label: '—', tone: 'muted' },
  1: { label: 'Chờ duyệt', tone: 'warning' },
  2: { label: 'Đã duyệt', tone: 'success' },
  3: { label: 'Từ chối', tone: 'danger' },
}

/* --------------------------------- Đơn ----------------------------------- */
export const REQUEST_STATUS_LABEL: Record<RequestStatus, LabelMeta> = {
  1: { label: 'Nháp', tone: 'muted' },
  2: { label: 'Chờ duyệt', tone: 'warning' },
  3: { label: 'Đã duyệt', tone: 'success' },
  4: { label: 'Từ chối', tone: 'danger' },
  5: { label: 'Đã hủy', tone: 'muted' },
  6: { label: 'Chờ đồng nghiệp xác nhận', tone: 'info' },
  7: { label: 'Đồng nghiệp từ chối', tone: 'danger' },
  8: { label: 'Chờ phê duyệt', tone: 'warning' },
  9: { label: 'Cần rà soát', tone: 'warning' },
  10: { label: 'Vô hiệu', tone: 'muted' },
  11: { label: 'Áp dụng thất bại', tone: 'danger' },
}

export const REQUEST_TYPE_LABEL: Record<string, LabelMeta> = {
  leaves: { label: 'Đơn nghỉ phép', tone: 'brand' },
  'late-earlies': { label: 'Đi muộn / Về sớm', tone: 'warning' },
  overtimes: { label: 'Làm thêm (OT)', tone: 'info' },
  'business-trips': { label: 'Công tác', tone: 'success' },
  'shift-swaps': { label: 'Đổi ca', tone: 'neutral' },
  'attendance-updates': { label: 'Cập nhật công', tone: 'danger' },
}

export const LEAVE_CATEGORY_LABEL: Record<LeaveTypeCategory, LabelMeta> = {
  0: { label: '—', tone: 'muted' },
  1: { label: 'Phép năm', tone: 'brand' },
  2: { label: 'Không lương', tone: 'warning' },
  3: { label: 'Thai sản', tone: 'info' },
  4: { label: 'Ốm đau', tone: 'danger' },
  5: { label: 'Bù', tone: 'success' },
  99: { label: 'Khác', tone: 'neutral' },
}

export const LEAVE_FUND_LABEL: Record<LeaveFundType, string> = {
  0: 'Không dùng quỹ', 1: 'Phép năm', 2: 'Phép bù',
}

export const DAY_CALC_LABEL: Record<number, string> = {
  1: 'Theo ngày làm việc', 2: 'Theo ngày lịch', 3: 'Theo giờ ca',
}

export const LATE_EARLY_LABEL: Record<LateEarlyType, LabelMeta> = {
  1: { label: 'Đi muộn', tone: 'warning' },
  2: { label: 'Về sớm', tone: 'warning' },
}

export const ATT_UPDATE_TYPE_LABEL: Record<AttendanceUpdateType, LabelMeta> = {
  1: { label: 'Thêm bản ghi', tone: 'success' },
  2: { label: 'Sửa giờ', tone: 'warning' },
  3: { label: 'Xóa bản ghi', tone: 'danger' },
}

export const SHIFT_SWAP_MODE_LABEL: Record<ShiftSwapMode, LabelMeta> = {
  1: { label: 'Tự đổi ca', tone: 'neutral' },
  2: { label: 'Đổi với đồng nghiệp', tone: 'brand' },
}

export const SWAP_PARTNER_LABEL: Record<SwapPartnerConfirmationStatus, LabelMeta> = {
  0: { label: '—', tone: 'muted' },
  1: { label: 'Chờ xác nhận', tone: 'warning' },
  2: { label: 'Đã đồng ý', tone: 'success' },
  3: { label: 'Từ chối', tone: 'danger' },
}

export const OT_COMP_LABEL: Record<OvertimeCompensationType, LabelMeta> = {
  1: { label: 'Trả lương', tone: 'success' },
  2: { label: 'Bù nghỉ', tone: 'info' },
  3: { label: 'Lương + Bù', tone: 'brand' },
}

export const APPROVAL_STEP_STATUS_LABEL: Record<ApprovalStatus, LabelMeta> = {
  1: { label: 'Nháp', tone: 'muted' },
  2: { label: 'Chờ duyệt', tone: 'warning' },
  3: { label: 'Đã duyệt', tone: 'success' },
  4: { label: 'Từ chối', tone: 'danger' },
  5: { label: 'Bỏ qua', tone: 'muted' },
}

/* --------------------------- Nhân viên ----------------------------------- */
export const EMPLOYEE_STATUS_LABEL: Record<EmployeeStatus, LabelMeta> = {
  1: { label: 'Thử việc', tone: 'warning' },
  2: { label: 'Đang làm', tone: 'success' },
  3: { label: 'Nghỉ phép', tone: 'info' },
  4: { label: 'Đã nghỉ', tone: 'muted' },
  5: { label: 'Sa thải', tone: 'danger' },
}

export const WORK_NATURE_LABEL: Record<WorkNature, string> = {
  1: 'Toàn thời gian', 2: 'Bán thời gian', 3: 'Hợp đồng', 4: 'Thực tập', 5: 'Thời vụ', 6: 'Thử việc',
}

export const CONTRACT_LABEL: Record<ContractType, string> = {
  1: 'Không xác định thời hạn', 2: 'Xác định thời hạn', 3: 'Bán thời gian', 4: 'Thời vụ', 5: 'Thực tập',
}

export const GENDER_LABEL: Record<Gender, string> = { 0: 'Khác', 1: 'Nam', 2: 'Nữ' }

/* ----------------------------- Thông báo --------------------------------- */
export const NOTIF_TYPE_LABEL: Record<NotificationType, LabelMeta> = {
  1: { label: 'Thông tin', tone: 'info' },
  2: { label: 'Cảnh báo', tone: 'warning' },
  3: { label: 'Thành công', tone: 'success' },
  4: { label: 'Lỗi', tone: 'danger' },
  5: { label: 'Nhắc nhở', tone: 'brand' },
  6: { label: 'Phê duyệt', tone: 'brand' },
}

export const AUDIT_ACTION_LABEL: Record<AuditAction, LabelMeta> = {
  1: { label: 'Tạo', tone: 'success' },
  2: { label: 'Cập nhật', tone: 'info' },
  3: { label: 'Xóa', tone: 'danger' },
  4: { label: 'Đăng nhập', tone: 'neutral' },
  5: { label: 'Đăng xuất', tone: 'muted' },
  6: { label: 'Xem', tone: 'muted' },
}

/* --------------------------- Bảng công / lương --------------------------- */
export const SUMMARY_TS_LABEL: Record<SummaryTimesheetStatus, LabelMeta> = {
  1: { label: 'Nháp', tone: 'muted' },
  2: { label: 'Gửi xác nhận', tone: 'warning' },
  3: { label: 'Đã xác nhận', tone: 'success' },
  4: { label: 'Chuyển lương', tone: 'brand' },
  5: { label: 'Xác nhận một phần', tone: 'info' },
  6: { label: 'Có khiếu nại', tone: 'danger' },
}

export const CONFIRM_LABEL: Record<EmployeeConfirmationStatus, LabelMeta> = {
  1: { label: 'Chờ xác nhận', tone: 'warning' },
  2: { label: 'NV đã xác nhận', tone: 'success' },
  3: { label: 'NV từ chối', tone: 'danger' },
  4: { label: 'HR đã xác nhận', tone: 'brand' },
}

export const PAYROLL_STATUS_LABEL: Record<PayrollSheetStatus, LabelMeta> = {
  1: { label: 'Nháp', tone: 'muted' },
  2: { label: 'Gửi GĐ', tone: 'warning' },
  3: { label: 'GĐ duyệt', tone: 'success' },
  4: { label: 'Trả kế toán', tone: 'info' },
  5: { label: 'Đã công bố', tone: 'brand' },
  6: { label: 'Đã thanh toán', tone: 'success' },
  7: { label: 'Hủy', tone: 'danger' },
}

export const PAYROLL_COMPONENT_LABEL: Record<PayrollComponentType, string> = {
  1: 'Lương cơ bản', 2: 'Công hưởng', 3: 'Làm thêm', 4: 'Phụ cấp',
  5: 'Khấu trừ công', 6: 'Thiếu giờ không lương', 7: 'Bảo hiểm (NV)', 8: 'Thuế TNCN',
  9: 'Tạm ứng', 10: 'Truy thu', 11: 'Thu hồi', 12: 'Khấu trừ khác', 13: 'Khoản cộng khác',
}

export const LIVENESS_LABEL: Record<LivenessStrictness, string> = {
  0: 'Lỏng (Lenient)', 1: 'Chuẩn (Standard)', 2: 'Nghiêm (Strict)',
}

/* ----------------------------- Helper ------------------------------------- */
export function metaLabel<T extends string | number>(map: Record<T, LabelMeta>, key: T): string {
  return map[key]?.label ?? String(key)
}
export function metaTone<T extends string | number>(map: Record<T, LabelMeta>, key: T): string {
  return badgeClass(map[key]?.tone ?? 'neutral')
}