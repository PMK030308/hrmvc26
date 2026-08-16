// ============================================================================
// Dữ liệu mẫu (seed) — mô phỏng công ty "TechNova JSC".
// Tất cả nghiệp vụ chấm công dùng giờ VN (UTC+7); mock chạy client-side nên
// dùng giờ local của trình duyệt làm giờ VN.
// ============================================================================
import type {
  Department, Position, Branch, Employee, Shift, User, LeaveType,
  LeaveBalance, AttendanceRegulation, RoleCode, PermissionFlag,
} from '@/types'

const now = new Date()
const year = now.getFullYear()

/* ------------------------------- Tổ chức ---------------------------------- */
export const branches: Branch[] = [
  { id: 'br-hn', name: 'Trụ sở Hà Nội', address: '123 Trần Duy Hưng, Cầu Giấy, Hà Nội' },
  { id: 'br-hcm', name: 'Chi nhánh HCM', address: '45 Nguyễn Huệ, Q.1, TP. HCM' },
]

export const departments: Department[] = [
  { id: 'dep-it', code: 'IT', name: 'Phòng Công nghệ', parentId: null, managerEmployeeId: 'emp-mgr-it' },
  { id: 'dep-sales', code: 'SALE', name: 'Phòng Kinh doanh', parentId: null, managerEmployeeId: 'emp-mgr-sales' },
  { id: 'dep-hr', code: 'HR', name: 'Phòng Nhân sự', parentId: null, managerEmployeeId: 'emp-hr' },
]

export const positions: Position[] = [
  { id: 'pos-dev', code: 'DEV', name: 'Lập trình viên' },
  { id: 'pos-lead', code: 'LEAD', name: 'Trưởng nhóm' },
  { id: 'pos-sale', code: 'SALE', name: 'Nhân viên kinh doanh' },
  { id: 'pos-hr', code: 'HR', name: 'Chuyên viên Nhân sự' },
  { id: 'pos-acct', code: 'ACCT', name: 'Kế toán' },
  { id: 'pos-dir', code: 'DIR', name: 'Giám đốc' },
]

/* --------------------------------- Ca ------------------------------------- */
export const shifts: Shift[] = [
  {
    id: 'shift-office', code: 'OFFICE', name: 'Ca hành chính',
    startTime: '08:00:00', endTime: '17:00:00',
    breakStartTime: '12:00:00', breakEndTime: '13:00:00',
    checkInWindowFrom: '07:30:00', checkInWindowTo: '08:15:00',
    checkOutWindowFrom: '16:45:00', checkOutWindowTo: '18:00:00',
    latePunishmentEnabled: true, latePunishmentTimes: 3, latePunishmentMinutesEach: 30,
    workDays: 1, isOvernight: false, status: 1, holidayCoefficient: 1.5, color: '#3366ff',
  },
  {
    id: 'shift-morning', code: 'MORNING', name: 'Ca sáng',
    startTime: '06:00:00', endTime: '14:00:00',
    breakStartTime: '10:00:00', breakEndTime: '10:30:00',
    checkInWindowFrom: '05:30:00', checkInWindowTo: '06:15:00',
    checkOutWindowFrom: '13:45:00', checkOutWindowTo: '14:30:00',
    latePunishmentEnabled: false, latePunishmentTimes: 0, latePunishmentMinutesEach: 0,
    workDays: 1, isOvernight: false, status: 1, holidayCoefficient: 1.3, color: '#10b981',
  },
  {
    id: 'shift-afternoon', code: 'AFTERNOON', name: 'Ca chiều',
    startTime: '14:00:00', endTime: '22:00:00',
    breakStartTime: '17:30:00', breakEndTime: '18:00:00',
    checkInWindowFrom: '13:30:00', checkInWindowTo: '14:15:00',
    checkOutWindowFrom: '21:45:00', checkOutWindowTo: '22:30:00',
    latePunishmentEnabled: false, latePunishmentTimes: 0, latePunishmentMinutesEach: 0,
    workDays: 1, isOvernight: false, status: 1, holidayCoefficient: 1.3, color: '#f59e0b',
  },
  {
    id: 'shift-night', code: 'NIGHT', name: 'Ca đêm',
    startTime: '22:00:00', endTime: '06:00:00',
    breakStartTime: '02:00:00', breakEndTime: '02:30:00',
    checkInWindowFrom: '21:30:00', checkInWindowTo: '22:15:00',
    checkOutWindowFrom: '05:45:00', checkOutWindowTo: '09:00:00',
    latePunishmentEnabled: false, latePunishmentTimes: 0, latePunishmentMinutesEach: 0,
    workDays: 1, isOvernight: true, status: 1, holidayCoefficient: 2.0, color: '#8b5cf6',
  },
]

