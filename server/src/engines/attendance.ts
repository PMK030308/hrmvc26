// ============================================================================
// ENGINE CHẤM CÔNG — port từ attendance-web/src/api/mock/attendanceEngine.ts.
//  - Ghép cặp: lượt lẻ = CHECK-IN, chẵn = CHECK-OUT
//  - Chống chấm trùng trong cửa sổ N giây (lấy lần ĐẦU, N cấu hình trong regulation)
//  - Ca đêm qua 0h: lượt sáng sớm hôm nay = CHECK-OUT của ca đêm hôm qua
//  - Tính muộn / về sớm, trạng thái + cờ vấn đề (bitmask)
//  - OT theo Bộ luật Lao động 2019 (Điều 98): phân loại weekday/weekend/holiday
//    + giờ đêm (22h-06h) + OT đêm; làm cả ca vào ngày nghỉ/lễ (có đơn OT) = toàn OT.
// Múi giờ VN; punched_at lưu naive 'YYYY-MM-DDTHH:mm:ss' (giờ VN).
// ============================================================================
import { db } from '../db.js'
import { AttendanceIssue } from '../types.js'
import { uid } from '../repo.js'
import {
  getSchedule, getShift, punchesOfDay, getRecord, isHoliday, getRegulation,
} from '../repo.js'
import {
  timeStrToMinutes, minutesToTimeStr, ymd, nowVn, addDays, parseISO, vnIso, vnIsoToMinutes, isoNow,
} from '../lib/date.js'

const GRACE_OVERNIGHT_MIN = 3 * 60
const NIGHT_START = 22 * 60   // 22:00
const NIGHT_END = 6 * 60      // 06:00

function duplicateWindowSec(): number {
  const reg = getRegulation()
  return reg?.duplicateWindowSeconds ?? 60
}

/** Loại ngày theo BLD 2019: lễ tết (3x) / cuối tuần (2x) / ngày thường (1.5x). */
function dayType(date: string): 'weekday' | 'weekend' | 'holiday' {
  if (isHoliday(date)) return 'holiday'
  const dow = parseISO(date).getDay()
  if (dow === 0 || dow === 6) return 'weekend'
  return 'weekday'
}

/**
 * Phần phút giao [s,e) với cửa sổ đêm (22h–06h). s,e tính bằng phút tuyệt đối từ 0h
 * của ngày bắt đầu ca (ca qua 0h → checkout có thể > 1440, ví dụ 06:00 hôm sau = 1800).
 * Cửa sổ đêm = [0,06h) ∪ [22h, 06h hôm sau) = [0,360) ∪ [1320,1800).
 */
function nightOverlapMin(s: number, e: number): number {
  if (e <= s) return 0
  const w1 = Math.max(0, Math.min(e, NIGHT_END) - Math.max(s, 0))           // [00:00, 06:00)
  const w2 = Math.max(0, Math.min(e, 1440 + NIGHT_END) - Math.max(s, NIGHT_START)) // [22:00, 06:00 hôm sau)
  return w1 + w2
}

