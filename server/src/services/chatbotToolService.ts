import { z } from 'zod'
import { db } from '../db.js'
import { otUsedHours } from '../engines/request.js'
import { addDays, nowVn, ymd } from '../lib/date.js'
import type { FunctionDeclaration, GeminiContent } from '../lib/gemini.js'
import { getEmployee, getRegulation } from '../repo.js'
import { httpError } from '../types.js'
import { loadAuthorizationActor, type AuthorizationActor } from '../authz/authorizationActor.js'
import { canViewEmployee } from '../authz/organizationAuthorization.js'
import { canViewRequest } from '../authz/requestAuthorization.js'
import { loadRequestAuthorizationContext } from '../authz/requestAuthorizationContext.js'
import { canViewAttendanceReportEmployee } from '../authz/reportAuthorization.js'
import { canUseChatbotTool, type ChatbotToolName } from '../authz/chatbotAuthorization.js'

const TOOL_NAMES: ChatbotToolName[] = [
  'get_my_profile', 'get_my_attendance', 'get_my_requests', 'get_my_leave_balance',
  'get_ot_usage', 'propose_create_request', 'search_employees', 'get_employee_detail',
  'get_dashboard_summary',
]

const TOOL_DECLARATIONS: Record<ChatbotToolName, FunctionDeclaration> = {
  get_my_profile: { name: 'get_my_profile', description: 'Lấy hồ sơ cơ bản của chính người đang chat.', parameters: { type: 'object', properties: {} } },
  get_my_attendance: {
    name: 'get_my_attendance', description: 'Tra cứu chấm công của chính người đang chat trong khoảng ngày.',
    parameters: { type: 'object', properties: { fromDate: { type: 'string' }, toDate: { type: 'string' } } },
  },
  get_my_requests: {
    name: 'get_my_requests', description: 'Liệt kê đơn từ của chính người đang chat.',
    parameters: { type: 'object', properties: { type: { type: 'string' }, status: { type: 'string' } } },
  },
  get_my_leave_balance: { name: 'get_my_leave_balance', description: 'Xem quỹ phép của chính người đang chat.', parameters: { type: 'object', properties: {} } },
  get_ot_usage: { name: 'get_ot_usage', description: 'Xem tổng giờ OT của chính người đang chat.', parameters: { type: 'object', properties: { date: { type: 'string' } } } },
  propose_create_request: {
    name: 'propose_create_request', description: 'Chuẩn bị bản xem trước đơn; chưa ghi dữ liệu cho đến khi người dùng xác nhận.',
    parameters: {
      type: 'object', required: ['requestType', 'fields'],
      properties: { requestType: { type: 'string' }, fields: { type: 'object' } },
    },
  },
  search_employees: {
    name: 'search_employees', description: 'Tìm nhân viên trong phạm vi được cấp.',
    parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } },
  },
  get_employee_detail: {
    name: 'get_employee_detail', description: 'Xem thông tin cơ bản của một nhân viên trong phạm vi được cấp.',
    parameters: { type: 'object', required: ['employeeCode'], properties: { employeeCode: { type: 'string' } } },
  },
  get_dashboard_summary: { name: 'get_dashboard_summary', description: 'Xem tổng quan chấm công trong phạm vi báo cáo được cấp.', parameters: { type: 'object', properties: {} } },
}

const optionalDate = z.string().trim().optional()
const argsSchemas: Record<ChatbotToolName, z.ZodTypeAny> = {
  get_my_profile: z.object({}).passthrough(),
  get_my_attendance: z.object({ fromDate: optionalDate, toDate: optionalDate }).passthrough(),
  get_my_requests: z.object({ type: z.string().trim().optional(), status: z.string().trim().optional() }).passthrough(),
  get_my_leave_balance: z.object({}).passthrough(),
  get_ot_usage: z.object({ date: optionalDate }).passthrough(),
  propose_create_request: z.object({ requestType: z.string().trim().min(1), fields: z.record(z.any()) }).passthrough(),
  search_employees: z.object({ query: z.string().trim().min(1) }).passthrough(),
  get_employee_detail: z.object({ employeeCode: z.string().trim().min(1) }).passthrough(),
  get_dashboard_summary: z.object({}).passthrough(),
}

