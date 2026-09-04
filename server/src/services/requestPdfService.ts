import { createHmac } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import { db } from '../db.js'
import { isoNow } from '../lib/date.js'
import { resolveJwtSecret } from '../lib/securityConfig.js'
import { httpError } from '../types.js'

const require = createRequire(import.meta.url)
const pdfMake = require('pdfmake') as typeof import('pdfmake')
const pdfMakeRoot = dirname(require.resolve('pdfmake/package.json'))
const fontRoot = resolve(pdfMakeRoot, 'fonts', 'Roboto')
const fontRootPrefix = `${fontRoot}${sep}`

pdfMake.setFonts({
  Roboto: {
    normal: join(fontRoot, 'Roboto-Regular.ttf'),
    bold: join(fontRoot, 'Roboto-Medium.ttf'),
    italics: join(fontRoot, 'Roboto-Italic.ttf'),
    bolditalics: join(fontRoot, 'Roboto-MediumItalic.ttf'),
  },
})
pdfMake.setUrlAccessPolicy(() => false)
pdfMake.setLocalAccessPolicy((path) => {
  const resolvedPath = resolve(path)
  return resolvedPath === fontRoot || resolvedPath.startsWith(fontRootPrefix)
})

const TYPE_LABELS: Record<string, string> = {
  leaves: 'Đơn nghỉ phép',
  'late-earlies': 'Đơn đi muộn / về sớm',
  overtimes: 'Đơn đăng ký tăng ca',
  'business-trips': 'Đơn công tác',
  'shift-swaps': 'Đơn đổi ca',
  'attendance-updates': 'Đơn cập nhật công',
}

const APPROVAL_STATUS: Record<number, string> = {
  1: 'Bản nháp', 2: 'Chờ duyệt', 3: 'Đã duyệt', 4: 'Từ chối', 5: 'Bỏ qua',
}

interface RequestPdfRow {
  id: string
  type: string
  employee_code: string
  employee_name: string
  department_name: string
  status: number
  updated_at: string
  created_at: string
  leave_type_name: string | null
  start_date: string | null
  end_date: string | null
  total_days: number | null
  request_date: string | null
  late_early_type: number | null
  requested_time: string | null
  minutes: number | null
  ot_date: string | null
  start_time: string | null
  end_time: string | null
  total_hours: number | null
  compensation_type: number | null
  location: string | null
  purpose: string | null
  shift_swap_mode: number | null
  suggested_swap_partner_name: string | null
  update_type: number | null
  new_check_in_time: string | null
  new_check_out_time: string | null
  new_work_hours: number | null
  reason: string | null
}

function value(input: unknown): string {
  if (input === null || input === undefined || input === '') return '—'
  return String(input)
}

function date(input: string | null): string {
  if (!input) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(input)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : input
}

function dateTime(input: string | null): string {
  if (!input) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(input)
  if (!match) return input
  const parsed = new Date(input)
  if (input.endsWith('Z') && !Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh', hour12: false,
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(parsed)
  }
  return `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}`
}

function resolvePublicAppUrl(): string {
  const configured = process.env.APP_PUBLIC_URL?.trim()
  if (!configured) {
    if (process.env.NODE_ENV === 'production') throw httpError(503, 'Chưa cấu hình URL xác minh PDF.')
    return 'http://localhost:5173'
  }
  let parsed: URL
  try { parsed = new URL(configured) } catch { throw httpError(503, 'URL xác minh PDF không hợp lệ.') }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw httpError(503, 'URL xác minh PDF không hợp lệ.')
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw httpError(503, 'URL xác minh PDF không hợp lệ.')
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') throw httpError(503, 'URL xác minh PDF production phải dùng HTTPS.')
  return parsed.origin
}