/** Tính lại bản ghi ngày từ các lượt chấm — ghép cặp. */
export function recomputeRecord(employeeId: string, date: string): any {
  const sched = getSchedule(employeeId, date)
  const shift = getShift(sched?.shiftId ?? null)
  const punches = punchesOfDay(employeeId, date)

  let issues = 0
  let status = 4
  let mainStatus = 3
  const existing = getRecord(employeeId, date)
  const recId = existing?.id ?? uid('rec')

  const base = {
    id: recId, employee_id: employeeId, date, shift_id: shift?.id ?? null,
    shift_name: shift?.name ?? null, check_in_time: null as string | null,
    check_out_time: null as string | null, actual_work_hours: 0, work_hours: shift?.workDays ?? 0,
    late_minutes: 0, early_leave_minutes: 0, overtime_hours: 0,
    ot_weekday_hours: 0, ot_weekend_hours: 0, ot_holiday_hours: 0,
    night_hours: 0, night_ot_hours: 0,
    status: 4, main_status: 3, approval_status: 0, issues: 0,
    notes: null as string | null, is_active: 1,
    created_at: existing?.createdAt ?? isoNow(), updated_at: isoNow(),
  }

  // Đơn OT đã duyệt cho ngày (ca đêm thì OT rơi vào ngày hôm sau)
  const isOvernight = !!shift?.isOvernight
  const otDate = isOvernight ? ymd(addDays(parseISO(date), 1)) : date
  const otApproved = !!db.prepare(
    `SELECT 1 FROM requests WHERE type='overtimes' AND employee_id=? AND status=3 AND ot_date=?`,
  ).get(employeeId, otDate) as any
  void otApproved // dùng bên dưới

  // Trường hợp 1: không có ca nhưng có chấm + đơn OT → làm cả ca vào ngày nghỉ/lễ (toàn OT)
  if (!shift && punches.length > 0 && otApproved) {
    let totalWork = 0
    for (let i = 0; i + 1 < punches.length; i += 2) {
      totalWork += Math.max(0, (vnIsoToMinutes(punches[i + 1]!.punchedAt) - vnIsoToMinutes(punches[i]!.punchedAt)) / 60)
    }
    const isOpen = punches.length % 2 === 1
    const first = punches[0]!, last = punches[punches.length - 1]!
    const cinMin = vnIsoToMinutes(first.punchedAt), coutMin = vnIsoToMinutes(last.punchedAt)
    const dt = dayType(date)
    const otBreak = { weekday: 0, weekend: 0, holiday: 0 }
    otBreak[dt] = Math.round(totalWork * 100) / 100
    const nightH = Math.round((nightOverlapMin(cinMin, coutMin) / 60) * 100) / 100
    upsertRecord({
      ...base,
      check_in_time: minutesToTimeStr(cinMin), check_out_time: isOpen ? null : minutesToTimeStr(coutMin),
      actual_work_hours: Math.round(totalWork * 100) / 100, overtime_hours: Math.round(totalWork * 100) / 100,
      ot_weekday_hours: otBreak.weekday, ot_weekend_hours: otBreak.weekend, ot_holiday_hours: otBreak.holiday,
      night_hours: nightH, night_ot_hours: nightH, status: 1, main_status: 1, issues: 0,
    })
    return recomputeRead(employeeId, date)
  }

  if (!shift) {
    issues |= AttendanceIssue.NoShift
    upsertRecord({ ...base, issues })
    return recomputeRead(employeeId, date)
  }

  if (punches.length === 0) {
    issues |= AttendanceIssue.MissingCheckIn | AttendanceIssue.MissingCheckOut
    upsertRecord({ ...base, main_status: 2, issues })
    return recomputeRead(employeeId, date)
  }

  const startMin = timeStrToMinutes(shift.startTime)!
  const endMin = timeStrToMinutes(shift.endTime)!
  // Ca qua 0h (overnight): mốc kết thúc/thời gian ra cho phép dịch +1440 (sang hôm sau).
  const endMinAbs = isOvernight ? endMin + 1440 : endMin
  const graceIn = timeStrToMinutes(shift.checkInWindowTo) ?? startMin
  const graceOutAbs = (timeStrToMinutes(shift.checkOutWindowFrom) ?? endMin) + (isOvernight ? 1440 : 0)

  // Phút tuyệt đối từ 0h của ngày bắt đầu ca (qua 0h → checkout > 1440).
  const shiftMidnight = parseISO(date + 'T00:00:00').getTime()
  const absMin = (iso: string) => Math.round((parseISO(iso).getTime() - shiftMidnight) / 60000)

  const first = punches[0]!
  const last = punches[punches.length - 1]!
  const checkInAbs = absMin(first.punchedAt)
  const checkOutAbs = absMin(last.punchedAt)
  const isOpen = punches.length % 2 === 1

  // Tổng giờ = cộng các phiên (cặp), không trừ nghỉ — dùng phút tuyệt đối để đúng ca qua 0h.
  let totalWork = 0
  for (let i = 0; i + 1 < punches.length; i += 2) {
    const a = absMin(punches[i]!.punchedAt)
    const b = absMin(punches[i + 1]!.punchedAt)
    totalWork += Math.max(0, (b - a) / 60)
  }

  const lateMin = checkInAbs <= graceIn ? 0 : Math.max(0, Math.round(checkInAbs - startMin))
  const earlyMin = isOpen || checkOutAbs >= graceOutAbs ? 0 : Math.max(0, Math.round(endMinAbs - checkOutAbs))
  if (lateMin > 0) issues |= AttendanceIssue.Late
  if (earlyMin > 0) issues |= AttendanceIssue.EarlyLeave
  if (isOpen && punches.length >= 1) issues |= AttendanceIssue.MissingCheckOut

  if (lateMin > 0) status = 2
  else if (earlyMin > 0) status = 3
  else status = punches.length >= 2 ? 1 : 5

  // OT: chấm ra muộn hơn kết thúc ca + có đơn OT đã duyệt → phân loại theo ngày của OT
  let overtimeHours = 0, otWeekday = 0, otWeekend = 0, otHoliday = 0, nightOt = 0
  if (!isOpen && checkOutAbs > endMinAbs && otApproved) {
    overtimeHours = Math.max(0, Math.round((checkOutAbs - endMinAbs) / 60 * 100) / 100)
    const dt = dayType(otDate)
    if (dt === 'holiday') otHoliday = overtimeHours
    else if (dt === 'weekend') otWeekend = overtimeHours
    else otWeekday = overtimeHours
    // OT đêm: phần OT giao cửa sổ đêm (áp dụng cả ca đêm & ca tối)
    nightOt = Math.round((nightOverlapMin(endMinAbs, checkOutAbs) / 60) * 100) / 100
  }

  // Giờ đêm (22h-06h) của toàn phiên làm việc — phụ cấp đêm 30%
  const nightH = Math.round((nightOverlapMin(checkInAbs, checkOutAbs) / 60) * 100) / 100

  upsertRecord({
    ...base,
    check_in_time: minutesToTimeStr(checkInAbs % 1440),
    check_out_time: isOpen ? null : minutesToTimeStr(checkOutAbs % 1440),
    actual_work_hours: Math.round(totalWork * 100) / 100,
    late_minutes: lateMin, early_leave_minutes: earlyMin, overtime_hours: overtimeHours,
    ot_weekday_hours: otWeekday, ot_weekend_hours: otWeekend, ot_holiday_hours: otHoliday,
    night_hours: nightH, night_ot_hours: nightOt,
    status, main_status: issues === 0 ? 1 : 2, issues,
  })
  return recomputeRead(employeeId, date)
}

