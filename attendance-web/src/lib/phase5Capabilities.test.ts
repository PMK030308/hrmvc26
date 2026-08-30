import assert from 'node:assert/strict'
import test from 'node:test'
import { phase5Capabilities, shouldReloadFinancialState } from './phase5Capabilities'

test('phase 5 navigation capabilities derive only from effective permissions', () => {
  const scoped = phase5Capabilities([
    'timesheet.detail.view_scoped',
    'timesheet.summary.view_scoped',
    'reports.attendance.view_scoped',
  ])
  assert.equal(scoped.canViewTimesheetDetail, true)
  assert.equal(scoped.canViewSummary, true)
  assert.equal(scoped.canViewPayrollSheet, false)
  assert.equal(scoped.canViewReports, true)

  const payroll = phase5Capabilities(['payroll.sheet.view', 'reports.payroll.view_detail'])
  assert.equal(payroll.canViewTimesheetDetail, false)
  assert.equal(payroll.canViewPayrollSheet, true)
  assert.equal(payroll.canViewPayrollDetailReport, true)

  const roleNameOnly = phase5Capabilities([])
  assert.equal(roleNameOnly.canViewSummary, false)
  assert.equal(roleNameOnly.canApprovePayroll, false)
})

test('financial mutation conflicts require reload only for HTTP 409', () => {
  assert.equal(shouldReloadFinancialState({ status: 409 }), true)
  assert.equal(shouldReloadFinancialState({ status: 403 }), false)
  assert.equal(shouldReloadFinancialState(new Error('network')), false)
})