export function requestVerificationCode(row: Pick<RequestPdfRow, 'id' | 'type' | 'employee_code' | 'status' | 'updated_at'>): string {
  const digest = createHmac('sha256', resolveJwtSecret(process.env))
    .update(`${row.id}|${row.type}|${row.employee_code}|${row.status}|${row.updated_at}`)
    .digest('hex').slice(0, 12).toUpperCase()
  return `REQ-${digest.slice(0, 4)}-${digest.slice(4, 8)}-${digest.slice(8, 12)}`
}

function requestDetails(row: RequestPdfRow): Array<[string, string]> {
  switch (row.type) {
    case 'leaves': return [
      ['Nội dung', value(row.leave_type_name)],
      ['Thời gian áp dụng', `${date(row.start_date)} – ${date(row.end_date)} (${value(row.total_days)} ngày)`],
      ['Lý do', value(row.reason)],
    ]
    case 'late-earlies': return [
      ['Nội dung', row.late_early_type === 1 ? 'Xin đi muộn' : 'Xin về sớm'],
      ['Thời gian áp dụng', `${date(row.request_date)} · ${value(row.requested_time)} (${value(row.minutes)} phút)`],
      ['Lý do', value(row.reason)],
    ]
    case 'overtimes': return [
      ['Nội dung', `Đăng ký tăng ca · ${value(row.total_hours)} giờ`],
      ['Thời gian áp dụng', `${date(row.ot_date)} · ${value(row.start_time)} – ${value(row.end_time)}`],
      ['Hình thức ghi nhận', ({ 1: 'Trả lương', 2: 'Nghỉ bù', 3: 'Trả lương và nghỉ bù' } as Record<number, string>)[row.compensation_type ?? 0] ?? '—'],
      ['Lý do', value(row.reason)],
    ]
    case 'business-trips': return [
      ['Nội dung', `Công tác tại ${value(row.location)}`],
      ['Thời gian áp dụng', `${date(row.start_date)} – ${date(row.end_date)} (${value(row.total_days)} ngày)`],
      ['Lý do / mục đích', value(row.purpose)],
    ]
    case 'shift-swaps': return [
      ['Nội dung', row.shift_swap_mode === 2 ? `Đổi ca với ${value(row.suggested_swap_partner_name)}` : 'Đăng ký đổi ca cá nhân'],
      ['Thời gian áp dụng', date(row.request_date)],
      ['Lý do', value(row.reason)],
    ]
    case 'attendance-updates': return [
      ['Nội dung', ({ 1: 'Thêm bản ghi công', 2: 'Sửa giờ chấm công', 3: 'Xóa bản ghi công' } as Record<number, string>)[row.update_type ?? 0] ?? 'Cập nhật công'],
      ['Thời gian áp dụng', date(row.request_date)],
      ['Dữ liệu cập nhật', `Giờ vào: ${value(row.new_check_in_time)} · Giờ ra: ${value(row.new_check_out_time)} · Tổng giờ: ${value(row.new_work_hours)}`],
      ['Lý do', value(row.reason)],
    ]
    default: return [['Nội dung', '—'], ['Thời gian áp dụng', '—'], ['Lý do', value(row.reason)]]
  }
}

function detailTable(rows: Array<[string, string]>) {
  return {
    table: {
      widths: [145, '*'],
      body: rows.map(([label, content]) => [
        { text: label.toUpperCase(), style: 'fieldLabel', fillColor: '#F1F5F9' },
        { text: content, style: 'fieldValue' },
      ]),
    },
    layout: {
      hLineColor: () => '#E2E8F0', vLineColor: () => '#E2E8F0',
      paddingLeft: () => 12, paddingRight: () => 12, paddingTop: () => 10, paddingBottom: () => 10,
    },
  }
}

