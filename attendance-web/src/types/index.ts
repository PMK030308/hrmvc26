// ============================================================================
// Kiểu dữ liệu hệ thống HRM Chấm công (map DTO backend, camelCase).
// Enum giữ nguyên giá trị số theo đặc tả §13 để tương thích khi migrate.
// ============================================================================

/* ----------------------------- Vai trò & quyền ---------------------------- */
export type RoleCode = 'Guest' | 'Employee' | 'Manager' | 'Accountant' | 'HR' | 'Director' | 'Admin'

export type PermissionFlag =
  | 'View' | 'Create' | 'Edit' | 'Delete' | 'Export' | 'Approve'

export type RequestPermission =
  | 'requests.request.create_own'
  | 'requests.request.view_own'
  | 'requests.request.view_related'
  | 'requests.request.view_scoped'
  | 'requests.request.view_all'
  | 'requests.request.modify_own'
  | 'requests.request.cancel_own'
  | 'requests.approval.approve_assigned'
  | 'requests.approval.reject_assigned'
  | 'requests.attachment.read_related'
  | 'requests.attachment.upload_own'
  | 'requests.attachment.upload_related'
  | 'requests.attachment.delete_own'
  | 'requests.shift_swap.respond_as_partner'

export interface RequestPermissionMatrixRow {
  permission: RequestPermission
  roles: Record<RoleCode, boolean>
}

export interface PermissionMatrixEntry {
  key: string
  module: string
  label: string
  enforced: boolean
  roles: Record<RoleCode, boolean>
}

export interface PermissionMatrixSnapshot {
  version: number
  permissions: PermissionMatrixEntry[]
}

export interface User {
  id: string
  email: string
  employeeId: string
  roles: RoleCode[]
  permissions: PermissionFlag[]
  effectivePermissions: string[]
  effectiveDepartmentScopes?: string[]
  /** Scope phòng ban giới hạn thao tác (manager chỉ thấy NV phòng mình) */
  departmentScopes: string[]
  isActive: boolean
  authorizationVersion: number
  permissionMatrixVersion?: number
}

export interface AuthResult {
  token: string
  user: User
}

/* ------------------------------- Tổ chức ---------------------------------- */
export interface Department {
  id: string
  code: string
  name: string
  parentId: string | null
  managerEmployeeId: string | null
}

export interface Position {
  id: string
  code: string
  name: string
}

export interface Branch {
  id: string
  name: string
  address: string
}

/* ------------------------------- Nhân viên -------------------------------- */
export type Gender = 0 | 1 | 2 // Other | Male | Female
export type EmployeeStatus = 1 | 2 | 3 | 4 | 5 // Probation|Active|OnLeave|Resigned|Terminated
export type WorkNature = 1 | 2 | 3 | 4 | 5 | 6 // FullTime|PartTime|Contract|Intern|Seasonal|Probation
export type ContractType = 1 | 2 | 3 | 4 | 5 // Indefinite|FixedTerm|PartTime|Seasonal|Internship

export interface EmployeeWorkInfo {
  id: string
  employeeId: string
  departmentId: string
  positionId: string
  branchId: string | null
  wage: number
  isCurrent: boolean
  isActive: boolean
  workNature: WorkNature
  contractType: ContractType
  startDate: string
  endDate: string | null
}

export type MaritalStatus = 'Single' | 'Married' | 'Divorced' | 'Widowed'

export interface Employee {
  id: string
  employeeCode: string
  firstName: string
  lastName: string
  fullName: string
  gender: Gender
  dateOfBirth: string | null
  email: string
  phone: string
  address: string
  maritalStatus: MaritalStatus
  status: EmployeeStatus
  avatarData: string | null
  managerId: string | null
  departmentId: string
  positionId: string
  branchId: string | null
  hireDate: string
  workNature: WorkNature
  contractType: ContractType
  wage: number
}

export type EmployeeProjection = Pick<Employee,
  'id' | 'employeeCode' | 'fullName' | 'email' | 'status' | 'avatarData' | 'managerId' | 'departmentId' | 'positionId' | 'branchId'
> & Partial<Pick<Employee,
  'firstName' | 'lastName' | 'gender' | 'dateOfBirth' | 'phone' | 'address' | 'maritalStatus' |
  'hireDate' | 'workNature' | 'contractType' | 'wage'
>>

/* --------------------------------- Ca ------------------------------------- */
export type ShiftStatus = 0 | 1 // Inactive | Active