/* ------------------------------- Nhân viên -------------------------------- */
function emp(id: string, code: string, firstName: string, lastName: string, gender: 1 | 2,
  email: string, phone: string, departmentId: string, positionId: string, managerId: string | null,
  wage: number, workNature: Employee['workNature'], hireDate: string): Employee {
  return {
    id, employeeCode: code, firstName, lastName, fullName: `${lastName} ${firstName}`,
    gender, dateOfBirth: null, email, phone, address: 'Hà Nội',
    maritalStatus: 'Single', status: 2, avatarData: null,
    managerId, departmentId, positionId, branchId: 'br-hn',
    hireDate, workNature, contractType: 1, wage,
  }
}

export const employees: Employee[] = [
  // Giám đốc
  emp('emp-dir', 'NV001', 'Minh Triết', 'Phạm', 1, 'triet.pham@technova.vn', '0901000001', 'dep-it', 'pos-dir', null, 80_000_000, 1, '2019-03-01'),
  // Quản lý IT
  emp('emp-mgr-it', 'NV002', 'Hải Yến', 'Trần', 2, 'yen.tran@technova.vn', '0901000002', 'dep-it', 'pos-lead', 'emp-dir', 45_000_000, 1, '2020-06-15'),
  // Nhân viên IT
  emp('emp-dev1', 'NV003', 'Minh Khôi', 'Phạm', 1, 'khoi.pham@technova.vn', '0901000003', 'dep-it', 'pos-dev', 'emp-mgr-it', 22_000_000, 1, '2022-09-01'),
  emp('emp-dev2', 'NV004', 'Thu Trang', 'Nguyễn', 2, 'trang.nguyen@technova.vn', '0901000004', 'dep-it', 'pos-dev', 'emp-mgr-it', 20_000_000, 1, '2023-01-10'),
  emp('emp-dev3', 'NV005', 'Đức Anh', 'Lê', 1, 'anh.le@technova.vn', '0901000005', 'dep-it', 'pos-dev', 'emp-mgr-it', 18_000_000, 2, '2024-02-01'),
  // Quản lý kinh doanh
  emp('emp-mgr-sales', 'NV006', 'Bảo Châu', 'Hoàng', 2, 'chau.hoang@technova.vn', '0901000006', 'dep-sales', 'pos-lead', 'emp-dir', 38_000_000, 1, '2021-04-20'),
  emp('emp-sale1', 'NV007', 'Gia Huy', 'Vũ', 1, 'huy.vu@technova.vn', '0901000007', 'dep-sales', 'pos-sale', 'emp-mgr-sales', 15_000_000, 1, '2023-07-01'),
  emp('emp-sale2', 'NV008', 'Mai Linh', 'Đỗ', 2, 'linh.do@technova.vn', '0901000008', 'dep-sales', 'pos-sale', 'emp-mgr-sales', 14_000_000, 1, '2024-05-15'),
  // HR
  emp('emp-hr', 'NV009', 'Phương Anh', 'Đặng', 2, 'anh.dang@technova.vn', '0901000009', 'dep-hr', 'pos-hr', 'emp-dir', 30_000_000, 1, '2020-10-01'),
  // Kế toán
  emp('emp-acct', 'NV010', 'Quang Hùng', 'Bùi', 1, 'hung.bui@technova.vn', '0901000010', 'dep-hr', 'pos-acct', 'emp-dir', 28_000_000, 1, '2021-08-01'),
]

/* --------------------------- User / role / quyền --------------------------- */
const ALL_PERMS: PermissionFlag[] = ['View', 'Create', 'Edit', 'Delete', 'Export', 'Approve']

function user(id: string, email: string, employeeId: string, roles: RoleCode[],
  perms: PermissionFlag[], deptScopes: string[] = []): User {
  return { id, email, employeeId, roles, permissions: perms, departmentScopes: deptScopes }
}

