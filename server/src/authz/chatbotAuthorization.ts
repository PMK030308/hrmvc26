import type { AuthorizationActor } from './authorizationActor.js'
import { canListEmployees } from './organizationAuthorization.js'
import { canViewAttendanceReports } from './reportAuthorization.js'
import { ATTENDANCE_PERMISSIONS } from './attendanceAuthorization.js'
import { REQUEST_PERMISSIONS } from './requestAuthorization.js'

export const CHATBOT_PERMISSIONS = {
  USE: 'chatbot.use',
  REQUEST_CREATE_SELF: 'chatbot.request.create_self',
  EMPLOYEE_SEARCH_SCOPED: 'chatbot.employee.search_scoped',
  ATTENDANCE_VIEW_SELF: 'chatbot.attendance.view_self',
  ATTENDANCE_VIEW_SCOPED: 'chatbot.attendance.view_scoped',
  REQUEST_VIEW_SELF: 'chatbot.request.view_self',
  REQUEST_VIEW_SCOPED: 'chatbot.request.view_scoped',
  LEAVE_BALANCE_VIEW_SELF: 'chatbot.leave_balance.view_self',
  REPORT_VIEW_AGGREGATE: 'chatbot.report.view_aggregate',
} as const

export type ChatbotToolName =
  | 'get_my_profile'
  | 'get_my_attendance'
  | 'get_my_requests'
  | 'get_my_leave_balance'
  | 'get_ot_usage'
  | 'propose_create_request'
  | 'search_employees'
  | 'get_employee_detail'
  | 'get_dashboard_summary'

function has(actor: AuthorizationActor, permission: string): boolean {
  return actor.permissions.has(permission)
}

export function canUseChatbot(actor: AuthorizationActor): boolean {
  return has(actor, CHATBOT_PERMISSIONS.USE)
}

export function canUseChatbotTool(actor: AuthorizationActor, tool: ChatbotToolName): boolean {
  if (!canUseChatbot(actor)) return false
  switch (tool) {
    case 'get_my_profile':
      return true
    case 'get_my_attendance':
    case 'get_ot_usage':
      return has(actor, CHATBOT_PERMISSIONS.ATTENDANCE_VIEW_SELF)
        && has(actor, ATTENDANCE_PERMISSIONS.VIEW_SELF)
    case 'get_my_requests':
      return has(actor, CHATBOT_PERMISSIONS.REQUEST_VIEW_SELF)
        && has(actor, REQUEST_PERMISSIONS.VIEW_OWN)
    case 'get_my_leave_balance':
      return has(actor, CHATBOT_PERMISSIONS.LEAVE_BALANCE_VIEW_SELF)
    case 'propose_create_request':
      return has(actor, CHATBOT_PERMISSIONS.REQUEST_CREATE_SELF)
        && has(actor, REQUEST_PERMISSIONS.CREATE_OWN)
    case 'search_employees':
    case 'get_employee_detail':
      return has(actor, CHATBOT_PERMISSIONS.EMPLOYEE_SEARCH_SCOPED)
        && canListEmployees(actor)
    case 'get_dashboard_summary':
      return has(actor, CHATBOT_PERMISSIONS.REPORT_VIEW_AGGREGATE)
        && canViewAttendanceReports(actor)
  }
}