const VALID_TYPES = ['leaves', 'late-earlies', 'overtimes', 'business-trips', 'shift-swaps', 'attendance-updates']
const REQUEST_STATUS_LABEL: Record<number, string> = { 1: 'Nháp', 2: 'Chờ duyệt', 3: 'Đã duyệt', 4: 'Từ chối', 5: 'Đã hủy', 6: 'Chờ đồng nghiệp xác nhận', 7: 'Đồng nghiệp từ chối', 8: 'Chờ phê duyệt' }
const REQUEST_TYPE_LABEL: Record<string, string> = { leaves: 'nghỉ phép', 'late-earlies': 'đi muộn/về sớm', overtimes: 'làm thêm (OT)', 'business-trips': 'công tác', 'shift-swaps': 'đổi ca', 'attendance-updates': 'cập nhật công' }
const ATT_STATUS_LABEL: Record<number, string> = { 1: 'Đúng giờ', 2: 'Đi muộn', 3: 'Về sớm', 4: 'Vắng mặt', 5: 'Có mặt', 6: 'Nửa ngày' }

function normalizeDate(input: unknown): string | null {
  if (!input) return null
  const value = String(input).trim()
  let match = value.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/)
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
  match = value.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/)
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : null
}

function departmentName(id: string | null | undefined): string {
  return id ? ((db.prepare('SELECT name FROM departments WHERE id=?').get(id) as any)?.name ?? '—') : '—'
}

function positionName(id: string | null | undefined): string {
  return id ? ((db.prepare('SELECT name FROM positions WHERE id=?').get(id) as any)?.name ?? '—') : '—'
}

function requestSummary(row: any): string {
  switch (row.type) {
    case 'leaves': return `${row.leave_type_name ?? 'nghỉ'} từ ${row.start_date} đến ${row.end_date} (${row.total_days} ngày)`
    case 'late-earlies': return `${row.late_early_type === 2 ? 'về sớm' : 'đi muộn'} lúc ${row.requested_time} ngày ${row.request_date}`
    case 'overtimes': return `OT ${row.start_time}-${row.end_time} ngày ${row.ot_date} (${row.total_hours}h)`
    case 'business-trips': return `công tác ${row.location ?? ''} từ ${row.start_date} đến ${row.end_date}`
    case 'shift-swaps': return `đổi ca ngày ${row.request_date}`
    case 'attendance-updates': return `cập nhật công ngày ${row.request_date}`
    default: return ''
  }
}

export interface ChatbotToolExecutionOptions {
  onDraft?: (draft: Record<string, any>) => void
  buildRequestDraft?: (requestType: string, fields: Record<string, any>, actor: AuthorizationActor) => {
    ok: boolean; payload: Record<string, any>; errors: string[]; summary: Record<string, any>
  }
}

export function buildAuthorizedTools(actor: AuthorizationActor): FunctionDeclaration[] {
  const freshActor = loadAuthorizationActor(actor.userId)
  return TOOL_NAMES.filter((name) => canUseChatbotTool(freshActor, name)).map((name) => TOOL_DECLARATIONS[name])
}

