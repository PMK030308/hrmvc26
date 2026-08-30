// ============================================================================
// CHATBOT ROUTE — trợ lý ảo HRM (tra cứu thông tin + tạo đơn tự động).
// Bộ não: Gemini function-calling. Backend thực thi các "tool" truy vấn DB /
// đề nghị tạo đơn. Key Gemini nằm trên server (không lộ ra frontend).
// ============================================================================
import { Router } from 'express'
import { db } from '../db.js'
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js'
import { REQUEST_PERMISSIONS } from '../authz/requestAuthorization.js'
import { CHATBOT_PERMISSIONS } from '../authz/chatbotAuthorization.js'
import type { AuthorizationActor } from '../authz/authorizationActor.js'
import { listEligibleShiftSwapPartners } from '../authz/shiftSwapPartnerAuthorization.js'
import { httpError } from '../types.js'
import { runChat, hasGeminiKey, type FunctionDeclaration, type GeminiContent } from '../lib/gemini.js'
import { createRequest } from '../engines/request.js'
import { otUsedHours } from '../engines/request.js'
import {
  getEmployee, allEmployees, getRecord, getLeaveType, getRegulation, mapRequest,
} from '../repo.js'
import { ymd, nowVn, addDays, parseISO } from '../lib/date.js'
import { pushAudit } from '../helpers.js'
import { buildAuthorizedTools, executeAuthorizedTool, toGeminiHistory } from '../services/chatbotToolService.js'

export const chatbotRouter = Router()

const VALID_TYPES = ['leaves', 'late-earlies', 'overtimes', 'business-trips', 'shift-swaps', 'attendance-updates']

const REQUEST_STATUS_LABEL: Record<number, string> = {
  1: 'Nháp', 2: 'Chờ duyệt', 3: 'Đã duyệt', 4: 'Từ chối', 5: 'Đã hủy',
  6: 'Chờ đồng nghiệp xác nhận', 7: 'Đồng nghiệp từ chối', 8: 'Chờ phê duyệt',
}
const REQUEST_TYPE_LABEL: Record<string, string> = {
  leaves: 'nghỉ phép', 'late-earlies': 'đi muộn/về sớm', overtimes: 'làm thêm (OT)',
  'business-trips': 'công tác', 'shift-swaps': 'đổi ca', 'attendance-updates': 'cập nhật công',
}
const ATT_STATUS_LABEL: Record<number, string> = {
  1: 'Đúng giờ', 2: 'Đi muộn', 3: 'Về sớm', 4: 'Vắng mặt', 5: 'Có mặt', 6: 'Nửa ngày',
}

/* ----------------------------- Tiện ích ----------------------------------- */
/** Chuẩn hoá ngày về YYYY-MM-DD (chấp nhận dd/mm/yyyy, dd-mm-yyyy, hoặc ISO). */
function normalizeDate(input: any): string | null {
  if (!input) return null
  const s = String(input).trim()
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return null
}
/** Chuẩn hoá giờ về HH:mm. */
function normalizeTime(input: any): string | null {
  if (!input) return null
  const s = String(input).trim()
  const m = s.match(/^(\d{1,2}):?(\d{2})?$/)
  if (!m) return null
  return `${m[1].padStart(2, '0')}:${m[2] ?? '00'}`
}
function deptName(id: string | null | undefined): string {
  if (!id) return '—'
  const d = db.prepare('SELECT name FROM departments WHERE id=?').get(id) as any
  return d?.name ?? '—'
}
function positionName(id: string | null | undefined): string {
  if (!id) return '—'
  const p = db.prepare('SELECT name FROM positions WHERE id=?').get(id) as any
  return p?.name ?? '—'
}

/* ----------------------- Xây payload tạo đơn (từ trường thân thiện) ------- */
interface FieldErrors { ok: boolean; payload: Record<string, any>; errors: string[]; summary: Record<string, any> }

function resolveLeaveTypeByName(name: any): any | null {
  if (!name) return null
  const q = String(name).toLowerCase().trim()
  const rows = db.prepare('SELECT * FROM leave_types').all() as any[]
  return rows.find((r) => r.name.toLowerCase().includes(q) || q.includes(r.name.toLowerCase())) ?? null
}
function resolveEmployeeByName(code: any): any | null {
  if (!code) return null
  const q = String(code).toLowerCase().trim()
  const rows = db.prepare('SELECT * FROM employees').all() as any[]
  return rows.find((r) =>
    (r.full_name ?? '').toLowerCase().includes(q) ||
    (r.employee_code ?? '').toLowerCase() === q ||
    (r.email ?? '').toLowerCase().includes(q)) ?? null
}

