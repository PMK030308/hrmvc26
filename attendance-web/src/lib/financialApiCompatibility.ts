import type { PayrollAggregate, PayrollSheet, SummaryTimesheet } from '@/types'

const emptyCapabilities = {
  canRebuild: false,
  canConfirmHr: false,
  canTransferPayroll: false,
  canApprovePayroll: false,
}

export function normalizeSummaryTimesheet(value: any): SummaryTimesheet {
  if (value?.capabilities && Number.isFinite(value?.version)) return value as SummaryTimesheet
  const status = Number(value?.status ?? 0)
  return {
    ...value,
    version: Number(value?.version ?? 1),
    confirmedBy: value?.confirmedBy ?? null,
    confirmedAt: value?.confirmedAt ?? null,
    transferredBy: value?.transferredBy ?? null,
    transferredAt: value?.transferredAt ?? null,
    approvedBy: value?.approvedBy ?? null,
    approvedAt: value?.approvedAt ?? null,
    capabilities: {
      canRebuild: true,
      canConfirmHr: status === 2,
      canTransferPayroll: status <= 3,
      canApprovePayroll: false,
    },
  } as SummaryTimesheet
}

export function normalizePayrollSheet(value: unknown, period: string): PayrollSheet {
  if (value && !Array.isArray(value) && typeof value === 'object' && Array.isArray((value as PayrollSheet).payslips)) return value as PayrollSheet
  const payslips = Array.isArray(value) ? value : []
  return { period, status: 4, version: 1, payslips, capabilities: emptyCapabilities } as PayrollSheet
}

export function normalizeDirectorPayroll(value: unknown): PayrollAggregate | null {
  if (!Array.isArray(value)) return value as PayrollAggregate | null
  if (value.length === 0) return null
  return {
    period: String(value[0]?.period ?? ''),
    status: 4,
    version: 1,
    headcount: value.length,
    totalGross: value.reduce((sum, row) => sum + Number(row?.gross ?? 0), 0),
    totalNet: value.reduce((sum, row) => sum + Number(row?.net ?? 0), 0),
    canApprove: true,
  }
}

export function normalizeDirectorReport(value: any) {
  if (value?.projection) return value
  const employees = Array.isArray(value?.employees) ? value.employees : []
  return {
    ...value,
    employees,
    payroll: {
      totalNet: employees.reduce((sum: number, row: any) => sum + Number(row?.net ?? 0), 0),
      totalGross: 0,
    },
    projection: 'detail' as const,
  }
}