export const users: User[] = [
  user('usr-admin', 'admin@technova.vn', 'emp-hr', ['Admin'], ALL_PERMS),
  user('usr-dir', 'triet.pham@technova.vn', 'emp-dir', ['Director'], ['View', 'Approve', 'Export']),
  user('usr-hr', 'anh.dang@technova.vn', 'emp-hr', ['HR', 'Manager'], ['View', 'Create', 'Edit', 'Approve', 'Export'], ['dep-hr']),
  user('usr-acct', 'hung.bui@technova.vn', 'emp-acct', ['Accountant'], ['View', 'Edit', 'Export']),
  user('usr-mgr-it', 'yen.tran@technova.vn', 'emp-mgr-it', ['Manager'], ['View', 'Create', 'Approve'], ['dep-it']),
  user('usr-mgr-sales', 'chau.hoang@technova.vn', 'emp-mgr-sales', ['Manager'], ['View', 'Create', 'Approve'], ['dep-sales']),
  user('usr-dev1', 'khoi.pham@technova.vn', 'emp-dev1', ['Employee'], ['View', 'Create']),
  user('usr-dev2', 'trang.nguyen@technova.vn', 'emp-dev2', ['Employee'], ['View', 'Create']),
  user('usr-dev3', 'anh.le@technova.vn', 'emp-dev3', ['Employee'], ['View', 'Create']),
  user('usr-sale1', 'huy.vu@technova.vn', 'emp-sale1', ['Employee'], ['View', 'Create']),
  user('usr-sale2', 'linh.do@technova.vn', 'emp-sale2', ['Employee'], ['View', 'Create']),
]

/** Mật khẩu demo — tất cả = "123456" (mock, không bcrypt thật). */
export const PASSWORDS: Record<string, string> = Object.fromEntries(users.map((u) => [u.email, '123456']))

/* ------------------------------- Loại nghỉ -------------------------------- */
export const leaveTypes: LeaveType[] = [
  { id: 'lt-annual', name: 'Nghỉ phép năm', category: 1, fundType: 1, maxDays: 12, requireAttachment: false, requireReason: true, dayCalculationType: 1 },
  { id: 'lt-sick', name: 'Nghỉ ốm đau', category: 4, fundType: 0, maxDays: 30, requireAttachment: true, requireReason: true, dayCalculationType: 1 },
  { id: 'lt-unpaid', name: 'Nghỉ không lương', category: 2, fundType: 0, maxDays: null, requireAttachment: false, requireReason: true, dayCalculationType: 2 },
  { id: 'lt-maternity', name: 'Nghỉ thai sản', category: 3, fundType: 0, maxDays: 180, requireAttachment: true, requireReason: false, dayCalculationType: 2 },
  { id: 'lt-comp', name: 'Nghỉ bù (OT bù)', category: 5, fundType: 2, maxDays: 10, requireAttachment: false, requireReason: true, dayCalculationType: 1 },
]

/* ------------------------------- Quỹ phép --------------------------------- */
export function seedLeaveBalances(): LeaveBalance[] {
  const balances: LeaveBalance[] = []
  for (const e of employees) {
    balances.push({ id: `lb-${e.id}-annual`, employeeId: e.id, year, leaveTypeCategory: 1, leaveTypeName: 'Phép năm', allocatedDays: 12, usedDays: 3, pendingDays: 0 })
    balances.push({ id: `lb-${e.id}-comp`, employeeId: e.id, year, leaveTypeCategory: 5, leaveTypeName: 'Phép bù', allocatedDays: 4, usedDays: 0, pendingDays: 0 })
  }
  return balances
}

/* ----------------------- Quy định chấm công (Admin) ------------------------ */
export const regulation: AttendanceRegulation = {
  id: 'reg-1',
  enablePunchFace: true,
  enablePunchGps: true,
  enablePunchWifi: true,
  enablePunchIp: true,
  enablePunchQr: true,
  requireLivenessCheck: true,
  livenessStrictness: 1,
  alternativePunchMethod: 99,
  canEmployeeTrackWorkHours: true,
  allowEmployeeShiftRegistration: true,
  allowEmployeeViewDetailTimesheetDaily: true,
  gpsCatalog: [
    { id: 'gps-1', name: 'Trụ sở HN', lat: 21.0137, lng: 105.7982, radiusMeters: 200 },
    { id: 'gps-2', name: 'Chi nhánh HCM', lat: 10.7726, lng: 106.7034, radiusMeters: 200 },
  ],
  wifiCatalog: [
    { id: 'wifi-1', ssid: 'TechNova-Office', bssid: 'AA:BB:CC:DD:EE:01' },
    { id: 'wifi-2', ssid: 'TechNova-Guest', bssid: null },
  ],
  ipCatalog: [
    { id: 'ip-1', ipAddress: '203.0.113.0', subnetBits: 24 },
  ],
}