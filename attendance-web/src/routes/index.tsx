import { createBrowserRouter, Navigate } from 'react-router-dom'
import { RequireAnyPermission, RequireAuth, RequirePermission, RequireRole, GuestOnly } from './guards'
import { AppLayout } from '@/components/layout/AppLayout'
import { homeForRoles } from '@/components/layout/nav'
import { useAuthStore } from '@/stores/authStore'

// Auth
import LoginPage from '@/pages/auth/LoginPage'
// Employee
import EmployeeHome from '@/pages/employee/Home'
import AttendancePage from '@/pages/employee/Attendance'
import TimesheetPage from '@/pages/employee/Timesheet'
import ShiftSchedulePage from '@/pages/employee/ShiftSchedule'
import LeavePlanPage from '@/pages/employee/LeavePlan'
import RequestsPage from '@/pages/employee/Requests'
import RequestCreatePage from '@/pages/employee/RequestCreate'
import RequestDetailPage from '@/pages/employee/RequestDetail'
import ApprovalsPage from '@/pages/employee/Approvals'
import SalaryPage from '@/pages/employee/Salary'
import ProfilePage from '@/pages/employee/Profile'
import NotificationsPage from '@/pages/employee/Notifications'
import LeaversTodayPage from '@/pages/employee/LeaversToday'
import PunchOptionsPage from '@/pages/employee/PunchOptions'
import FaceRegisterPage from '@/pages/employee/FaceRegister'
import FacePunchPage from '@/pages/employee/FacePunch'
import DelegationPage from '@/pages/manager/Delegation'
// Admin
import AdminDashboard from '@/pages/admin/Dashboard'
import AdminLive from '@/pages/admin/Live'
import AdminEmployees from '@/pages/admin/Employees'
import AdminDepartments from '@/pages/admin/Departments'
import AdminShifts from '@/pages/admin/Shifts'
import AdminShiftSchedule from '@/pages/admin/ShiftSchedule'
import AdminTimesheet from '@/pages/admin/Timesheet'
import AdminSummaryTimesheet from '@/pages/admin/SummaryTimesheet'
import AdminRequests from '@/pages/admin/Requests'
import AdminPayroll from '@/pages/admin/Payroll'
import AdminReports from '@/pages/admin/Reports'
import AdminRegulations from '@/pages/admin/Regulations'
import AdminRoles from '@/pages/admin/Roles'
import AdminAudit from '@/pages/admin/Audit'
// Director
import DirectorDashboard from '@/pages/director/Dashboard'
import DirectorApprovals from '@/pages/director/Approvals'
import DirectorPayroll from '@/pages/director/Payroll'
import DirectorReports from '@/pages/director/Reports'
// Accountant
import AccountantPayroll from '@/pages/accountant/Payroll'
import AccountantReports from '@/pages/accountant/Reports'
// Shared
import NotFoundPage from '@/pages/shared/NotFound'

function IndexRedirect() {
  const user = useAuthStore.getState().user
  return <Navigate to={user ? homeForRoles(user.roles) : '/login'} replace />
}