function buildPayload(type: string, f: Record<string, any>, actor?: AuthorizationActor): FieldErrors {
  const errors: string[] = []
  const payload: Record<string, any> = {}
  const summary: Record<string, any> = { requestType: type, typeLabel: REQUEST_TYPE_LABEL[type] ?? type }

  if (type === 'leaves') {
    let lt: any = null
    if (f.leaveTypeId) lt = getLeaveType(f.leaveTypeId)
    if (!lt) lt = resolveLeaveTypeByName(f.leaveTypeName ?? f.leaveType)
    if (!lt) errors.push('loại nghỉ phép (vd: "nghỉ phép năm", "nghỉ ốm đau", "nghỉ không lương")')
    else { payload.leaveTypeId = lt.id; summary.leaveTypeName = lt.name }
    const start = normalizeDate(f.startDate ?? f.from)
    const end = normalizeDate(f.endDate ?? f.to)
    if (!start) errors.push('ngày bắt đầu')
    if (!end) errors.push('ngày kết thúc')
    if (start && end) { payload.startDate = start; payload.endDate = end; summary.startDate = start; summary.endDate = end }
    payload.reason = f.reason ?? f.note ?? ''; summary.reason = payload.reason
  } else if (type === 'late-earlies') {
    const date = normalizeDate(f.requestDate ?? f.date)
    if (!date) errors.push('ngày')
    else { payload.requestDate = date; summary.requestDate = date }
    const typeLabel = String(f.lateEarlyType ?? f.type ?? '').toLowerCase()
    payload.lateEarlyType = typeLabel.includes('sớm') ? 2 : 1
    summary.lateEarlyType = payload.lateEarlyType === 2 ? 'Về sớm' : 'Đi muộn'
    const t = normalizeTime(f.requestedTime ?? f.time)
    if (!t) errors.push('thời gian (VD 09:15)')
    else { payload.requestedTime = t; summary.requestedTime = t }
    payload.minutes = Number(f.minutes ?? 0) || undefined
    payload.reason = f.reason ?? f.note ?? ''; summary.reason = payload.reason
  } else if (type === 'overtimes') {
    const date = normalizeDate(f.otDate ?? f.date)
    if (!date) errors.push('ngày làm thêm')
    else { payload.otDate = date; summary.otDate = date }
    const st = normalizeTime(f.startTime ?? f.from)
    const et = normalizeTime(f.endTime ?? f.to)
    if (!st) errors.push('giờ bắt đầu')
    if (!et) errors.push('giờ kết thúc')
    if (st && et) { payload.startTime = st; payload.endTime = et; summary.startTime = st; summary.endTime = et }
    const compLabel = String(f.compensationType ?? f.compensation ?? 'trả lương').toLowerCase()
    payload.compensationType = compLabel.includes('bù') && compLabel.includes('lương') ? 3
      : compLabel.includes('bù') ? 2 : 1
    summary.compensationType = payload.compensationType === 3 ? 'Lương + Bù' : payload.compensationType === 2 ? 'Bù nghỉ' : 'Trả lương'
    payload.reason = f.reason ?? f.note ?? ''; summary.reason = payload.reason
  } else if (type === 'business-trips') {
    const start = normalizeDate(f.startDate ?? f.from)
    const end = normalizeDate(f.endDate ?? f.to)
    if (!start) errors.push('ngày bắt đầu')
    if (!end) errors.push('ngày kết thúc')
    if (start && end) { payload.startDate = start; payload.endDate = end; summary.startDate = start; summary.endDate = end }
    payload.location = f.location ?? ''; summary.location = payload.location
    payload.purpose = f.purpose ?? f.reason ?? f.note ?? ''; summary.purpose = payload.purpose
    if (!payload.location) errors.push('địa điểm công tác')
  } else if (type === 'shift-swaps') {
    const date = normalizeDate(f.requestDate ?? f.date)
    if (!date) errors.push('ngày muốn đổi ca')
    else { payload.requestedDate = date; summary.requestDate = date }
    const modeLabel = String(f.shiftSwapMode ?? f.mode ?? '').toLowerCase()
    payload.shiftSwapMode = modeLabel.includes('đồng nghiệp') || modeLabel.includes('partner') ? 2 : 1
    summary.shiftSwapMode = payload.shiftSwapMode === 2 ? 'Đổi với đồng nghiệp' : 'Tự đổi ca'
    if (payload.shiftSwapMode === 2) {
      const partners = actor ? listEligibleShiftSwapPartners(actor) : []
      const query = String(f.partnerName ?? f.partner ?? '').toLowerCase().trim()
      const partner = partners.find((candidate) => candidate.id === f.suggestedSwapPartnerId)
        ?? partners.find((candidate) => candidate.code.toLowerCase() === query || candidate.name.toLowerCase().includes(query))
      if (!partner) errors.push('tên/mã đồng nghiệp đổi ca')
      else { payload.suggestedSwapPartnerId = partner.id; summary.partnerName = partner.name }
    }
    payload.reason = f.reason ?? f.note ?? ''; summary.reason = payload.reason
  } else if (type === 'attendance-updates') {
    const date = normalizeDate(f.requestDate ?? f.date)
    if (!date) errors.push('ngày cần cập nhật')
    else { payload.requestDate = date; summary.requestDate = date }
    const ul = String(f.updateType ?? f.type ?? '').toLowerCase()
    payload.updateType = ul.includes('xoá') || ul.includes('xoa') ? 3 : ul.includes('sửa') || ul.includes('sua') ? 2 : 1
    summary.updateType = payload.updateType === 3 ? 'Xóa bản ghi' : payload.updateType === 2 ? 'Sửa giờ chấm' : 'Thêm bản ghi'
    if (payload.updateType !== 3) {
      const cin = normalizeTime(f.newCheckInTime ?? f.checkIn)
      const cout = normalizeTime(f.newCheckOutTime ?? f.checkOut)
      if (cin) { payload.newCheckInTime = cin; summary.newCheckInTime = cin }
      if (cout) { payload.newCheckOutTime = cout; summary.newCheckOutTime = cout }
    }
    payload.reason = f.reason ?? f.note ?? ''; summary.reason = payload.reason
  }

  return { ok: errors.length === 0, payload, errors, summary }
}