export async function executeAuthorizedTool(
  actor: AuthorizationActor,
  name: string,
  rawArgs: unknown,
  options: ChatbotToolExecutionOptions = {},
): Promise<Record<string, any>> {
  const freshActor = loadAuthorizationActor(actor.userId)
  if (!TOOL_NAMES.includes(name as ChatbotToolName)) throw httpError(403, 'Tool không được phép.')
  const tool = name as ChatbotToolName
  if (!canUseChatbotTool(freshActor, tool)) throw httpError(403, 'Bạn không có quyền sử dụng chức năng chatbot này.')
  const parsed = argsSchemas[tool].safeParse(rawArgs ?? {})
  if (!parsed.success) throw httpError(400, 'Tham số tool không hợp lệ.')
  const args = parsed.data as Record<string, any>

  switch (tool) {
    case 'get_my_profile': {
      const employee = getEmployee(freshActor.employeeId)
      if (!employee) throw httpError(404, 'Không tìm thấy hồ sơ.')
      return { fullName: employee.fullName, employeeCode: employee.employeeCode, email: employee.email, phone: employee.phone, department: departmentName(employee.departmentId), position: positionName(employee.positionId), hireDate: employee.hireDate, contractType: employee.contractType, status: employee.status === 2 ? 'Đang làm việc' : 'Không hoạt động' }
    }
    case 'get_my_attendance': {
      const to = normalizeDate(args.toDate) ?? ymd(nowVn())
      const from = normalizeDate(args.fromDate) ?? ymd(addDays(nowVn(), -6))
      const rows = db.prepare(`SELECT date, shift_name, check_in_time, check_out_time, actual_work_hours,
        late_minutes, early_leave_minutes, overtime_hours, status FROM attendance_records
        WHERE employee_id=? AND date>=? AND date<=? AND is_active=1 ORDER BY date DESC`).all(freshActor.employeeId, from, to) as any[]
      if (!rows.length) return { message: `Không có dữ liệu chấm công từ ${from} đến ${to}.` }
      return { from, to, records: rows.map((row) => ({ date: row.date, shiftName: row.shift_name ?? '—', checkIn: row.check_in_time ?? '(chưa)', checkOut: row.check_out_time ?? '(chưa)', workHours: row.actual_work_hours ?? 0, lateMinutes: row.late_minutes ?? 0, earlyLeaveMinutes: row.early_leave_minutes ?? 0, overtimeHours: row.overtime_hours ?? 0, status: ATT_STATUS_LABEL[row.status] ?? row.status })) }
    }
    case 'get_my_requests': {
      let rows = db.prepare('SELECT * FROM requests WHERE employee_id=?').all(freshActor.employeeId) as any[]
      rows = rows.filter((row) => {
        const context = loadRequestAuthorizationContext(row.type, row.id)
        return !!context && canViewRequest(freshActor, context)
      })
      if (args.type && VALID_TYPES.includes(args.type)) rows = rows.filter((row) => row.type === args.type)
      if (args.status) {
        const query = String(args.status).toLowerCase()
        rows = rows.filter((row) => String(REQUEST_STATUS_LABEL[row.status] ?? row.status).toLowerCase().includes(query))
      }
      rows = rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 20)
      if (!rows.length) return { message: 'Bạn chưa có đơn từ nào.' }
      return { total: rows.length, requests: rows.map((row) => ({ type: REQUEST_TYPE_LABEL[row.type] ?? row.type, id: row.id.slice(-6), status: REQUEST_STATUS_LABEL[row.status] ?? row.status, createdAt: row.created_at, summary: requestSummary(row) })) }
    }
    case 'get_my_leave_balance': {
      const year = nowVn().getFullYear()
      const rows = (db.prepare('SELECT * FROM leave_balances WHERE employee_id=? AND year=?').all(freshActor.employeeId, year) as any[])
        .map((row) => ({ loai: row.leave_type_name, daCap: row.allocated_days, daDung: row.used_days, dangCho: row.pending_days, conLai: (row.allocated_days ?? 0) - (row.used_days ?? 0) }))
      return rows.length ? { year, balances: rows } : { message: `Chưa có dữ liệu quỹ phép năm ${year}.` }
    }
    case 'get_ot_usage': {
      const date = normalizeDate(args.date) ?? ymd(nowVn())
      const regulation = getRegulation()
      const { monthUsed, yearUsed } = otUsedHours(freshActor.employeeId, date)
      const monthCap = regulation?.otMonthlyCapHours ?? 40
      return { date, monthUsed, yearUsed, monthCap, yearCap: regulation?.otYearlyCapHours ?? 200, monthRemaining: Math.max(0, monthCap - monthUsed) }
    }
    case 'search_employees': {
      const query = String(args.query).toLowerCase()
      const rows = (db.prepare(`SELECT e.id, e.employee_code, e.full_name, e.status, e.department_id, e.position_id
        FROM employees e ORDER BY e.full_name`).all() as any[])
        .filter((row) => canViewEmployee(freshActor, { id: row.id, departmentId: row.department_id }))
        .filter((row) => String(row.full_name).toLowerCase().includes(query) || String(row.employee_code).toLowerCase().includes(query))
        .slice(0, 10)
      if (!rows.length) return { message: 'Không tìm thấy nhân viên phù hợp.' }
      return { employees: rows.map((row) => ({ code: row.employee_code, name: row.full_name, department: departmentName(row.department_id), position: positionName(row.position_id), status: row.status === 2 ? 'Đang làm việc' : 'Ngừng việc' })) }
    }
    case 'get_employee_detail': {
      const query = String(args.employeeCode).toLowerCase()
      const candidates = db.prepare(`SELECT e.id, e.employee_code, e.full_name, e.status, e.department_id, e.position_id
        FROM employees e WHERE lower(e.employee_code)=? OR lower(e.full_name) LIKE ? ORDER BY e.full_name LIMIT 20`).all(query, `%${query}%`) as any[]
      const employee = candidates.find((row) => canViewEmployee(freshActor, { id: row.id, departmentId: row.department_id }))
      if (!employee) throw httpError(404, 'Không tìm thấy nhân viên.')
      return { code: employee.employee_code, name: employee.full_name, department: departmentName(employee.department_id), position: positionName(employee.position_id), status: employee.status === 2 ? 'Đang làm việc' : 'Không hoạt động' }
    }
    case 'get_dashboard_summary': {
      const today = ymd(nowVn())
      const employees = (db.prepare('SELECT id, department_id FROM employees WHERE status=2').all() as any[])
        .filter((row) => canViewAttendanceReportEmployee(freshActor, { id: row.id, departmentId: row.department_id }))
      const ids = new Set(employees.map((row) => row.id))
      const records = (db.prepare('SELECT employee_id, check_in_time, late_minutes, status FROM attendance_records WHERE date=? AND is_active=1').all(today) as any[])
        .filter((row) => ids.has(row.employee_id))
      const checkedIn = records.filter((row) => row.check_in_time != null).length
      const onTime = records.filter((row) => row.status === 1).length
      return { date: today, totalEmployees: employees.length, checkedInToday: checkedIn, onTime, lateToday: records.filter((row) => row.late_minutes > 0).length, absentToday: Math.max(0, employees.length - checkedIn), onTimeRate: checkedIn ? Math.round((onTime / checkedIn) * 100) : 0 }
    }
    case 'propose_create_request': {
      if (!options.buildRequestDraft) throw httpError(503, 'Chức năng tạo bản nháp chưa sẵn sàng.')
      const result = options.buildRequestDraft(String(args.requestType), args.fields, freshActor)
      if (!result.ok) return { error: `Thiếu thông tin: ${result.errors.join(', ')}.`, missing: result.errors }
      const draft = { requestType: args.requestType, fields: result.payload, summary: result.summary }
      options.onDraft?.(draft)
      return { ok: true, preview: result.summary, note: 'Đã chuẩn bị bản nháp. Cần người dùng xác nhận trước khi tạo.' }
    }
  }
}

export function sanitizeChatHistory(history: unknown): { role: 'user' | 'assistant'; content: string }[] {
  if (!Array.isArray(history)) return []
  const accepted = history.flatMap((message): { role: 'user' | 'assistant'; content: string }[] => {
    if (!message || typeof message !== 'object') return []
    const role = (message as any).role
    if (role !== 'user' && role !== 'assistant') return []
    const content = typeof (message as any).content === 'string' ? (message as any).content.slice(0, 2000) : ''
    return content ? [{ role, content }] : []
  }).slice(-20)
  if (accepted.length === 0) return []
  const perMessageLimit = Math.min(2000, Math.floor(12000 / accepted.length))
  return accepted.map((message) => ({ ...message, content: message.content.slice(0, perMessageLimit) }))
}

export function toGeminiHistory(history: unknown): GeminiContent[] {
  return sanitizeChatHistory(history).map((message) => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] }))
}
