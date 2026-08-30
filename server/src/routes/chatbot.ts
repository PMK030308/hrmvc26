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
import { runChat, hasGeminiKey } from '../lib/gemini.js'
import { createRequest } from '../engines/request.js'
import { getEmployee, getLeaveType, mapRequest } from '../repo.js'
import { ymd, nowVn } from '../lib/date.js'
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
/* ----------------------- Xây payload tạo đơn (từ trường thân thiện) ------- */
interface FieldErrors { ok: boolean; payload: Record<string, any>; errors: string[]; summary: Record<string, any> }

function resolveLeaveTypeByName(name: any): any | null {
  if (!name) return null
  const q = String(name).toLowerCase().trim()
  const rows = db.prepare('SELECT * FROM leave_types').all() as any[]
  return rows.find((r) => r.name.toLowerCase().includes(q) || q.includes(r.name.toLowerCase())) ?? null
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