/* ----------------------------- Tools (tra cứu) ---------------------------- */
function isManagerLike(roles: string[]): boolean {
  return roles.some((r) => ['Manager', 'HR', 'Director', 'Admin', 'Accountant'].includes(r))
}

function buildTools(roles: string[]): FunctionDeclaration[] {
  const tools: FunctionDeclaration[] = [
    {
      name: 'get_my_profile', description: 'Lấy hồ sơ cá nhân của nhân viên đang chat (chính người dùng).',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'get_my_attendance',
      description: 'Tra cứu chấm công của chính người dùng trong khoảng ngày. Trả về check-in/out, giờ làm, muộn/sớm, trạng thái.',
      parameters: {
        type: 'object',
        properties: {
          fromDate: { type: 'string', description: 'YYYY-MM-DD hoặc dd/mm/yyyy. Mặc định 7 ngày trước.' },
          toDate: { type: 'string', description: 'YYYY-MM-DD hoặc dd/mm/yyyy. Mặc định hôm nay.' },
        },
      },
    },
    {
      name: 'get_my_requests',
      description: 'Liệt kê đơn từ của chính người dùng (nghỉ phép, muộn/sớm, OT, công tác, đổi ca, cập nhật công). Có thể lọc theo loại và trạng thái.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Một trong: leaves, late-earlies, overtimes, business-trips, shift-swaps, attendance-updates' },
          status: { type: 'string', description: 'Trạng thái tiếng Việt: chờ duyệt, đã duyệt, từ chối, đã hủy...' },
        },
      },
    },
    {
      name: 'get_my_leave_balance',
      description: 'Xem quỹ phép / số ngày phép còn lại của chính người dùng theo năm.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'get_ot_usage',
      description: 'Xem tổng giờ làm thêm (OT) đã dùng trong tháng/năm của chính người dùng và hạn mức.',
      parameters: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD. Mặc định hôm nay.' } } },
    },
    {
      name: 'propose_create_request',
      description: 'Đề nghị tạo một đơn từ (chưa ghi vào DB — chỉ tạo bản nháp để xác nhận). Dùng khi người dùng muốn xin nghỉ phép, làm thêm, công tác, đổi ca, muộn/sớm, cập nhật công. Phải điền đủ các trường bắt buộc; nếu thiếu hãy hỏi người dùng trước khi gọi.',
      parameters: {
        type: 'object',
        properties: {
          requestType: { type: 'string', description: 'Một trong: leaves, late-earlies, overtimes, business-trips, shift-swaps, attendance-updates' },
          fields: {
            type: 'object',
            description: 'Các trường của đơn. Ngày theo YYYY-MM-DD (hoặc dd/mm/yyyy), giờ theo HH:mm.',
            properties: {
              leaveTypeName: { type: 'string', description: 'leaves: tên loại nghỉ (vd "nghỉ phép năm", "nghỉ ốm đau", "nghỉ không lương", "nghỉ thai sản")' },
              startDate: { type: 'string' }, endDate: { type: 'string' },
              requestDate: { type: 'string' }, lateEarlyType: { type: 'string', description: '"đi muộn" hoặc "về sớm"' },
              requestedTime: { type: 'string' }, minutes: { type: 'number' },
              otDate: { type: 'string' }, startTime: { type: 'string' }, endTime: { type: 'string' },
              compensationType: { type: 'string', description: '"trả lương", "bù nghỉ", "lương + bù"' },
              location: { type: 'string' }, purpose: { type: 'string' },
              shiftSwapMode: { type: 'string', description: '"tự đổi ca" hoặc "đổi với đồng nghiệp"' },
              partnerName: { type: 'string', description: 'tên/mã đồng nghiệp (khi đổi với đồng nghiệp)' },
              updateType: { type: 'string', description: '"thêm bản ghi", "sửa giờ chấm", "xóa bản ghi"' },
              newCheckInTime: { type: 'string' }, newCheckOutTime: { type: 'string' },
              reason: { type: 'string', description: 'lý do / ghi chú' },
            },
          },
        },
        required: ['requestType', 'fields'],
      },
    },
  ]

  if (isManagerLike(roles)) {
    tools.push({
      name: 'search_employees',
      description: 'Tìm kiếm nhân viên theo tên / mã nhân viên / email. Dành cho quản lý/HR/Admin.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    })
    tools.push({
      name: 'get_employee_detail',
      description: 'Xem chi tiết một nhân viên (hồ sơ + chấm công gần đây). Dành cho quản lý/HR/Admin.',
      parameters: { type: 'object', properties: { employeeCode: { type: 'string', description: 'mã NV hoặc tên' } }, required: ['employeeCode'] },
    })
  }
  if (roles.some((r) => ['HR', 'Admin', 'Director'].includes(r))) {
    tools.push({
      name: 'get_dashboard_summary',
      description: 'Tổng quan chấm công hôm nay (số NV đã chấm, đúng giờ, muộn, vắng, đơn chờ duyệt). Dành cho HR/Admin/Giám đốc.',
      parameters: { type: 'object', properties: {} },
    })
  }
  return tools
}

/* ------------------------- Thực thi tool (đóng req.user) ----------------- */
function makeToolExecutor(userId: string, employeeId: string, roles: string[], onDraft: (d: any) => void) {
  return async (name: string, args: Record<string, any>): Promise<Record<string, any>> => {
    switch (name) {
      case 'get_my_profile': {
        const e = getEmployee(employeeId)
        if (!e) return { error: 'Không tìm thấy hồ sơ.' }
        return {
          fullName: e.fullName, employeeCode: e.employeeCode, email: e.email, phone: e.phone,
          department: deptName(e.departmentId), position: positionName(e.positionId),
          hireDate: e.hireDate, contractType: e.contractType, status: e.status === 2 ? 'Đang làm việc' : 'Không hoạt động',
        }
      }
      case 'get_my_attendance': {
        const to = normalizeDate(args.toDate) ?? ymd(nowVn())
        const from = normalizeDate(args.fromDate) ?? ymd(addDays(nowVn(), -6))
        const rows = (db.prepare('SELECT * FROM attendance_records WHERE employee_id=? AND date>=? AND date<=? ORDER BY date DESC').all(employeeId, from, to) as any[])
          .filter((r) => r.is_active)
        if (!rows.length) return { message: `Không có dữ liệu chấm công từ ${from} đến ${to}.` }
        return {
          from, to,
          records: rows.map((r) => ({
            date: r.date, shiftName: r.shift_name ?? '—',
            checkIn: r.check_in_time ?? '(chưa)', checkOut: r.check_out_time ?? '(chưa)',
            workHours: r.actual_work_hours ?? 0, lateMinutes: r.late_minutes ?? 0,
            earlyLeaveMinutes: r.early_leave_minutes ?? 0, overtimeHours: r.overtime_hours ?? 0,
            status: ATT_STATUS_LABEL[r.status] ?? r.status,
          })),
        }
      }
      case 'get_my_requests': {
        let rows = db.prepare('SELECT * FROM requests WHERE employee_id=?').all(employeeId) as any[]
        if (args.type && VALID_TYPES.includes(args.type)) rows = rows.filter((r) => r.type === args.type)
        if (args.status) {
          const s = String(args.status).toLowerCase()
          const map: Record<string, number> = { 'chờ duyệt': 2, 'cho duyet': 2, 'đã duyệt': 3, 'da duyet': 3, 'từ chối': 4, 'tu choi': 4, 'đã hủy': 5, 'da huy': 5 }
          const target = map[s] ?? Object.entries(REQUEST_STATUS_LABEL).find(([, v]) => v.toLowerCase() === s)?.[0]
          if (target) rows = rows.filter((r) => r.status === Number(target))
        }
        rows = rows.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20)
        if (!rows.length) return { message: 'Bạn chưa có đơn từ nào.' }
        return {
          total: rows.length,
          requests: rows.map((r) => ({
            type: REQUEST_TYPE_LABEL[r.type] ?? r.type, id: r.id.slice(-6),
            status: REQUEST_STATUS_LABEL[r.status] ?? r.status, createdAt: r.created_at,
            summary: reqShortSummary(r),
          })),
        }
      }
      case 'get_my_leave_balance': {
        const year = nowVn().getFullYear()
        const rows = (db.prepare('SELECT * FROM leave_balances WHERE employee_id=? AND year=?').all(employeeId, year) as any[])
          .map((r) => ({ loai: r.leave_type_name, daCap: r.allocated_days, daDung: r.used_days, dangCho: r.pending_days, conLai: (r.allocated_days ?? 0) - (r.used_days ?? 0) }))
        if (!rows.length) return { message: `Chưa có dữ liệu quỹ phép năm ${year}.` }
        return { year, balances: rows }
      }
      case 'get_ot_usage': {
        const date = normalizeDate(args.date) ?? ymd(nowVn())
        const reg = getRegulation()
        const { monthUsed, yearUsed } = otUsedHours(employeeId, date)
        return {
          date, monthUsed, yearUsed,
          monthCap: reg?.otMonthlyCapHours ?? 40, yearCap: reg?.otYearlyCapHours ?? 200,
          monthRemaining: Math.max(0, (reg?.otMonthlyCapHours ?? 40) - monthUsed),
        }
      }
      case 'search_employees': {
        if (!isManagerLike(roles)) return { error: 'Bạn không có quyền tra cứu nhân viên.' }
        const q = String(args.query ?? '').toLowerCase().trim()
        if (!q) return { error: 'Thiếu từ khoá tìm kiếm.' }
        const rows = allEmployees().filter((e) =>
          e.fullName.toLowerCase().includes(q) || e.employeeCode.toLowerCase().includes(q) || (e.email ?? '').toLowerCase().includes(q))
          .slice(0, 10)
        if (!rows.length) return { message: 'Không tìm thấy nhân viên phù hợp.' }
        return { employees: rows.map((e) => ({ code: e.employeeCode, name: e.fullName, email: e.email, department: deptName(e.departmentId), position: positionName(e.positionId), status: e.status === 2 ? 'Đang làm việc' : 'Ngừng việc' })) }
      }
      case 'get_employee_detail': {
        if (!isManagerLike(roles)) return { error: 'Bạn không có quyền.' }
        const emp = resolveEmployeeByName(args.employeeCode)
        if (!emp) return { error: 'Không tìm thấy nhân viên.' }
        const e = getEmployee(emp.id)!
        const today = ymd(nowVn())
        const recs = (db.prepare('SELECT * FROM attendance_records WHERE employee_id=? AND date>=? ORDER BY date DESC LIMIT 7').all(e.id, ymd(addDays(nowVn(), -7))) as any[])
        return {
          code: e.employeeCode, name: e.fullName, email: e.email, phone: e.phone,
          department: deptName(e.departmentId), position: positionName(e.positionId), hireDate: e.hireDate,
          status: e.status === 2 ? 'Đang làm việc' : 'Không hoạt động',
          recentAttendance: recs.map((r) => ({ date: r.date, checkIn: r.check_in_time ?? '(chưa)', checkOut: r.check_out_time ?? '(chưa)', status: ATT_STATUS_LABEL[r.status] ?? r.status })),
        }
      }
      case 'get_dashboard_summary': {
        if (!roles.some((r) => ['HR', 'Admin', 'Director'].includes(r))) return { error: 'Bạn không có quyền.' }
        const today = ymd(nowVn())
        const active = (db.prepare('SELECT COUNT(*) c FROM employees WHERE status=2').get() as any).c
        const recs = (db.prepare('SELECT * FROM attendance_records WHERE date=?').all(today) as any[])
        const checkedIn = recs.filter((r) => r.check_in_time != null).length
        const late = recs.filter((r) => r.late_minutes > 0).length
        const onTime = recs.filter((r) => r.status === 1).length
        const pendingReq = (db.prepare('SELECT COUNT(*) c FROM requests WHERE status=2').get() as any).c
        return {
          date: today, totalEmployees: active, checkedInToday: checkedIn,
          onTime, lateToday: late, absentToday: Math.max(0, active - checkedIn), pendingApprovals: pendingReq,
          onTimeRate: checkedIn ? Math.round((onTime / checkedIn) * 100) : 0,
        }
      }
      case 'propose_create_request': {
        const type = String(args.requestType ?? '')
        if (!VALID_TYPES.includes(type)) return { error: `Loại đơn không hợp lệ. Chọn 1 trong: ${VALID_TYPES.join(', ')}` }
        const r = buildPayload(type, args.fields ?? {})
        if (!r.ok) {
          return { error: `Thiếu thông tin: ${r.errors.join(', ')}. Hãy hỏi người dùng bổ sung.`, missing: r.errors }
        }
        const draft = { requestType: type, fields: r.payload, summary: r.summary }
        onDraft(draft)
        return {
          ok: true,
          preview: r.summary,
          note: 'Đã chuẩn bị bản nháp. Trình bày tóm tắt cho người dùng và yêu cầu xác nhận trước khi tạo.',
        }
      }
      default:
        return { error: `Tool không hỗ trợ: ${name}` }
    }
  }
}