function recomputeRead(employeeId: string, date: string) {
  return getRecord(employeeId, date)
}

function upsertRecord(r: any): void {
  r.updated_at = isoNow()
  const idx = db.prepare('SELECT 1 FROM attendance_records WHERE id = ?').get(r.id)
  if (idx) {
    db.prepare(`UPDATE attendance_records SET shift_id=?, shift_name=?, check_in_time=?, check_out_time=?,
      actual_work_hours=?, work_hours=?, late_minutes=?, early_leave_minutes=?, overtime_hours=?,
      ot_weekday_hours=?, ot_weekend_hours=?, ot_holiday_hours=?, night_hours=?, night_ot_hours=?,
      status=?, main_status=?, approval_status=?, issues=?, notes=?, is_active=?, updated_at=? WHERE id=?`).run(
      r.shift_id, r.shift_name, r.check_in_time, r.check_out_time, r.actual_work_hours, r.work_hours,
      r.late_minutes, r.early_leave_minutes, r.overtime_hours,
      r.ot_weekday_hours, r.ot_weekend_hours, r.ot_holiday_hours, r.night_hours, r.night_ot_hours,
      r.status, r.main_status, r.approval_status, r.issues, r.notes, r.is_active, r.updated_at, r.id)
  } else {
    db.prepare(`INSERT INTO attendance_records (id, employee_id, date, shift_id, shift_name, check_in_time,
      check_out_time, actual_work_hours, work_hours, late_minutes, early_leave_minutes, overtime_hours,
      ot_weekday_hours, ot_weekend_hours, ot_holiday_hours, night_hours, night_ot_hours,
      status, main_status, approval_status, issues, notes, is_active, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      r.id, r.employee_id, r.date, r.shift_id, r.shift_name, r.check_in_time, r.check_out_time,
      r.actual_work_hours, r.work_hours, r.late_minutes, r.early_leave_minutes, r.overtime_hours,
      r.ot_weekday_hours, r.ot_weekend_hours, r.ot_holiday_hours, r.night_hours, r.night_ot_hours,
      r.status, r.main_status, r.approval_status, r.issues, r.notes, r.is_active, r.created_at, r.updated_at)
  }
  // Đồng bộ is_check_in theo thứ tự + attendance_record_id
  const punches = punchesOfDay(r.employee_id, r.date)
  punches.forEach((p: any, i: number) => {
    db.prepare('UPDATE punches SET is_check_in=?, attendance_record_id=? WHERE id=?')
      .run(i % 2 === 0 ? 1 : 0, r.id, p.id)
  })
}

/** Xử lý 1 lượt chấm công mới. */
export function processPunch(
  employeeId: string, source: number,
  payload: { latitude?: number; longitude?: number; accuracy?: number; wifiSsid?: string; notes?: string; snapshotBase64?: string | null; fixedPunchedAt?: string },
): any {
  // Mặc định dùng giờ VN hiện tại; máy chấm công vật lý có thể đẩy mốc giờ riêng (fixedPunchedAt, naive VN).
  let now: Date = nowVn()
  let date = ymd(now)
  let nowMin = now.getHours() * 60 + now.getMinutes()
  let nowIso = vnIso(now)
  const fixed = payload.fixedPunchedAt
  if (fixed) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(fixed)
    if (m) {
      now = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))
      date = `${m[1]}-${m[2]}-${m[3]}`
      nowMin = Number(m[4]) * 60 + Number(m[5])
      nowIso = fixed
    }
  }
  const dupWin = duplicateWindowSec()

  // ---- Ca đêm qua 0h ----
  const yesterday = ymd(addDays(now, -1))
  const ySched = getSchedule(employeeId, yesterday)
  const yShift = getShift(ySched?.shiftId ?? null)
  if (yShift?.isOvernight) {
    const yPunches = punchesOfDay(employeeId, yesterday)
    const open = yPunches.length % 2 === 1 && yPunches.length > 0
    const endMin = timeStrToMinutes(yShift.endTime)!
    if (open && nowMin >= endMin && nowMin <= endMin + GRACE_OVERNIGHT_MIN) {
      const last = yPunches[yPunches.length - 1]!
      if (secDiff(last.punchedAt, nowIso) < dupWin) return dupResponse()
      insertPunch(employeeId, yesterday, nowIso, source, payload, false)
      const rec = recomputeRecord(employeeId, yesterday)
      return successResponse(rec, employeeId, yesterday)
    }
  }

  // ---- Chống trùng trong cửa sổ N giây (lấy lần đầu) ----
  const todayPunches = punchesOfDay(employeeId, date)
  if (todayPunches.length > 0) {
    const last = todayPunches[todayPunches.length - 1]!
    if (secDiff(last.punchedAt, nowIso) < dupWin) return dupResponse()
  }

  const isCheckIn = todayPunches.length % 2 === 0
  insertPunch(employeeId, date, nowIso, source, payload, isCheckIn)
  const rec = recomputeRecord(employeeId, date)
  return successResponse(rec, employeeId, date)
}

function insertPunch(employeeId: string, date: string, iso: string, source: number,
  payload: any, isCheckIn: boolean): void {
  const deviceInfo = source === 1 ? 'Máy chấm công' : 'Web'
  db.prepare(`INSERT INTO punches (id, employee_id, date, punched_at, source, device_info, latitude, longitude,
    accuracy, wifi_ssid, notes, snapshot_base64, attendance_record_id, is_check_in, is_active, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    uid('p'), employeeId, date, iso, source, deviceInfo, payload.latitude ?? null, payload.longitude ?? null,
    payload.accuracy ?? null, payload.wifiSsid ?? null, payload.notes ?? null, payload.snapshotBase64 ?? null,
    null, isCheckIn ? 1 : 0, 1, iso)
}

function secDiff(aIso: string, bIso: string): number {
  const a = parseISO(aIso).getTime()
  const b = parseISO(bIso).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return Infinity
  return Math.abs((b - a) / 1000)
}

function dupResponse() {
  const win = duplicateWindowSec()
  return {
    success: false,
    message: `Bạn vừa chấm công cách đây ít hơn ${win} giây — vui lòng đợi ít nhất 1 phút để chấm lại (tránh bấm nhầm). Lần chấm đầu tiên trong cửa sổ ${win}s được ghi nhận, các lần sau bị bỏ qua.`,
    checkIn: null, checkOut: null, totalPunches: 0, totalWorkHours: 0, nextAction: 'check_in', completed: false,
  }
}

function successResponse(rec: any, employeeId: string, date: string) {
  const punches = punchesOfDay(employeeId, date)
  let total = 0
  for (let i = 1; i < punches.length; i += 2) {
    const a = vnIsoToMinutes(punches[i - 1]!.punchedAt)
    const b = vnIsoToMinutes(punches[i]!.punchedAt)
    total += Math.max(0, (b - a) / 60)
  }
  const completed = rec?.checkInTime != null && rec?.checkOutTime != null
  const justCheckedIn = punches.length % 2 === 1 // lượt lẻ = vừa chấm VÀO
  const nextAction = completed ? 'completed' : justCheckedIn ? 'check_out' : 'check_in'
  return {
    success: true,
    message: completed ? 'Đã chấm ra. Chấm công hôm nay hoàn tất!' : justCheckedIn ? 'Chấm vào thành công!' : 'Chấm ra thành công!',
    checkIn: rec?.checkInTime ?? null, checkOut: rec?.checkOutTime ?? null,
    totalPunches: punches.length, totalWorkHours: Math.round(total * 100) / 100, nextAction, completed,
  }
}

export function proxyPunch(targetEmployeeId: string, source: number, payload: any): any {
  return processPunch(targetEmployeeId, source, payload)
}

/** Tính lại toàn bộ bản ghi của 1 NV (sau khi sửa ca). */
export function recomputeAll(employeeId: string): void {
  const dates = db.prepare('SELECT DISTINCT date FROM attendance_records WHERE employee_id = ?').all(employeeId) as any[]
  for (const d of dates) recomputeRecord(employeeId, d.date)
}