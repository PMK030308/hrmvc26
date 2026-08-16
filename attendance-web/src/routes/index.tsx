import { createBrowserRouter, Navigate } from 'react-router-dom'
import { RequireAuth, RequireRole, GuestOnly } from './guards'
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
      { path: '/employee/timesheet', element: <TimesheetPage /> },
      { path: '/employee/shift-schedule', element: <ShiftSchedulePage /> },
      { path: '/employee/leave-plan', element: <LeavePlanPage /> },
      { path: '/employee/requests', element: <RequestsPage /> },
      { path: '/employee/requests/:type/new', element: <RequestCreatePage /> },
      { path: '/employee/requests/:type/:id', element: <RequestDetailPage /> },
      { path: '/employee/approvals', element: <ApprovalsPage /> },
      { path: '/employee/salary', element: <SalaryPage /> },
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
    element: <RequireAuth><RequireRole roles={['HR', 'Admin']}><AppLayout /></RequireRole></RequireAuth>,
    children: [
      { path: '/admin/dashboard', element: <AdminDashboard /> },
      { path: '/admin/live', element: <AdminLive /> },
      { path: '/admin/employees', element: <AdminEmployees /> },
      { path: '/admin/departments', element: <AdminDepartments /> },
      { path: '/admin/shifts', element: <AdminShifts /> },
      { path: '/admin/shift-schedule', element: <AdminShiftSchedule /> },
      { path: '/admin/timesheet', element: <AdminTimesheet /> },
      { path: '/admin/summary-timesheet', element: <AdminSummaryTimesheet /> },
      { path: '/admin/requests', element: <AdminRequests /> },
      { path: '/admin/payroll', element: <AdminPayroll /> },
      { path: '/admin/reports', element: <AdminReports /> },
      { path: '/admin/regulations/:tab?', element: <AdminRegulations /> },
      { path: '/admin/roles', element: <AdminRoles /> },
      { path: '/admin/audit', element: <AdminAudit /> },
    ],
  },

  /* ------------------------------- Accountant ------------------------------ */
  {
    element: <RequireAuth><RequireRole roles={['Accountant', 'Admin']}><AppLayout /></RequireRole></RequireAuth>,
    children: [
      { path: '/accountant/payroll', element: <AccountantPayroll /> },
      { path: '/accountant/reports', element: <AccountantReports /> },
    ],
  },

  /* ------------------------------- Director -------------------------------- */
  {
    element: <RequireAuth><RequireRole roles={['Director', 'Admin']}><AppLayout /></RequireRole></RequireAuth>,
    children: [
      { path: '/director', element: <DirectorDashboard /> },
      { path: '/director/approvals', element: <DirectorApprovals /> },
      { path: '/director/payroll', element: <DirectorPayroll /> },
      { path: '/director/reports', element: <DirectorReports /> },
    ],
  },

  { path: '*', element: <NotFoundPage /> },
])