export interface Shift {
  id: string
  code: string
  name: string
  /** ISO "HH:mm:ss" */
  startTime: string
  endTime: string
  breakStartTime: string | null
  breakEndTime: string | null
  checkInWindowFrom: string | null
  checkInWindowTo: string | null
  checkOutWindowFrom: string | null
  checkOutWindowTo: string | null
  latePunishmentEnabled: boolean
  latePunishmentTimes: number
  latePunishmentMinutesEach: number
  workDays: number // 1 = full, 0.5 = nửa ngày
  isOvernight: boolean
  status: ShiftStatus
  holidayCoefficient: number
  color: string
}

export interface ShiftSchedule {
  id: string
  employeeId: string
  shiftId: string
  date: string // YYYY-MM-DD
  ruleId: string | null
  isActive: boolean
}

/* ----------------------------- Chấm công ---------------------------------- */
export type PunchSource = 1 | 2 | 3 | 4 | 5 | 99 // Face|Gps|Wifi|QrCode|Ip|Manual
export type AttendanceStatus = 1 | 2 | 3 | 4 | 5 | 6 // OnTime|Late|EarlyLeave|Absent|Present|HalfDay
export type AttendanceMainStatus = 1 | 2 | 3 | 4 // Normal|Abnormal|NoShift|NotCounted
export type AttendanceApprovalStatus = 0 | 1 | 2 | 3 // None|Pending|Approved|Rejected
export type LivenessStrictness = 0 | 1 | 2 // Lenient|Standard|Strict

/** Bitmask cờ vấn đề (§5.3) */
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
export type AttendanceIssueFlags = number

export interface AttendancePunch {
  id: string
  employeeId: string
  date: string
  punchedAt: string // ISO UTC
  source: PunchSource
  deviceInfo: string | null
  latitude: number | null
  longitude: number | null
  accuracy: number | null
  wifiSsid: string | null
  notes: string | null
  snapshotBase64: string | null
  attendanceRecordId: string | null
  isCheckIn: boolean
  isActive: boolean
  createdAt: string
}