function reqShortSummary(r: any): string {
  switch (r.type) {
    case 'leaves': return `${r.leave_type_name ?? 'nghỉ'} từ ${r.start_date} đến ${r.end_date} (${r.total_days} ngày)`
    case 'late-earlies': return `${r.late_early_type === 2 ? 'về sớm' : 'đi muộn'} lúc ${r.requested_time} ngày ${r.request_date}`
    case 'overtimes': return `OT ${r.start_time}-${r.end_time} ngày ${r.ot_date} (${r.total_hours}h)`
    case 'business-trips': return `công tác ${r.location ?? ''} từ ${r.start_date} đến ${r.end_date}`
    case 'shift-swaps': return `đổi ca ngày ${r.request_date}`
    case 'attendance-updates': return `cập nhật công ngày ${r.request_date}`
    default: return ''
  }
}

/* ----------------------------- System prompt ------------------------------ */
function buildSystemPrompt(user: AuthedRequest['user']): string {
  const today = ymd(nowVn())
  const emp = getEmployee(user!.employeeId)
  const leaveTypes = (db.prepare('SELECT name FROM leave_types').all() as any[]).map((r) => r.name).join(', ')
  return [
    'Bạn là "HRM Assistant" — trợ lý ảo của hệ thống chấm công HRM (công ty TechNova JSC).',
    'Trả lời bằng TIẾNG VIỆT, ngắn gọn, thân thiện, dùng markdown nhẹ (bullet, in đậm) khi cần.',
    '',
    `Hôm nay: ${today}.`,
    `Người đang chat: ${emp?.fullName ?? user!.email}.`,
    'Bạn có thể giúp 2 nhóm việc:',
    ' 1) TRA CỨU THÔNG TIN: chỉ sử dụng các tool mà backend cung cấp cho phiên hiện tại.',
    ' 2) TẠO ĐƠN TỪ: nghỉ phép, muộn/sớm, làm thêm, công tác, đổi ca, cập nhật công.',
    '',
    'Quy ước:',
    '- Khi người dùng muốn tạo đơn, hãy thu thập đủ thông tin rồi gọi tool propose_create_request. Định dạng ngày YYYY-MM-DD, giờ HH:mm.',
    `- Các loại nghỉ phép sẵn có: ${leaveTypes}.`,
    '- Sau khi propose thành công, trình bày tóm tắt nội dung đơn (dựa vào preview) và bảo người dùng bấm "Tạo đơn" để xác nhận.',
    '- Nếu thiếu thông tin bắt buộc, ĐỪNG gọi propose_create_request mà hãy hỏi người dùng.',
    '- Khi trả kết quả tra cứu, tổng hợp thành câu tiếng Việt dễ đọc, không xuôi danh JSON thô.',
    '- Chỉ tra cứu dữ liệu của chính người dùng (hoặc nhân viên họ có quyền) — không bịa số liệu.',
  ].join('\n')
}