export async function generateApprovedRequestPdf(type: string, requestId: string): Promise<{
  buffer: Buffer; verificationCode: string; verificationUrl: string; fileName: string
}> {
  const row = db.prepare(`SELECT r.*, d.name department_name
    FROM requests r
    JOIN employees e ON e.id=r.employee_id
    JOIN departments d ON d.id=e.department_id
    WHERE r.id=? AND r.type=?`).get(requestId, type) as RequestPdfRow | undefined
  if (!row) throw httpError(404, 'Không tìm thấy đơn.')
  if (row.status !== 3) throw httpError(409, 'Chỉ được xuất PDF chính thức khi đơn đã được duyệt hoàn tất.')

  const approvals = db.prepare(`SELECT level, approver_name, status, comment, approved_at,
      on_behalf_of_name FROM request_approvals WHERE request_id=? ORDER BY level ASC`).all(requestId) as any[]
  if (approvals.length === 0 || approvals.some((approval) => ![3, 5].includes(approval.status))) {
    throw httpError(409, 'Lịch sử phê duyệt chưa hoàn tất nên chưa thể xuất PDF chính thức.')
  }

  const exportedAt = isoNow()
  const verificationCode = requestVerificationCode(row)
  const verificationUrl = `${resolvePublicAppUrl()}/employee/requests/${encodeURIComponent(type)}/${encodeURIComponent(requestId)}?verification=${encodeURIComponent(verificationCode)}`
  const approvalBody: any[][] = [
    [
      { text: 'CẤP', style: 'tableHeader' },
      { text: 'NGƯỜI DUYỆT', style: 'tableHeader' },
      { text: 'KẾT QUẢ', style: 'tableHeader' },
      { text: 'THỜI GIAN', style: 'tableHeader' },
    ],
    ...approvals.map((approval) => [
      { text: String(approval.level), alignment: 'center', margin: [0, 5, 0, 5] },
      { text: approval.on_behalf_of_name
        ? `${approval.approver_name}\n(thay mặt ${approval.on_behalf_of_name})`
        : approval.approver_name, margin: [0, 5, 0, 5] },
      { text: APPROVAL_STATUS[approval.status] ?? '—', color: approval.status === 3 ? '#15803D' : '#475569', bold: true, margin: [0, 5, 0, 5] },
      { text: dateTime(approval.approved_at), margin: [0, 5, 0, 5] },
    ]),
  ]

  const definition: TDocumentDefinitions = {
    info: {
      title: `${TYPE_LABELS[row.type] ?? 'Đơn'} ${row.id}`,
      author: 'TechNova HRM',
      subject: 'Bản xác nhận phê duyệt điện tử',
      keywords: `HRM, request, approved, ${verificationCode}`,
    },
    pageSize: 'A4',
    pageMargins: [46, 50, 46, 62],
    defaultStyle: { font: 'Roboto', fontSize: 9.5, color: '#334155', lineHeight: 1.25 },
    background: (_currentPage, pageSize) => ({
      canvas: [
        { type: 'rect', x: 0, y: 0, w: pageSize.width, h: 10, color: '#0F4C81' },
        { type: 'rect', x: pageSize.width - 92, y: 10, w: 92, h: 5, color: '#38BDF8' },
      ],
    }),
    footer: (currentPage, pageCount) => ({
      margin: [46, 0, 46, 22],
      columns: [
        { text: `TechNova HRM · ${verificationCode}`, color: '#64748B', fontSize: 8 },
        { text: `Trang ${currentPage}/${pageCount}`, alignment: 'right', color: '#64748B', fontSize: 8 },
      ],
    }),
    content: [
      {
        columns: [
          { width: '*', stack: [
            { text: 'TECHNOVA HRM', color: '#0F4C81', bold: true, fontSize: 12, characterSpacing: 1.4 },
            { text: 'PHIẾU ĐƠN ĐÃ ĐƯỢC PHÊ DUYỆT', style: 'title', margin: [0, 8, 0, 3] },
            { text: 'Bản xác nhận điện tử · Không yêu cầu chữ ký hình ảnh', color: '#64748B', fontSize: 9 },
          ] },
          { width: 125, table: { widths: ['*'], body: [[
            { text: 'ĐÃ DUYỆT HOÀN TẤT', alignment: 'center', bold: true, color: '#166534', fillColor: '#DCFCE7', margin: [7, 9, 7, 9] },
          ]] }, layout: 'noBorders' },
        ],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 503, y2: 0, lineWidth: 1, lineColor: '#CBD5E1' }], margin: [0, 18, 0, 18] },
      { text: 'THÔNG TIN NHẬN DIỆN', style: 'sectionTitle' },
      detailTable([
        ['Mã đơn', row.id],
        ['Loại đơn', TYPE_LABELS[row.type] ?? row.type],
        ['Người tạo', `${row.employee_name} (${row.employee_code})`],
        ['Phòng ban', row.department_name],
        ['Thời điểm tạo', dateTime(row.created_at)],
        ['Trạng thái cuối', 'Đã duyệt hoàn tất'],
      ]),
      { text: 'NỘI DUNG ĐƠN', style: 'sectionTitle', margin: [0, 20, 0, 8] },
      detailTable(requestDetails(row)),
      { text: 'LỊCH SỬ PHÊ DUYỆT ĐIỆN TỬ', style: 'sectionTitle', margin: [0, 20, 0, 8] },
      {
        table: { headerRows: 1, widths: [34, '*', 76, 98], body: approvalBody },
        layout: {
          fillColor: (rowIndex) => rowIndex === 0 ? '#0F4C81' : rowIndex % 2 === 0 ? '#F8FAFC' : null,
          hLineColor: () => '#E2E8F0', vLineColor: () => '#E2E8F0',
          paddingLeft: () => 7, paddingRight: () => 7, paddingTop: () => 4, paddingBottom: () => 4,
        },
      },
      {
        margin: [0, 22, 0, 0],
        table: { widths: ['*', 92], body: [[
          { stack: [
            { text: 'XÁC MINH BẢN GHI', style: 'sectionTitle', margin: [0, 0, 0, 8] },
            { text: verificationCode, fontSize: 16, bold: true, color: '#0F4C81', characterSpacing: 1 },
            { text: `Xuất lúc: ${dateTime(exportedAt)}`, margin: [0, 7, 0, 0], color: '#475569' },
            { text: 'Quét QR để mở bản ghi trên hệ thống. Người xem phải đăng nhập và có quyền truy cập đơn.', margin: [0, 7, 12, 0], color: '#64748B', fontSize: 8.5 },
          ], margin: [14, 12, 8, 12] },
          { qr: verificationUrl, fit: 76, alignment: 'center', margin: [6, 8, 6, 8] },
        ]] },
        layout: {
          fillColor: () => '#EFF6FF', hLineColor: () => '#BFDBFE', vLineColor: () => '#BFDBFE',
        },
      },
      { text: 'Tài liệu được tạo tự động từ lịch sử phê duyệt điện tử. Họ tên người duyệt và thời gian duyệt là căn cứ xác nhận trong phạm vi hệ thống.', alignment: 'center', color: '#64748B', italics: true, fontSize: 8, margin: [15, 16, 15, 0] },
    ],
    styles: {
      title: { fontSize: 19, bold: true, color: '#0F172A' },
      sectionTitle: { fontSize: 10, bold: true, color: '#0F4C81', characterSpacing: 0.8 },
      fieldLabel: { fontSize: 8, bold: true, color: '#64748B' },
      fieldValue: { fontSize: 9.5, color: '#1E293B' },
      tableHeader: { fontSize: 8, bold: true, color: '#FFFFFF', alignment: 'center', margin: [0, 5, 0, 5] },
    },
  }

  const buffer = await pdfMake.createPdf(definition).getBuffer()
  const safeCode = row.employee_code.replace(/[^A-Za-z0-9_-]/g, '') || 'employee'
  const safeId = row.id.replace(/[^A-Za-z0-9_-]/g, '') || 'request'
  return { buffer, verificationCode, verificationUrl, fileName: `request-${safeCode}-${safeId}.pdf` }
}
