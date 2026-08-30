// ============================================================================
// API — Chấm công (§14.2 / §14.3 / §14.4) — HTTP.
// ============================================================================
import { api } from './http'
import type {
  PunchSource, PunchResponse, AttendanceToday, AttendanceRecord, AttendancePunch,
  Shift, LeavePlan, AttendanceRegulation, EmployeeDashboard,
} from '@/types'

export const attendanceApi = {
  punch(payload: {
    source: PunchSource; latitude?: number; longitude?: number; accuracy?: number;
    wifiSsid?: string; notes?: string; snapshotBase64?: string | null;
  }): Promise<PunchResponse> {
    return api.post('/attendance/punch', payload)
  },

  today(): Promise<AttendanceToday> { return api.get('/attendance/today') },

  detail(date: string): Promise<{ record: AttendanceRecord | null; punches: AttendancePunch[]; shift: Shift | null }> {
    return api.get(`/attendance/detail/${date}`)
  },

  timesheet(params: { year: number; month: number; mode: 'week' | 'month'; half?: 1 | 2; weekIndex?: number }): Promise<{
    days: { date: string; record: AttendanceRecord | null; shift: Shift | null }[]; summary: {
      totalPaidUnits: number; totalOtHours: number; lateEarlyCount: number; totalOffOrAbsent: number; workHours: number
    }
  }> {
    return api.get('/attendance/timesheet', params)
  },

  shiftSchedule(params: { year: number; month: number }): Promise<{ date: string; shift: Shift | null }[]> {
    return api.get('/attendance/shift-schedule', params)
  },

  leavePlan(): Promise<LeavePlan> { return api.get('/attendance/leave-plan') },

  leaversToday(): Promise<{ employee: { id: string; fullName: string; employeeCode: string }; leaveType: string }[]> {
    return api.get('/attendance/leavers-today')
  },

  punchOptions(): Promise<{ regulation: AttendanceRegulation }> { return api.get('/attendance/punch-options') },

  proxyPunch(payload: { targetEmployeeId: string; source: PunchSource; reason: string; latitude?: number; longitude?: number; wifiSsid?: string }): Promise<PunchResponse> {
    return api.post('/attendance/proxy-punch', payload)
  },

  confirmTimesheet(payload: { summaryTimesheetDetailId: string; status: 2 | 3; comment?: string }): Promise<{ ok: true }> {
    return api.post('/attendance/confirm-timesheet', payload)
  },

  dashboard(): Promise<EmployeeDashboard> { return api.get('/attendance/dashboard') },
}
