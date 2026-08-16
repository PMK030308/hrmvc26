// ============================================================================
// Tiện ích ngày giờ — toàn bộ nghiệp vụ chấm công dùng UTC+7 (§3.4).
// Backend (mock) lưu UTC, hiển thị chuyển sang +7. KHÔNG được ToLocalTime 2 lần.
// ============================================================================
import { format, parseISO, differenceInMinutes, addMinutes, addDays, startOfWeek, endOfWeek,
  startOfMonth, endOfMonth, isWeekend, eachDayOfInterval, getDay, isSameDay } from 'date-fns'
import { vi } from 'date-fns/locale'

const VN_OFFSET_MIN = 7 * 60 // UTC+7

/** Chuyển ISO UTC → Date theo giờ VN (UTC+7). */
export function toVnDate(iso: string | Date): Date {
  const d = typeof iso === 'string' ? parseISO(iso) : iso
  // date-fns parseISO cho UTC không có suffix vẫn hợp lệ; ta cộng offset thủ công
  return addMinutes(d, VN_OFFSET_MIN)
}

/** Lấy thời điểm hiện tại dạng Date VN (dùng cho mock backend). */
export function nowVn(): Date {
  // new Date() ở client đã là local; mock chạy trong trình duyệt nên dùng local
  // nhưng để nhất quán, trả về Date biểu diễn "giờ tường". Dùng Date.now() local.
  return new Date()
}

/** Format ngày VN: "16/08/2026" */
export function fmtDate(iso: string | Date, pattern = 'dd/MM/yyyy'): string {
  if (!iso) return '—'
  const d = typeof iso === 'string' ? parseISO(iso) : iso
  return format(d, pattern, { locale: vi })
}

/** Format giờ VN từ UTC: "08:30" */
export function fmtTime(iso: string | Date): string {
  if (!iso) return '—'
  const d = typeof iso === 'string' ? parseISO(iso) : iso
  return format(d, 'HH:mm')
}

/** Ngày chuẩn YYYY-MM-DD (theo giờ VN) */
export function ymd(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

/** Năm-tháng YYYYMM */
export function ym(date: Date): string {
  return format(date, 'yyyyMM')
}

/** Lời chào theo buổi */
export function greeting(date = new Date()): string {
  const h = date.getHours()
  if (h < 11) return 'Chào buổi sáng'
  if (h < 13) return 'Chào buổi trưa'
  if (h < 18) return 'Chào buổi chiều'
  return 'Chào buổi tối'
}

/** Khoảng ngày của kỳ lương: nửa đầu (1–15) hoặc nửa cuối (16–cuối) */
export function halfMonthRange(year: number, month: number, half: 1 | 2) {
  const base = new Date(year, month - 1, 1)
  if (half === 1) {
    return { from: base, to: new Date(year, month - 1, 15) }
  }
  return { from: new Date(year, month - 1, 16), to: endOfMonth(base) }
}

/** Số ngày làm việc (loại trừ T7+CN) trong khoảng — cho tính ngày nghỉ phép. */
export function workingDays(from: Date, to: Date): number {
  const days = eachDayOfInterval({ start: from, end: to })
  return days.filter((d) => !isWeekend(d)).length
}

/** Số ngày lịch trong khoảng. */
export function calendarDays(from: Date, to: Date): number {
  return eachDayOfInterval({ start: from, end: to }).length
}

export {
  addDays, addMinutes, differenceInMinutes, startOfWeek, endOfWeek,
  startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, isWeekend, format, parseISO,
}

/** Minutes giữa 2 ISO (dương nếu b sau a). */
export function minutesBetween(a: string | Date, b: string | Date): number {
  const da = typeof a === 'string' ? parseISO(a) : a
  const db = typeof b === 'string' ? parseISO(b) : b
  return differenceInMinutes(db, da)
}

/** Chuyển "HH:mm:ss" → số phút từ 0h. */
export function timeStrToMinutes(t: string | null | undefined): number | null {
  if (!t) return null
  const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  const h = Number(m[1]); const mi = Number(m[2]); const s = m[3] ? Number(m[3]) : 0
  return h * 60 + mi + s / 60
}

/** Số phút → "HH:mm" */
export function minutesToTimeStr(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Format phút thành "2h 15m" */
export function fmtMinutes(min: number): string {
  if (min <= 0) return '0m'
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/** Format giờ thập phân thành "8.5h" */
export function fmtHours(h: number): string {
  return `${(Math.round(h * 100) / 100).toLocaleString('vi-VN')}h`
}

/** Số năm cống hiến từ ngày vào làm. */
export function yearsOfService(hireDate: string): number {
  const d = parseISO(hireDate)
  const diff = Date.now() - d.getTime()
  return Math.max(0, Math.floor(diff / (365.25 * 24 * 3600 * 1000)))
}