export interface AttendanceRecord {
  id: string
  employeeId: string
  date: string
  shiftId: string | null
  shiftName: string | null
  checkInTime: string | null // HH:mm (giờ VN)
  checkOutTime: string | null
  actualWorkHours: number
  workHours: number // công chuẩn (WorkDays)
  lateMinutes: number
  earlyLeaveMinutes: number
  overtimeHours: number
  /** Phân loại OT theo BLD 2019 (Điều 98) + giờ đêm */
  otWeekdayHours: number
  otWeekendHours: number
  otHolidayHours: number
  nightHours: number
  nightOtHours: number
  status: AttendanceStatus
  mainStatus: AttendanceMainStatus
  approvalStatus: AttendanceApprovalStatus
  issues: AttendanceIssueFlags
  notes: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface PunchResponse {
  success: boolean
  message: string
  checkIn: string | null
  checkOut: string | null
  totalPunches: number
  totalWorkHours: number
  nextAction: 'check_in' | 'check_out' | 'completed'
  completed: boolean
}

export interface AttendanceToday {
  record: AttendanceRecord | null
  punches: AttendancePunch[]
  todayShift: ShiftSchedule | null
  shift: Shift | null
}

/* ----------------------------- Khuôn mặt ---------------------------------- */
export interface FaceStatus {
  registered: boolean
  capturedCount: number
  registeredAt: string | null
}
export interface FaceRegisterPayload {
  /** Mảng nhiều mẫu, mỗi mẫu 128 số (descriptor 128-d). */
  descriptors: number[][]
  capturedCount: number
  photoBase64?: string | null
}
export interface FaceAttempt {
  token: string
  expiresAt: string
  requireLiveness: boolean
  strictness: LivenessStrictness
}
export interface LivenessPayload {
  landmarkVariance: number
  blinkDetected: boolean
  frameCount: number
  snapshotBase64: string | null
}
export interface FaceVerifyPayload {
  descriptor: number[]
  liveness: LivenessPayload
  token: string
  /** GPS thiết bị người chấm (nếu được cấp quyền). */
  gps?: { lat: number; lng: number; accuracy: number } | null
}

export interface LeavePlanItem {
  date: string
  type: 'leave' | 'approved_leave'
  label: string
}
export interface LeavePlan {
  balances: LeaveBalance[]
  upcoming: LeavePlanItem[]
}

/* ---------------------------- Quy định chấm công -------------------------- */
export interface AttendanceRegulation {
  id: string
  enablePunchFace: boolean
  enablePunchGps: boolean
  enablePunchWifi: boolean
  enablePunchIp: boolean
  enablePunchQr: boolean
  requireLivenessCheck: boolean
  livenessStrictness: LivenessStrictness
  alternativePunchMethod: PunchSource | null
  canEmployeeTrackWorkHours: boolean
  allowEmployeeShiftRegistration: boolean
  allowEmployeeViewDetailTimesheetDaily: boolean
  /** Cửa sổ chống chấm trùng (giây) — lấy lần đầu trong cửa sổ */
  duplicateWindowSeconds: number
  /** Giới hạn OT theo BLD 2019 (Điều 107) */
  otMonthlyCapHours: number
  otYearlyCapHours: number
  /** Hệ số OT (Điều 98) + phụ cấp đêm (Điều 55) */
  weekdayOtCoeff: number
  weekendOtCoeff: number
  holidayOtCoeff: number
  nightCoeff: number
  nightOtExtra: number
  standardMonthlyHours: number
  gpsCatalog: GpsCatalogItem[]
  wifiCatalog: WifiCatalogItem[]
  ipCatalog: IpCatalogItem[]
}

export interface GpsCatalogItem { id: string; name: string; lat: number; lng: number; radiusMeters: number }
export interface WifiCatalogItem { id: string; ssid: string; bssid: string | null }
export interface IpCatalogItem { id: string; ipAddress: string; subnetBits: number }

/* --------------------------------- Đơn từ --------------------------------- */
export type RequestType = 'leaves' | 'late-earlies' | 'overtimes' | 'business-trips' | 'shift-swaps' | 'attendance-updates'
export type RequestStatus = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11
// Draft|Pending|Approved|Rejected|Cancelled|PendingPartnerConfirmation|PartnerRejected|PendingApproval|NeedsReview|Invalidated|ApplyFailed

export type LeaveTypeCategory = 0 | 1 | 2 | 3 | 4 | 5 | 99 // None|Annual|Unpaid|Maternity|Sick|Compensatory|Other
export type LeaveFundType = 0 | 1 | 2 // None|AnnualLeave|CompensatoryLeave
export type LeaveDayCalculationType = 1 | 2 | 3 // WorkingDays|CalendarDays|ShiftHours
export type LateEarlyType = 1 | 2 // Late|EarlyLeave
export type AttendanceUpdateType = 1 | 2 | 3 // AddRecord|EditTime|DeleteRecord
export type ShiftSwapMode = 1 | 2 // SelfReassignment|MutualSwap
export type SwapPartnerConfirmationStatus = 0 | 1 | 2 | 3 // None|Pending|Accepted|Rejected
export type OvertimeCompensationType = 1 | 2 | 3 // PaidOnly|CompensatoryOnly|PaidAndCompensatory

export interface LeaveType {
  id: string
  name: string
  category: LeaveTypeCategory
  fundType: LeaveFundType
  maxDays: number | null
  requireAttachment: boolean
  requireReason: boolean
  dayCalculationType: LeaveDayCalculationType
}

/** Dạng union cho payload tạo đơn — frontend dùng discriminated union theo type */
export interface LeaveRequestPayload {
  leaveTypeId: string
  startDate: string
  endDate: string
  totalDays: number
  reason: string
}
export interface LateEarlyPayload {
  requestDate: string
  lateEarlyType: LateEarlyType
  requestedTime: string
  minutes: number
  reason: string
}
export interface OvertimePayload {
  otDate: string
  startTime: string
  endTime: string
  totalHours: number
  reason: string
  compensationType: OvertimeCompensationType
}
export interface BusinessTripPayload {
  startDate: string
  endDate: string
  totalDays: number
  location: string
  purpose: string
}
export interface ShiftSwapPayload {
  requestedDate: string
  shiftSwapMode: ShiftSwapMode
  suggestedSwapPartnerId: string | null
  reason: string
}
export interface AttendanceUpdatePayload {
  requestDate: string
  updateType: AttendanceUpdateType
  newCheckInTime: string | null
  newCheckOutTime: string | null
  newWorkHours: number | null
  reason: string
}

export interface BaseRequest {
  id: string
  type: RequestType
  employeeId: string
  employeeName: string
  employeeCode: string
  status: RequestStatus
  requestVersion: number
  createdAt: string
  updatedAt: string
  currentLevel: number
  capabilities: {
    canEdit: boolean
    canCancel: boolean
    canRespond: boolean
    canApprove: boolean
    canReject: boolean
    canUploadAttachment: boolean
    canDeleteAttachment: boolean
  }
  attachments: RequestAttachment[]
  approvals: RequestApproval[]
}

export interface LeaveRequest extends BaseRequest {
  type: 'leaves'
  leaveTypeId: string
  leaveTypeName: string
  startDate: string
  endDate: string
  totalDays: number
  reason: string
}
export interface LateEarlyRequest extends BaseRequest {
  type: 'late-earlies'
  requestDate: string
  lateEarlyType: LateEarlyType
  requestedTime: string
  minutes: number
  reason: string
}
export interface OvertimeRequest extends BaseRequest {
  type: 'overtimes'
  otDate: string
  startTime: string
  endTime: string
  totalHours: number
  compensationType: OvertimeCompensationType
  reason: string
}
export interface BusinessTripRequest extends BaseRequest {
  type: 'business-trips'
  startDate: string
  endDate: string
  totalDays: number
  location: string
  purpose: string
}
export interface ShiftSwapRequest extends BaseRequest {
  type: 'shift-swaps'
  requestedDate: string
  shiftSwapMode: ShiftSwapMode
  suggestedSwapPartnerId: string | null
  suggestedSwapPartnerName: string | null
  swapPartnerStatus: SwapPartnerConfirmationStatus
  reason: string
}
export interface AttendanceUpdateRequest extends BaseRequest {
  type: 'attendance-updates'
  requestDate: string
  updateType: AttendanceUpdateType
  newCheckInTime: string | null
  newCheckOutTime: string | null
  newWorkHours: number | null
  reason: string
}

export type AnyRequest =
  | LeaveRequest | LateEarlyRequest | OvertimeRequest
  | BusinessTripRequest | ShiftSwapRequest | AttendanceUpdateRequest

export type ApproverType = 1 | 2 | 3 | 4 | 5 | 6 // DirectManager|DepartmentHead|Position|SpecificUser|AnyUser|Role
export type ApprovalStatus = 1 | 2 | 3 | 4 | 5 // Draft|Pending|Approved|Rejected|Skipped
export type ApprovalConditionType =
  | 'ByLeaveDays' | 'ByOvertimeHours' | 'ByTripDays' | 'LeaveType'
  | 'LateEarlyMinutes' | 'LateEarlyType' | 'OvertimeCompensationType' | 'AttendanceUpdateType'
export type ConditionOperator = '<=' | '>' | '=' | '<' | '>=' | '!='

export interface ApprovalFlowStep {
  level: number
  approverType: ApproverType
  approverName: string
  approverUserId: string | null
  conditionType: ApprovalConditionType | null
  conditionOperator: ConditionOperator | null
  conditionValue: number | null
  /** Nếu condition không thỏa → chuyển thẳng sang level này (bypass) */
  elseGoToLevel: number | null
}

export interface RequestApproval {
  id: string
  requestId: string
  requestType: RequestType
  level: number
  approverUserId: string | null
  approverName: string
  status: ApprovalStatus
  comment: string | null
  approvedAt: string | null
  /** Vết ủy quyền: người duyệt thay mặt approver gốc (audit trail) */
  onBehalfOfUserId: string | null
  onBehalfOfName: string | null
}

export interface RequestAttachment {
  id: string
  requestId: string
  fileName: string
  fileSize: number
  mimeType: string
  dataUrl: string
  uploadedAt: string
}

/* ------------------------------- Quỹ phép --------------------------------- */
export interface LeaveBalance {
  id: string
  employeeId: string
  year: number
  leaveTypeCategory: LeaveTypeCategory
  leaveTypeName: string
  allocatedDays: number
  usedDays: number
  pendingDays: number
}

/* ----------------------------- Bảng công / Lương -------------------------- */
export type SummaryTimesheetStatus = 1 | 2 | 3 | 4 | 5 | 6
export type EmployeeConfirmationStatus = 1 | 2 | 3 | 4 // Pending|ConfirmedByEmployee|RejectedByEmployee|ConfirmedByHR
export type PayrollSheetStatus = 1 | 2 | 3 | 4 | 5 | 6 | 7
export type PayrollComponentType = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13

export interface SummaryTimesheetDetail {
  id: string
  summaryTimesheetId: string
  employeeId: string
  employeeName: string
  employeeCode: string
  paidUnits: number
  otHours: number
  lateEarlyCount: number
  workHours: number
  otWeekdayHours: number
  otWeekendHours: number
  otHolidayHours: number
  nightHours: number
  nightOtHours: number
  confirmationStatus: EmployeeConfirmationStatus
  confirmationComment: string | null
}

export interface SummaryTimesheet {
  id: string
  period: string // YYYYMM
  status: SummaryTimesheetStatus
  from: string
  to: string
  details: SummaryTimesheetDetail[]
}

export interface PayrollComponent {
  type: PayrollComponentType
  name: string
  amount: number
}
export interface Payslip {
  id: string
  period: string
  employeeId: string
  employeeName: string
  baseSalary: number
  paidWork: number
  overtime: number
  allowance: number
  gross: number
  deductions: number
  net: number
  components: PayrollComponent[]
}

/* ------------------------------ Thông báo --------------------------------- */
export type NotificationType = 1 | 2 | 3 | 4 | 5 | 6 // Info|Warning|Success|Error|Reminder|Approval
export interface AppNotification {
  id: string
  recipientUserId: string
  title: string
  message: string
  type: NotificationType
  relatedEntityType: string | null
  relatedEntityId: string | null
  isRead: boolean
  readAt: string | null
  linkUrl: string | null
  createdAt: string
}

/* ----------------------------- Dashboard ----------------------------------- */
export interface DashboardEvent {
  kind: 'punch' | 'request_created' | 'request_approved' | 'request_rejected' | 'payroll'
  title: string
  message: string
  actorName: string
  timestamp: string
}

export interface EmployeeDashboard {
  greeting: string
  employee: Pick<Employee, 'id' | 'fullName' | 'employeeCode' | 'avatarData' | 'hireDate'>
  yearsOfService: number
  today: AttendanceToday
  statCards: {
    leaveBalance: { allocated: number; used: number; pending: number }
    pendingApprovals: number
    monthPaidUnits: number
    workHours30: number
    otHours30: number
  }
  summary30: { present: number; absent: number; late: number; early: number; workHours: number; otHours: number }
  recentAttendance: AttendanceRecord[]
  myRequests: AnyRequest[]
  notifications: AppNotification[]
}

export interface AdminDashboard {
  kpi: {
    employeesCheckedInToday: number
    totalEmployees: number
    pendingApprovals: number
    pendingPayrolls: number
    onTimeRate: number
    lateToday: number
    absentToday: number
  }
  byDepartment: { name: string; present: number; total: number }[]
  punchHourDistribution: { hour: string; count: number }[]
  onTimeTrend: { day: string; onTime: number; late: number }[]
  activityFeed: DashboardEvent[]
}

/* --------------------------- Catalog cho form ----------------------------- */
export interface RequestCatalog {
  leaveTypes: LeaveType[]
  shifts: Shift[]
  swapPartners: { id: string; name: string; code: string }[]
  businessTripLocations: string[]
  lateEarlyTypes: { value: LateEarlyType; label: string }[]
  attendanceUpdateTypes: { value: AttendanceUpdateType; label: string }[]
  compensationTypes: { value: OvertimeCompensationType; label: string }[]
  shiftSwapModes: { value: ShiftSwapMode; label: string }[]
}

/* ----------------------------- Audit log ---------------------------------- */
export type AuditAction = 1 | 2 | 3 | 4 | 5 | 6 // Create|Update|Delete|Login|Logout|View
export interface AuditLog {
  id: string
  userId: string
  userName: string
  action: AuditAction
  entity: string
  entityId: string | null
  detail: string
  ipAddress: string | null
  createdAt: string
}

/* ------------------------------ API envelope ------------------------------ */
export interface ApiError {
  status: number
  message: string
  code?: string
  fieldErrors?: Record<string, string>
}
export interface Paginated<T> { items: T[]; total: number; page: number; pageSize: number }

/* ------------------------------ Ủy quyền duyệt ----------------------------- */
export interface Delegation {
  id: string
  delegatorUserId: string
  delegateUserId: string
  fromDate: string
  toDate: string
  reason: string | null
  isActive: boolean
  createdAt: string
}
/** Ủy quyền kèm tên hiển thị (từ GET /api/delegation). */
export interface DelegationRich extends Delegation {
  delegatorName: string
  delegateName: string
  /** Chỉ trả ở /api/delegation/all: đang hiệu lực tại hôm nay */
  isActiveNow?: boolean
}
/** Người có thể được chọn làm người ủy quyền (GET /api/delegation/approvers). */
export interface DelegatableUser {
  userId: string
  name: string
  email: string
  roles: RoleCode[]
}

/* ----------------------- Dashboard quỹ lương / giờ công -------------------- */
export interface SalaryFund {
  period: string
  byDepartment: { name: string; net: number; gross: number; headcount: number }[]
  totalNet: number
  totalGross: number
  totalBase: number
  totalOt: number
}
export interface WorkHoursAvg {
  from: string
  to: string
  overall: number
  byDepartment: { name: string; avgHours: number; headcount: number }[]
}
export interface SalaryMonthlyPoint {
  period: string
  totalNet: number
  totalBase: number
  totalOt: number
  label: string
}
export interface SalaryMonthly { periods: SalaryMonthlyPoint[] }
