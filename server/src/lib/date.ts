// ============================================================================
// Tiện ích ngày giờ (backend) — port từ attendance-web/src/lib/date.ts.
// Toàn bộ nghiệp vụ chấm công dùng UTC+7 (Asia/Ho_Chi_Minh).
// Server có thể chạy ở múi giờ bất kỳ → dùng nowVn() để lấy thời điểm VN.
// ============================================================================
import {
  addDays as _addDays, addMinutes, differenceInMinutes, eachDayOfInterval,
  endOfMonth, format, isWeekend, parseISO,
} from 'date-fns'

/** Thời điểm hiện tại theo giờ VN (Date object biểu diễn "tường" VN). */
export function nowVn(): Date {
  // Lấy string 'YYYY-MM-DD HH:mm:ss' theo tz VN rồi parse thành Date naive.
  const s = new Date().toLocaleString('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  // en-CA → 'YYYY-MM-DD, HH:mm:ss' → thay dấu phẩy
  return parseISO(s.replace(',', ''))
}

/** Ngày chuẩn YYYY-MM-DD theo giờ VN. */
export function ymd(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

export function ym(date: Date): string {
  return format(date, 'yyyyMM')
}

/** ISO naive 'YYYY-MM-DDTHH:mm:ss' (giờ VN, KHÔNG có Z) — để lưu punched_at. */
export function vnIso(date: Date): string {
  return format(date, "yyyy-MM-dd'T'HH:mm:ss")
}

/** ISO đầy đủ kiểu 'YYYY-MM-DDTHH:mm:ss.SSSZ' cho created_at/updated_at. */
export function isoNow(): string {
  return new Date().toISOString()
}

export function addDays(date: Date, n: number): Date {
  return _addDays(date, n)
}

/** Nửa đầu (1–15) / nửa cuối (16–cuối tháng). */
export function halfMonthRange(year: number, month: number, half: 1 | 2) {
  const base = new Date(year, month - 1, 1)
  if (half === 1) return { from: base, to: new Date(year, month - 1, 15) }
  return { from: new Date(year, month - 1, 16), to: endOfMonth(base) }
}

export function workingDays(from: Date, to: Date): number {
  return eachDayOfInterval({ start: from, end: to }).filter((d) => !isWeekend(d)).length
}
export function calendarDays(from: Date, to: Date): number {
  return eachDayOfInterval({ start: from, end: to }).length
}
export { eachDayOfInterval, endOfMonth, parseISO, differenceInMinutes, addMinutes, format, isWeekend }

/** "HH:mm:ss" → số phút từ 0h. */
export function timeStrToMinutes(t: string | null | undefined): number | null {
  if (!t) return null
  const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  const h = Number(m[1]); const mi = Number(m[2]); const s = m[3] ? Number(m[3]) : 0
  return h * 60 + mi + s / 60
}
/** Số phút → "HH:mm". */
export function minutesToTimeStr(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Phút trong ngày VN của một ISO naive (giờ VN). */
export function vnIsoToMinutes(iso: string): number {
  const d = parseISO(iso)
  return d.getHours() * 60 + d.getMinutes()
}

/** Số năm cống hiến. */
export function yearsOfService(hireDate: string): number {
  const d = parseISO(hireDate)
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000)))
}