/* --------------------------------- Routes --------------------------------- */
chatbotRouter.post('/', requireAuth, requirePermission(CHATBOT_PERMISSIONS.USE), async (req: AuthedRequest, res, next) => {
  try {
    if (!hasGeminiKey()) return next(httpError(500, 'Chatbot chưa cấu hình GEMINI_API_KEY trên server.'))
    const { message, history } = req.body ?? {}
    if (!message || !String(message).trim()) return next(httpError(400, 'Thiếu nội dung tin nhắn.'))

    const user = req.user!
    const actor = req.authorizationActor!
    const tools = buildAuthorizedTools(actor)
    let draft: any = null
    const onDraft = (d: any) => { draft = d }

    const geminiHistory = toGeminiHistory(history)

    const reply = await runChat({
      history: geminiHistory,
      userMessage: String(message),
      systemInstruction: buildSystemPrompt(user),
      tools,
      onToolCall: (name, args) => executeAuthorizedTool(actor, name, args, {
        onDraft,
        buildRequestDraft: (requestType, fields, freshActor) => buildPayload(requestType, fields, freshActor),
      }),
    })

    res.json({ reply: reply || '(không có phản hồi)', draft })
  } catch (e: any) {
    if (e?.status) return next(e)
    next(httpError(502, 'Dịch vụ chatbot tạm thời không khả dụng.'))
  }
})

