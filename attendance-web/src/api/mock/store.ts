// ============================================================================
// Mock DB in-memory + persist localStorage. Một "singleton" cho toàn app.
// ============================================================================
import type {
  Department, Position, Branch, Employee, Shift, ShiftSchedule, AttendancePunch,
  AttendanceRecord, LeaveType, LeaveBalance, AttendanceRegulation, AnyRequest,
  AppNotification, SummaryTimesheet, Payslip, AuditLog, User, RequestAttachment,
} from '@/types'
import {
  branches, departments, positions, employees, users, shifts, leaveTypes,
  seedLeaveBalances, regulation,
} from './seed'
import { ymd, addDays, timeStrToMinutes } from '@/lib/date'

const DB_KEY = 'hrm-attendance-db-v3'

export interface DB {
  branches: Branch[]
  departments: Department[]
  positions: Position[]
  employees: Employee[]
  users: User[]
  shifts: Shift[]
  shiftSchedules: ShiftSchedule[]
  punches: AttendancePunch[]
  records: AttendanceRecord[]
  leaveTypes: LeaveType[]
  leaveBalances: LeaveBalance[]
  regulation: AttendanceRegulation
  requests: AnyRequest[]
  attachments: RequestAttachment[]
  notifications: AppNotification[]
  summaryTimesheets: SummaryTimesheet[]
  payslips: Payslip[]
  auditLogs: AuditLog[]
  tokens: Record<string, string> // token -> userId
}

let db: DB | null = null

/** Sinh phân ca mặc định 30 ngày gần đây cho ca hành chính (toàn công ty) + ca đêm cho 2 NV. */
function seedSchedulesAndPunches(): { schedules: ShiftSchedule[]; punches: AttendancePunch[]; records: AttendanceRecord[] } {
  const schedules: ShiftSchedule[] = []
  const punches: AttendancePunch[] = []
  const records: AttendanceRecord[] = []

  const today = new Date()
  // 30 ngày trước → hôm nay
  for (let i = 29; i >= 0; i--) {
    const d = addDays(today, -i)
    const date = ymd(d)
    const dow = d.getDay()
    const isWeekend = dow === 0 || dow === 6

    for (const e of employees) {
      // IT/HR/Accountant → ca hành chính; 2 dev → ca đêm xoay (chỉ demo cho dev2, dev3)
      let shiftId = 'shift-office'
      if (e.id === 'emp-dev3') shiftId = 'shift-night'
      if (isWeekend) {
        // cuối tuần: hầu hết nghỉ, trừ ca đêm vẫn có
        if (shiftId !== 'shift-night') continue
      }
      if (e.status !== 2) continue
      schedules.push({
        id: `sch-${e.id}-${date}`, employeeId: e.id, shiftId, date,
        ruleId: null, isActive: true,
      })

      // Chấm công mẫu cho quá khứ (i > 0) — bỏ qua hôm nay để NV tự chấm thử
      if (i === 0) continue
      const shift = shifts.find((s) => s.id === shiftId)!
      const startMin = timeStrToMinutes(shift.startTime)!
      const endMin = timeStrToMinutes(shift.endTime)!
      // Vào: trễ 0-12 phút ngẫu nhiên; Ra: sớm 0-15 phút hoặc đúng giờ
      const lateRand = (e.id.charCodeAt(e.id.length - 1) + i) % 13
      const earlyRand = (i + e.id.length) % 16
      // nghỉ phép giả lập vài ngày
      const onLeave = (i === 20 && e.id === 'emp-dev1') || (i === 15 && e.id === 'emp-sale1')
      if (onLeave) continue

      const checkInMin = startMin + lateRand
      const checkOutMin = endMin - earlyRand

      // Tạo 2 lượt chấm (vào/ra) — giờ VN; lưu UTC (trừ 7h)
      const baseDate = d
      const makeUtc = (minOfDay: number): string => {
        const dt = new Date(baseDate)
        dt.setHours(0, 0, 0, 0)
        dt.setMinutes(minOfDay - 7 * 60) // trừ offset để lưu "UTC"
        return dt.toISOString()
      }

      const recId = `rec-${e.id}-${date}`
      punches.push({
        id: `p-${e.id}-${date}-in`, employeeId: e.id, date,
        punchedAt: makeUtc(checkInMin), source: pickSource(e.id),
        deviceInfo: 'Web', latitude: 21.0137, longitude: 105.7982, accuracy: 18,
        wifiSsid: 'TechNova-Office', notes: null, snapshotBase64: null,
        attendanceRecordId: recId, isCheckIn: true, isActive: true,
        createdAt: makeUtc(checkInMin),
      })
      punches.push({
        id: `p-${e.id}-${date}-out`, employeeId: e.id, date,
        punchedAt: makeUtc(checkOutMin), source: pickSource(e.id),
        deviceInfo: 'Web', latitude: 21.0137, longitude: 105.7982, accuracy: 18,
        wifiSsid: 'TechNova-Office', notes: null, snapshotBase64: null,
        attendanceRecordId: recId, isCheckIn: false, isActive: true,
        createdAt: makeUtc(checkOutMin),
      })

      const workHours = (checkOutMin - checkInMin) / 60 - (shift.breakEndTime && shift.breakStartTime ? (timeStrToMinutes(shift.breakEndTime)! - timeStrToMinutes(shift.breakStartTime)!) / 60 : 0)
      const lateMin = lateRand > 0 ? lateRand : 0
      const earlyMin = earlyRand > 0 ? earlyRand : 0
      const status = lateMin > 0 ? 2 : earlyMin > 0 ? 3 : 1
      records.push({
        id: recId, employeeId: e.id, date, shiftId, shiftName: shift.name,
        checkInTime: minToHHmm(checkInMin), checkOutTime: minToHHmm(checkOutMin),
        actualWorkHours: Math.max(0, workHours), workHours: shift.workDays,
        lateMinutes: lateMin, earlyLeaveMinutes: earlyMin, overtimeHours: 0,
        status: status as 1 | 2 | 3, mainStatus: 1, approvalStatus: 0, issues: lateMin > 0 ? 1 : earlyMin > 0 ? 2 : 0,
        notes: null, isActive: true,
        createdAt: makeUtc(checkInMin), updatedAt: makeUtc(checkOutMin),
      })
    }
  }
  return { schedules, punches, records }
}

function pickSource(empId: string): 1 | 2 | 3 | 4 | 5 {
  const idx = empId.charCodeAt(empId.length - 1) % 5
  const arr: (1 | 2 | 3 | 4 | 5)[] = [1, 2, 3, 4, 5]
  return arr[idx]!
}

function minToHHmm(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function freshDB(): DB {
  const seeded = seedSchedulesAndPunches()
  return {
    branches, departments, positions, employees, users, shifts,
    shiftSchedules: seeded.schedules, punches: seeded.punches, records: seeded.records,
    leaveTypes, leaveBalances: seedLeaveBalances(), regulation,
    requests: [], attachments: [], notifications: [], summaryTimesheets: [],
    payslips: [], auditLogs: [], tokens: {},
  }
}

export function getDB(): DB {
  if (db) return db
  try {
    const raw = localStorage.getItem(DB_KEY)
    if (raw) {
      db = JSON.parse(raw) as DB
      return db
    }
  } catch {
    /* ignore */
  }
  db = freshDB()
  saveDB()
  return db
}

export function saveDB(): void {
  if (!db) return
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db))
  } catch {
    /* quota — bỏ qua */
  }
}

/** Reset về dữ liệu mẫu (nút trong trang Admin). */
export function resetDB(): void {
  db = freshDB()
  saveDB()
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}