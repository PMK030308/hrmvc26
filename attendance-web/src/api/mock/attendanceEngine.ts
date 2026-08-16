// ============================================================================
// ENGINE CHẤM CÔNG — lõi logic nghiệp vụ (đặc tả §5).
//  - Ghép cặp: lượt lẻ = CHECK-IN, chẵn = CHECK-OUT
//  - Chống chấm trùng: cách lần gần nhất < 60s → bỏ qua + cảnh báo
//  - Ca đêm qua 0h: lượt sáng sớm hôm nay = CHECK-OUT của ca đêm hôm qua
//  - Tính muộn / về sớm (trừ cửa sổ cho phép)
//  - Trạng thái + cờ vấn đề (bitmask)
// Múi giờ VN (UTC+7); mock chạy client nên dùng giờ local làm giờ VN.
// ============================================================================
import type {
  AttendancePunch, AttendanceRecord, PunchSource, PunchResponse,
  AttendanceStatus, AttendanceMainStatus, AttendanceIssueFlags, Shift, ShiftSchedule,
} from '@/types'
import { AttendanceIssue } from '@/types'
import type { DB } from './store'
import { saveDB, uid } from './store'
import {
  timeStrToMinutes, minutesToTimeStr, ymd, addDays, parseISO, differenceInMinutes,
} from '@/lib/date'

const GRACE_OVERNIGHT_MIN = 3 * 60 // chấm ra trễ tối đa 3h sau tan ca đêm
const DUPLICATE_WINDOW_SEC = 60

/** Lấy ca theo lịch phân ca của NV trong ngày. */
function getSchedule(db: DB, employeeId: string, date: string): ShiftSchedule | null {
  return db.shiftSchedules.find((s) => s.employeeId === employeeId && s.date === date && s.isActive) ?? null
}
function getShift(db: DB, shiftId: string | null): Shift | null {
  if (!shiftId) return null
  return db.shifts.find((s) => s.id === shiftId) ?? null
}

/** Tất cả lượt chấm hoạt động của 1 NV trong 1 ngày, sắp xếp theo thời gian (giờ VN). */
function punchesOfDay(db: DB, employeeId: string, date: string): AttendancePunch[] {
  return db.punches
    .filter((p) => p.employeeId === employeeId && p.date === date && p.isActive)
    .sort((a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime())
}

/** Chuyển ISO UTC sang phút trong ngày (giờ VN). */
function punchToVnMinutes(p: AttendancePunch): number {
  // lưu UTC (đã trừ 7h khi seed) → cộng lại +7 để ra giờ VN
  const d = new Date(p.punchedAt)
  return d.getHours() * 60 + d.getMinutes() + 7 * 60 // +offset
  // (seed đã trừ 7h; ở đây cộng lại → giờ VN đúng. Khi NV chấm mới cũng lưu UTC tương đương.)
}

/** Thời điểm chấm mới dạng ISO "UTC tương đương" (lưu trừ 7h). */
function nowIsoUtcEquiv(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() - 7 * 60)
  return d.toISOString()
}

/**
 * Tính lại bản ghi ngày từ các lượt chấm — CỐT LÕI (ghép cặp).
 */
