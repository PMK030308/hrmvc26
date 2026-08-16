// Cấu hình điều hướng theo vai trò (map §15.1 routes).
import type { RoleCode } from '@/types'
import {
  LayoutDashboard, Fingerprint, CalendarDays, FileText, Wallet, Bell, UserCog,
  Users, Building2, Clock, CalendarRange, Table2, ClipboardCheck, BarChart3,
  Settings, ShieldCheck, ScrollText, Radio, ListChecks, BadgeDollarSign, UserCheck,
} from 'lucide-react'

export interface NavItem { label: string; to: string; icon: any; roles?: RoleCode[]; badgeKey?: string }

export const employeeNav: NavItem[] = [
  { label: 'Trang chủ', to: '/employee', icon: LayoutDashboard },
  { label: 'Chấm công', to: '/employee/attendance', icon: Fingerprint },
  { label: 'Bảng công', to: '/employee/timesheet', icon: Table2 },
  { label: 'Phân ca', to: '/employee/shift-schedule', icon: CalendarRange },
  { label: 'Kế hoạch nghỉ', to: '/employee/leave-plan', icon: CalendarDays },
  { label: 'Đơn từ', to: '/employee/requests', icon: FileText, badgeKey: 'pending-approvals' },
  { label: 'Duyệt đơn', to: '/employee/approvals', icon: ClipboardCheck, badgeKey: 'approvals' },
  { label: 'Lương', to: '/employee/salary', icon: Wallet },
  { label: 'Thông báo', to: '/employee/notifications', icon: Bell, badgeKey: 'notifications' },
  { label: 'Ủy quyền duyệt', to: '/employee/delegation', icon: UserCheck, roles: ['Manager', 'HR', 'Director', 'Accountant', 'Admin'] },
  { label: 'Hồ sơ', to: '/employee/profile', icon: UserCog },
]

export const adminNav: NavItem[] = [
  { label: 'Dashboard', to: '/admin/dashboard', icon: LayoutDashboard },
  { label: 'Live', to: '/admin/live', icon: Radio },
  { label: 'Nhân viên', to: '/admin/employees', icon: Users },
  { label: 'Phòng ban', to: '/admin/departments', icon: Building2 },
  { label: 'Ca làm việc', to: '/admin/shifts', icon: Clock },
  { label: 'Phân ca', to: '/admin/shift-schedule', icon: CalendarRange },
  { label: 'Bảng công', to: '/admin/timesheet', icon: Table2 },
  { label: 'Bảng tổng hợp', to: '/admin/summary-timesheet', icon: ListChecks },
  { label: 'Quản lý đơn', to: '/admin/requests', icon: FileText },
  { label: 'Ủy quyền duyệt', to: '/employee/delegation', icon: UserCheck },
  { label: 'Lương', to: '/admin/payroll', icon: BadgeDollarSign },
  { label: 'Báo cáo', to: '/admin/reports', icon: BarChart3 },
  { label: 'Quy định', to: '/admin/regulations/attendance', icon: Settings },
  { label: 'Role/Quyền', to: '/admin/roles', icon: ShieldCheck, roles: ['Admin'] },
  { label: 'Audit log', to: '/admin/audit', icon: ScrollText, roles: ['Admin'] },
]

export const accountantNav: NavItem[] = [
  { label: 'Bảng lương', to: '/accountant/payroll', icon: BadgeDollarSign },
  { label: 'Ủy quyền duyệt', to: '/employee/delegation', icon: UserCheck },
  { label: 'Báo cáo', to: '/accountant/reports', icon: BarChart3 },
]

export const directorNav: NavItem[] = [
  { label: 'Dashboard', to: '/director', icon: LayoutDashboard },
  { label: 'Duyệt đơn', to: '/director/approvals', icon: ClipboardCheck },
  { label: 'Ủy quyền duyệt', to: '/employee/delegation', icon: UserCheck },
  { label: 'Kỳ lương', to: '/director/payroll', icon: BadgeDollarSign },
  { label: 'Báo cáo', to: '/director/reports', icon: BarChart3 },
]

/** Lấy nav theo role ưu tiên (Director > Admin > HR > Accountant > Manager > Employee). */
export function navForRoles(roles: RoleCode[]): NavItem[] {
  if (roles.includes('Director')) return directorNav
  if (roles.includes('Admin') || roles.includes('HR')) return adminNav
  if (roles.includes('Accountant')) return accountantNav
  return employeeNav
}

/** Route mặc định sau đăng nhập theo role. */
export function homeForRoles(roles: RoleCode[]): string {
  if (roles.includes('Director')) return '/director'
  if (roles.includes('Admin') || roles.includes('HR')) return '/admin/dashboard'
  if (roles.includes('Accountant')) return '/accountant/payroll'
  return '/employee'
}