import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeDirectorPayroll, normalizeDirectorReport, normalizePayrollSheet, normalizeSummaryTimesheet } from './financialApiCompatibility.ts'

const legacySummary = { id: 's1', period: '2026091', status: 2, details: [] }
const payslip = { id: 'p1', period: '2026091', gross: 120, net: 100 }

test('adds safe action capabilities to legacy summary rows', () => {
  const summary = normalizeSummaryTimesheet(legacySummary)
  assert.equal(summary.version, 1)
  assert.deepEqual(summary.capabilities, {
    canRebuild: true,
    canConfirmHr: true,
    canTransferPayroll: true,
    canApprovePayroll: false,
  })
})

test('keeps current summary capabilities unchanged', () => {
  const current = { ...legacySummary, version: 4, capabilities: { canRebuild: false, canConfirmHr: false, canTransferPayroll: false, canApprovePayroll: true } }
  assert.deepEqual(normalizeSummaryTimesheet(current), current)
})

test('wraps a legacy payslip array in the current payroll sheet contract', () => {
  const sheet = normalizePayrollSheet([payslip], '2026091')
  assert.equal(sheet.period, '2026091')
  assert.deepEqual(sheet.payslips, [payslip])
})

test('aggregates the legacy director payroll array', () => {
  assert.deepEqual(normalizeDirectorPayroll([payslip]), {
    period: '2026091', status: 4, version: 1, headcount: 1, totalGross: 120, totalNet: 100, canApprove: true,
  })
})

test('marks legacy director reports as detail projection', () => {
  const report = normalizeDirectorReport({ employees: [{ name: 'A', paidUnits: 8, otHours: 1, late: 0, net: 100 }] })
  assert.equal(report.projection, 'detail')
  assert.equal(report.payroll?.totalNet, 100)
})