export function recomputeRecord(db: DB, employeeId: string, date: string): AttendanceRecord {
  const sched = getSchedule(db, employeeId, date)
  const shift = getShift(db, sched?.shiftId ?? null)
  const punches = punchesOfDay(db, employeeId, date)

  // Gán vai trò isCheckIn theo thứ tự: lẻ = in, chẵn = out
  punches.forEach((p, i) => { p.isCheckIn = i % 2 === 0 })
  saveDB()

  const existing = db.records.find((r) => r.employeeId === employeeId && r.date === date)
  const rec: AttendanceRecord = existing ?? {
    id: uid('rec'), employeeId: date, date, shiftId: shift?.id ?? null,
    shiftName: shift?.name ?? null, checkInTime: null, checkOutTime: null,
    actualWorkHours: 0, workHours: shift?.workDays ?? 0, lateMinutes: 0, earlyLeaveMinutes: 0,
    overtimeHours: 0, status: 4, mainStatus: 3, approvalStatus: 0, issues: 0,
    notes: null, isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
  if (existing) Object.assign(rec, existing)
  rec.id = existing?.id ?? rec.id
  rec.employeeId = employeeId
  rec.date = date
  rec.shiftId = shift?.id ?? null
  rec.shiftName = shift?.name ?? null
  rec.workHours = shift?.workDays ?? 0

  let issues: AttendanceIssueFlags = 0
  let status: AttendanceStatus = 4
  let mainStatus: AttendanceMainStatus = 3

  if (!shift) {
    // Không có ca
    rec.checkInTime = null; rec.checkOutTime = null
    rec.actualWorkHours = 0; rec.lateMinutes = 0; rec.earlyLeaveMinutes = 0
    rec.overtimeHours = 0; rec.status = 4; rec.mainStatus = 3
    issues |= AttendanceIssue.NoShift
    rec.issues = issues
    return upsert(db, rec)
  }

  if (punches.length === 0) {
    // Có ca nhưng không chấm → vắng mặt
    rec.checkInTime = null; rec.checkOutTime = null
    rec.actualWorkHours = 0; rec.lateMinutes = 0; rec.earlyLeaveMinutes = 0
    rec.overtimeHours = 0; rec.status = 4; rec.mainStatus = 2
    issues |= AttendanceIssue.MissingCheckIn | AttendanceIssue.MissingCheckOut
    rec.issues = issues
    return upsert(db, rec)
  }

  // Có lượt chấm → tính
  const startMin = timeStrToMinutes(shift.startTime)!
  const endMin = timeStrToMinutes(shift.endTime)!
  const graceIn = timeStrToMinutes(shift.checkInWindowTo) ?? startMin
  const graceOut = timeStrToMinutes(shift.checkOutWindowFrom) ?? endMin

  const first = punches[0]!
  const last = punches[punches.length - 1]!
  const checkInMin = punchToVnMinutes(first)
  const checkOutMin = punchToVnMinutes(last)

  rec.checkInTime = minutesToTimeStr(checkInMin)
  // Phiên mở (số lượt lẻ) → chưa chấm ra
  const isOpen = punches.length % 2 === 1
  rec.checkOutTime = isOpen ? null : minutesToTimeStr(checkOutMin)

  // Tổng giờ làm = CỘNG tất cả phiên (cặp 0-1, 2-3...) — KHÔNG trừ nghỉ trưa
  let totalWork = 0
  for (let i = 0; i + 1 < punches.length; i += 2) {
    const a = punchToVnMinutes(punches[i]!)
    const b = punchToVnMinutes(punches[i + 1]!)
    totalWork += Math.max(0, (b - a) / 60)
  }
  rec.actualWorkHours = Math.round(totalWork * 100) / 100

  // Muộn / sớm
  const lateMin = checkInMin <= graceIn ? 0 : Math.max(0, Math.round(checkInMin - startMin))
  const earlyMin = rec.checkOutTime == null || checkOutMin >= graceOut ? 0 : Math.max(0, Math.round(endMin - checkOutMin))
  rec.lateMinutes = lateMin
  rec.earlyLeaveMinutes = earlyMin
  if (lateMin > 0) issues |= AttendanceIssue.Late
  if (earlyMin > 0) issues |= AttendanceIssue.EarlyLeave

  // Thiếu chấm vào/ra
  if (punches.length === 1) issues |= AttendanceIssue.MissingCheckOut
  if (isOpen && punches.length > 1) issues |= AttendanceIssue.MissingCheckOut

  // Trạng thái
  if (lateMin > 0 && earlyMin > 0) status = 2
  else if (lateMin > 0) status = 2
  else if (earlyMin > 0) status = 3
  else status = punches.length >= 2 ? 1 : 5 // có mặt (chỉ mới vào)

  // OT: nếu chấm ra muộn hơn kết thúc ca + có đơn OT đã duyệt ngày đó
  const otApproved = db.requests.some(
    (r) => r.type === 'overtimes' && r.employeeId === employeeId && r.status === 3 &&
      (r as any).otDate === date,
  )
  if (!isOpen && checkOutMin > endMin) {
    rec.overtimeHours = Math.max(0, Math.round((checkOutMin - endMin) / 60 * 100) / 100)
    if (!otApproved) rec.overtimeHours = 0 // OT chưa duyệt → không tính
  } else {
    rec.overtimeHours = 0
  }

  rec.status = status
  mainStatus = issues === 0 ? 1 : 2
  rec.mainStatus = mainStatus
  rec.issues = issues
  return upsert(db, rec)
}

function upsert(db: DB, rec: AttendanceRecord): AttendanceRecord {
  rec.updatedAt = new Date().toISOString()
  const idx = db.records.findIndex((r) => r.id === rec.id)
  if (idx >= 0) db.records[idx] = rec
  else db.records.push(rec)
  saveDB()
  return rec
}

/**
 * Xử lý 1 lượt chấm công mới.
 * @returns PunchResponse + cảnh báo trùng / ca đêm.
 */
export function processPunch(
  db: DB,
  employeeId: string,
  source: PunchSource,
  payload: { latitude?: number; longitude?: number; accuracy?: number; wifiSsid?: string; notes?: string; snapshotBase64?: string | null },
): PunchResponse {
  const now = new Date()
  const date = ymd(now)
  const nowMin = now.getHours() * 60 + now.getMinutes() + 0 // giờ VN (local = VN trong demo)
  const nowIso = nowIsoUtcEquiv()

  // ---- Ca đêm qua 0h: kiểm tra ca hôm qua còn mở ----
  const yesterday = ymd(addDays(now, -1))
  const ySched = getSchedule(db, employeeId, yesterday)
  const yShift = getShift(db, ySched?.shiftId ?? null)
  if (yShift?.isOvernight) {
    const yPunches = punchesOfDay(db, employeeId, yesterday)
    const open = yPunches.length % 2 === 1 && yPunches.length > 0
    const endMin = timeStrToMinutes(yShift.endTime)! //VD 06:00 → 360
    // Nếu lượt chấm sáng sớm hôm nay nằm trong grace (end → end+3h) và ca hôm qua đang mở
    if (open && nowMin >= endMin && nowMin <= endMin + GRACE_OVERNIGHT_MIN) {
      // Chống trùng
      const last = yPunches[yPunches.length - 1]!
      if (Math.abs(differenceInMinutes(parseISO(last.punchedAt), parseISO(nowIso))) * 0 < DUPLICATE_WINDOW_SEC / 60 &&
          secDiff(last.punchedAt, nowIso) < DUPLICATE_WINDOW_SEC) {
        return dupResponse()
      }
      const punch: AttendancePunch = mkPunch(employeeId, yesterday, nowIso, source, payload, false)
      db.punches.push(punch)
      const rec = recomputeRecord(db, employeeId, yesterday)
      saveDB()
      return successResponse(rec, db, employeeId, yesterday)
    }
  }

  // ---- Chống chấm trùng 60s trong cùng ngày ----
  const todayPunches = punchesOfDay(db, employeeId, date)
  if (todayPunches.length > 0) {
    const last = todayPunches[todayPunches.length - 1]!
    if (secDiff(last.punchedAt, nowIso) < DUPLICATE_WINDOW_SEC) {
      return dupResponse()
    }
  }

  // ---- Chấm thường (lẻ = vào, chẵn = ra) ----
  const isCheckIn = todayPunches.length % 2 === 0
  const punch = mkPunch(employeeId, date, nowIso, source, payload, isCheckIn)
  db.punches.push(punch)
  const rec = recomputeRecord(db, employeeId, date)
  saveDB()
  return successResponse(rec, db, employeeId, date)
}

function secDiff(aIso: string, bIso: string): number {
  return Math.abs((new Date(bIso).getTime() - new Date(aIso).getTime()) / 1000)
}

function mkPunch(employeeId: string, date: string, iso: string, source: PunchSource,
  payload: { latitude?: number; longitude?: number; accuracy?: number; wifiSsid?: string; notes?: string; snapshotBase64?: string | null },
  isCheckIn: boolean): AttendancePunch {
  return {
    id: uid('p'), employeeId, date, punchedAt: iso, source,
    deviceInfo: 'Web', latitude: payload.latitude ?? null, longitude: payload.longitude ?? null,
    accuracy: payload.accuracy ?? null, wifiSsid: payload.wifiSsid ?? null,
    notes: payload.notes ?? null, snapshotBase64: payload.snapshotBase64 ?? null,
    attendanceRecordId: null, isCheckIn, isActive: true, createdAt: iso,
  }
}

function dupResponse(): PunchResponse {
  return {
    success: false, message: 'Bạn vừa chấm công cách đây ít hơn 60 giây — vui lòng đợt ít nhất 1 phút để chấm lại (tránh bấm nhầm).',
    checkIn: null, checkOut: null, totalPunches: 0, totalWorkHours: 0, nextAction: 'check_in', completed: false,
  }
}

function successResponse(rec: AttendanceRecord, db: DB, employeeId: string, date: string): PunchResponse {
  const punches = punchesOfDay(db, employeeId, date)
  const total = punches.reduce((s, p, i) => {
    if (i % 2 === 1) {
      const a = punchToVnMinutes(punches[i - 1]!)
      const b = punchToVnMinutes(p)
      return s + Math.max(0, (b - a) / 60)
    }
    return s
  }, 0)
  const completed = rec.checkInTime != null && rec.checkOutTime != null
  const nextAction: PunchResponse['nextAction'] = completed ? 'completed' : rec.checkInTime == null ? 'check_in' : 'check_out'
  return {
    success: true,
    message: completed ? 'Đã chấm ra. Chấm công hôm nay hoàn tất!' : rec.checkInTime == null ? 'Chấm vào thành công!' : 'Chấm ra thành công!',
    checkIn: rec.checkInTime, checkOut: rec.checkOutTime,
    totalPunches: punches.length, totalWorkHours: Math.round(total * 100) / 100,
    nextAction, completed,
  }
}

/** Tạo bản ghi chấm công hộ (proxy) — reuses processPunch. */
export function proxyPunch(db: DB, targetEmployeeId: string, source: PunchSource,
  payload: { latitude?: number; longitude?: number; wifiSsid?: string }): PunchResponse {
  return processPunch(db, targetEmployeeId, source, payload)
}

/** Tính lại toàn bộ bản ghi (sau khi sửa ca / phân ca). */
export function recomputeAll(db: DB, employeeId: string): void {
  const dates = Array.from(new Set(db.records.filter((r) => r.employeeId === employeeId).map((r) => r.date)))
  for (const d of dates) recomputeRecord(db, employeeId, d)
}