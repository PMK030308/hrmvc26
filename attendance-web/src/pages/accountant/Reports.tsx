import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Download, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { payrollApi } from '@/api/timesheet'
import { fmtCurrency } from '@/lib/format'
import { PAYROLL_COMPONENT_LABEL } from '@/constants/enums'
import { PageHeader, Card, CardHeader, Spinner, EmptyState, Table, Tr, Td, Button, StatCard, Select, ProgressBar } from '@/components/ui'
import type { PayrollComponentType } from '@/types'

function periodLabel(p: string): string {
  const y = p.slice(0, 4); const m = p.slice(4, 6); const h = p.slice(6)
  return `Tháng ${m}/${y} · ${h === '1' ? 'nửa đầu (1–15)' : 'nửa cuối (16–cuối)'}`
}

export default function AccountantReports() {
  const { data: periods, isLoading } = useQuery({ queryKey: ['payroll', 'periods'], queryFn: () => payrollApi.periods() })
  const [period, setPeriod] = useState('')
  const active = period || (periods?.[0] ?? '')
  const { data: sheet, isLoading: ls } = useQuery({ queryKey: ['payroll', 'sheet', active], queryFn: () => payrollApi.sheet(active), enabled: !!active })

  const totals = useMemo(() => {
    const s = sheet ?? []
    return {
      gross: s.reduce((a, p) => a + p.gross, 0),
      net: s.reduce((a, p) => a + p.net, 0),
      deductions: s.reduce((a, p) => a + p.deductions, 0),
      ot: s.reduce((a, p) => a + p.overtime, 0),
    }
  }, [sheet])

  const byType = useMemo(() => {
    const map = new Map<PayrollComponentType, number>()
    for (const p of sheet ?? []) for (const c of p.components) map.set(c.type, (map.get(c.type) ?? 0) + c.amount)
    return [...map.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  }, [sheet])

  function exportCsv() {
    if (!sheet || sheet.length === 0) { toast.error('Chưa có dữ liệu'); return }
    const out = [['Nhân viên', 'Cơ bản', 'Công hưởng', 'OT', 'Phụ cấp', 'Bảo hiểm', 'Thuế', 'Khấu trừ', 'Thực lĩnh']]
      .concat(sheet.map((p) => {
        const ins = p.components.find((c) => c.type === 7)?.amount ?? 0
        const tax = p.components.find((c) => c.type === 8)?.amount ?? 0
        return [p.employeeName, String(p.baseSalary), String(p.paidWork), String(p.overtime), String(p.allowance), String(ins), String(tax), String(p.deductions), String(p.net)]
      }))
    const csv = '﻿' + out.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `finance-${active}.csv`; a.click(); URL.revokeObjectURL(url)
    toast.success('Đã xuất CSV')
  }

  return (
    <div>
      <PageHeader title="Báo cáo tài chính" subtitle="Tổng hợp khoản lương & khấu trừ theo kỳ" actions={
        <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={!sheet?.length}>Xuất CSV</Button>
      } />

      <Card className="mb-5 p-4">
        <Select label="Kỳ lương" value={active} onChange={(e) => setPeriod(e.target.value)} className="w-72">
          {(periods ?? []).map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
        </Select>
      </Card>

      {isLoading || ls ? <Card className="p-5"><Spinner /></Card> : !sheet || sheet.length === 0 ? <Card><EmptyState icon={<BarChart3 className="h-6 w-6" />} title="Chưa có dữ liệu kỳ này" /></Card> : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Tổng Gross" value={fmtCurrency(totals.gross)} icon={<TrendingUp className="h-5 w-5" />} tone="info" />
            <StatCard label="Tổng khấu trừ" value={fmtCurrency(totals.deductions)} icon={<TrendingDown className="h-5 w-5" />} tone="danger" />
            <StatCard label="Chi phí OT" value={fmtCurrency(totals.ot)} icon={<Wallet className="h-5 w-5" />} tone="warning" />
            <StatCard label="Tổng thực lĩnh" value={fmtCurrency(totals.net)} icon={<Wallet className="h-5 w-5" />} tone="brand" />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Phân tích theo khoản" subtitle={periodLabel(active)} icon={<BarChart3 className="h-4 w-4" />} />
              <div className="divide-y divide-slate-100">
                {byType.map(([type, amt]) => {
                  const pct = totals.gross ? Math.min(100, Math.round((Math.abs(amt) / totals.gross) * 100)) : 0
                  return (
                    <div key={type} className="px-5 py-3">
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="font-medium text-slate-700">{PAYROLL_COMPONENT_LABEL[type]}</span>
                        <span className={amt >= 0 ? 'font-semibold text-slate-800' : 'font-semibold text-danger-600'}>{fmtCurrency(amt)}</span>
                      </div>
                      <ProgressBar value={pct} tone={amt >= 0 ? 'brand' : 'danger'} />
                    </div>
                  )
                })}
              </div>
            </Card>

            <Card>
              <CardHeader title="Thực lĩnh theo nhân viên" icon={<Wallet className="h-4 w-4" />} />
              <Table headers={['Nhân viên', 'Gross', 'Khấu trừ', 'NET']}>
                {sheet.map((p) => (
                  <Tr key={p.id}>
                    <Td className="font-medium text-slate-800">{p.employeeName}</Td>
                    <Td>{fmtCurrency(p.gross)}</Td><Td className="text-danger-600">-{fmtCurrency(p.deductions)}</Td>
                    <Td className="font-bold text-brand-700">{fmtCurrency(p.net)}</Td>
                  </Tr>
                ))}
              </Table>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}