// Xác nhận tạo đơn (sau khi người dùng bấm "Tạo đơn" trên thẻ nháp).
chatbotRouter.post('/create', requireAuth, requirePermission(CHATBOT_PERMISSIONS.USE), requirePermission(CHATBOT_PERMISSIONS.REQUEST_CREATE_SELF), requirePermission(REQUEST_PERMISSIONS.CREATE_OWN), async (req: AuthedRequest, res, next) => {
  try {
    const { requestType, fields } = req.body ?? {}
    if (!VALID_TYPES.includes(requestType)) return next(httpError(400, 'Loại đơn không hợp lệ.'))
    const r = buildPayload(requestType, fields ?? {}, req.authorizationActor!)
    if (!r.ok) return next(httpError(400, `Thiếu thông tin: ${r.errors.join(', ')}.`))
    const q = createRequest(req.user!.id, requestType as any, r.payload)
    const emp = getEmployee(req.user!.employeeId)!
    pushAudit(req.user!.id, emp.fullName, 1, 'Request', q.id, `Tạo ${requestType} qua chatbot (#${q.id.slice(-6)})`)
    res.json({
      ok: true,
      request: mapRequest(db.prepare('SELECT * FROM requests WHERE id=?').get(q.id) as any),
      reply: `✅ Đã tạo ${REQUEST_TYPE_LABEL[requestType]}. Mã đơn #${q.id.slice(-6)}, trạng thái: ${REQUEST_STATUS_LABEL[q.status] ?? q.status}. Đơn đang chờ duyệt.`,
    })
  } catch (e: any) {
    next(httpError(e?.status ?? 500, e?.message ?? 'Lỗi tạo đơn qua chatbot.'))
  }
})

// Tình trạng cấu hình (frontend dùng để ẩn/hiện widget).
chatbotRouter.get('/status', requireAuth, requirePermission(CHATBOT_PERMISSIONS.USE), (_req, res) => {
  res.json({ enabled: hasGeminiKey() })
})
