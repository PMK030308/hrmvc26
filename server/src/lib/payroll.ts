// ============================================================================
// Tính lương / OT theo Bộ luật Lao động 2019 (Điều 98 + Điều 55).
//  - OT ngày thường: ≥150%, cuối tuần: ≥200%, lễ tết: ≥300%
//  - Phụ cấp đêm (22h-06h): +30% lương giờ (nightCoeff - 1)
//  - OT đêm: cộng thêm +20% lương giờ ngày thường (nightOtExtra)
// Hệ số/cap lấy từ bảng regulation (có thể chỉnh trong trang Quy định).
// ============================================================================
import { getRegulation } from '../repo.js'

export interface OtBreakdown {
  otWeekday: number
  otWeekend: number
  otHoliday: number
  night: number
  nightOt: number
}

export function hourlyWage(monthlyWage: number): number {
  const reg = getRegulation()
  const std = reg?.standardMonthlyHours ?? 160
  return monthlyWage / std
}

/** Tiền làm thêm + phụ cấp đêm (chưa round). */
export function computeOtPay(monthlyWage: number, br: OtBreakdown): { otPay: number; nightPay: number; nightOtExtra: number } {
  const reg = getRegulation()
  const h = hourlyWage(monthlyWage)
  const wd = reg?.weekdayOtCoeff ?? 1.5
  const we = reg?.weekendOtCoeff ?? 2.0
  const hl = reg?.holidayOtCoeff ?? 3.0
  const nc = reg?.nightCoeff ?? 1.3
  const ne = reg?.nightOtExtra ?? 0.2
  const otPay = h * (br.otWeekday * wd + br.otWeekend * we + br.otHoliday * hl)
  const nightPay = h * br.night * (nc - 1)      // phụ cấp đêm +30%
  const nightOtExtra = h * br.nightOt * ne      // OT đêm +20%
  return { otPay, nightPay, nightOtExtra }
}

export interface PayslipInput {
  monthlyWage: number
  paidUnits: number      // số ngày công hưởng lương (work_hours)
  actualWorkHours: number
  breakdown: OtBreakdown
  allowance?: number
}

/** Tạo đầy đủ thành phần phiếu lương nửa tháng. */
export function buildPayslip(inp: PayslipInput): {
  base: number; paidWork: number; overtime: number; allowance: number
  gross: number; deductions: number; net: number; components: any[]
} {
  const base = Math.round(inp.monthlyWage / 2)
  const paidWork = Math.round(base * (inp.paidUnits / 15))
  const { otPay, nightPay, nightOtExtra } = computeOtPay(inp.monthlyWage, inp.breakdown)
  const otTotal = Math.round(otPay + nightPay + nightOtExtra)
  const allowance = Math.round(inp.allowance ?? 500_000)
  const gross = paidWork + otTotal + allowance
  const insurance = Math.round(gross * 0.105)
  const tax = Math.round(Math.max(0, gross - 11_000_000) * 0.1)
  const deductions = insurance + tax
  const net = gross - deductions
  const components = [
    { type: 1, name: 'Lương cơ bản (nửa tháng)', amount: base },
    { type: 2, name: 'Công hưởng', amount: paidWork },
    { type: 3, name: 'Làm thêm (ngày thường 1.5x)', amount: Math.round(otPay > 0 ? hourlyWage(inp.monthlyWage) * inp.breakdown.otWeekday * 1.5 : 0) },
    { type: 9, name: 'Làm thêm (cuối tuần 2x)', amount: Math.round(hourlyWage(inp.monthlyWage) * inp.breakdown.otWeekend * 2.0) },
    { type: 10, name: 'Làm thêm (lễ tết 3x)', amount: Math.round(hourlyWage(inp.monthlyWage) * inp.breakdown.otHoliday * 3.0) },
    { type: 11, name: 'Phụ cấp đêm (+30%)', amount: Math.round(nightPay) },
    { type: 12, name: 'OT đêm (+20%)', amount: Math.round(nightOtExtra) },
    { type: 4, name: 'Phụ cấp', amount: allowance },
    { type: 7, name: 'Bảo hiểm (NV)', amount: -insurance },
    { type: 8, name: 'Thuế TNCN', amount: -tax },
  ].filter((c) => c.amount !== 0)
  return { base, paidWork, overtime: otTotal, allowance, gross, deductions, net, components }
}