export const router = createBrowserRouter([
  { path: '/', element: <IndexRedirect /> },
  {
    path: '/login',
    element: <GuestOnly><LoginPage /></GuestOnly>,
  },

  /* ----------------------------- Cổng nhân viên ---------------------------- */
  {
    element: <RequireAuth><RequireRole roles={['Employee', 'Manager', 'HR', 'Director', 'Admin', 'Accountant']}><AppLayout /></RequireRole></RequireAuth>,
    children: [
      { path: '/employee', element: <EmployeeHome /> },
      { path: '/employee/attendance', element: <AttendancePage /> },
      { path: '/employee/timesheet', element: <RequirePermission permission="timesheet.detail.view_self"><TimesheetPage /></RequirePermission> },
      { path: '/employee/shift-schedule', element: <ShiftSchedulePage /> },
      { path: '/employee/leave-plan', element: <LeavePlanPage /> },
      { path: '/employee/requests', element: <RequestsPage /> },
      { path: '/employee/requests/:type/new', element: <RequestCreatePage /> },
      { path: '/employee/requests/:type/:id', element: <RequestDetailPage /> },
      { path: '/employee/approvals', element: <ApprovalsPage /> },
      { path: '/employee/salary', element: <RequirePermission permission="payroll.payslip.view_self"><SalaryPage /></RequirePermission> },
      { path: '/employee/profile', element: <ProfilePage /> },
      { path: '/employee/notifications', element: <NotificationsPage /> },
      { path: '/employee/leavers-today', element: <LeaversTodayPage /> },
      { path: '/employee/punch-options', element: <PunchOptionsPage /> },
      { path: '/employee/face-register', element: <FaceRegisterPage /> },
      { path: '/employee/face-punch', element: <FacePunchPage /> },
      { path: '/employee/delegation', element: <DelegationPage /> },
    ],
  },

  /* ------------------------------- Admin / HR ------------------------------ */
  {
    element: <RequireAuth><AppLayout /></RequireAuth>,
    children: [
      { path: '/admin/roles', element: <RequirePermission permission="config.permission.manage"><AdminRoles /></RequirePermission> },
    ],
  },
  {
    element: <RequireAuth><RequireRole roles={['HR', 'Admin']}><AppLayout /></RequireRole></RequireAuth>,
    children: [
      { path: '/admin/dashboard', element: <RequireAnyPermission permissions={['reports.attendance.view_scoped', 'reports.attendance.view_all']}><AdminDashboard /></RequireAnyPermission> },
      { path: '/admin/live', element: <AdminLive /> },
      { path: '/admin/employees', element: <AdminEmployees /> },
      { path: '/admin/departments', element: <AdminDepartments /> },
      { path: '/admin/shifts', element: <AdminShifts /> },
      { path: '/admin/shift-schedule', element: <AdminShiftSchedule /> },
      { path: '/admin/timesheet', element: <RequireAnyPermission permissions={['timesheet.detail.view_scoped', 'timesheet.detail.view_all']}><AdminTimesheet /></RequireAnyPermission> },
      { path: '/admin/summary-timesheet', element: <RequireAnyPermission permissions={['timesheet.summary.view_scoped', 'timesheet.summary.view_all']}><AdminSummaryTimesheet /></RequireAnyPermission> },
      { path: '/admin/requests', element: <AdminRequests /> },
      { path: '/admin/payroll', element: <RequirePermission permission="payroll.sheet.view"><AdminPayroll /></RequirePermission> },
      { path: '/admin/reports', element: <RequireAnyPermission permissions={['reports.attendance.view_scoped', 'reports.attendance.view_all']}><AdminReports /></RequireAnyPermission> },
      { path: '/admin/regulations/:tab?', element: <AdminRegulations /> },
      { path: '/admin/audit', element: <AdminAudit /> },
    ],
  },

  /* ------------------------------- Accountant ------------------------------ */
  {
    element: <RequireAuth><RequireRole roles={['Accountant', 'Admin']}><AppLayout /></RequireRole></RequireAuth>,
    children: [
      { path: '/accountant/payroll', element: <RequirePermission permission="payroll.sheet.view"><AccountantPayroll /></RequirePermission> },
      { path: '/accountant/reports', element: <RequirePermission permission="reports.payroll.view_detail"><AccountantReports /></RequirePermission> },
    ],
  },

  /* ------------------------------- Director -------------------------------- */
  {
    element: <RequireAuth><RequireRole roles={['Director', 'Admin']}><AppLayout /></RequireRole></RequireAuth>,
    children: [
      { path: '/director', element: <DirectorDashboard /> },
      { path: '/director/approvals', element: <DirectorApprovals /> },
      { path: '/director/payroll', element: <RequirePermission permission="reports.payroll.view_aggregate"><DirectorPayroll /></RequirePermission> },
      { path: '/director/reports', element: <RequireAnyPermission permissions={['reports.attendance.view_scoped', 'reports.attendance.view_all']}><DirectorReports /></RequireAnyPermission> },
    ],
  },

  { path: '*', element: <NotFoundPage /> },
])
