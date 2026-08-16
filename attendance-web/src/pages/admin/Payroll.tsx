import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BadgeDollarSign, Download, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { payrollApi } from '@/api/timesheet'
import { fmtCurrency } from '@/lib/format'
import { PageHeader, Card, CardHeader, Spinner, EmptyState, Table, Tr, Td, Button, StatCard } from '@/components/ui'
import type { Payslip } from '@/types'

export default function AdminPayroll() {
  const { data: periods, isLoading: lp } = useQuery({ queryKey: ['payroll', 'periods'], queryFn: () => payrollApi.periods() })
  const [period, setPeriod] = useState('')
  const active = period || (periods?.[0] ?? '')
  const { data: sheet, isLoading } = useQuery({ queryKey: ['payroll', 'sheet', active], queryFn: () => payrollApi.sheet(active), enabled: !!active })

  const totalNet = (sheet ?? []).reduce((s, p) => s + p.net, 0)
  const totalGross = (sheet ?? []).reduce((s, p) => s + p.gross, 0)

  function exportCsv() {
    if (!sheet || sheet.length === 0) { toast.error('Không có dữ liệu để xuất'); return }
    const rows = [['Mã NV', 'Họ tên', 'Lương cơ bản', 'Công hưởng', 'Làm thêm', 'Phụ cấp', 'Khấu trừ', 'Thực lĩnh']]
      .concat(sheet.map((p) => [p.employeeName, p.employeeName, String(p.baseSalary), String(p.paidWork), String(p.overtime), String(p.allowance), String(p.deductions), String(p.net)]))
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `payroll-${active}.csv`; a.click(); URL.revokeObjectURL(url)
    toast.success('Đã xuất CSV')
  }

  return (
    <div>
      <PageHeader title="Bảng lương" subtitle="Phiếu lương theo kỳ thanh toán" actions={
        <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={!sheet?.length}>Xuất CSV</Button>
      } />

      <div className="grid gap-5 lg:grid-cols-4">
        <Card className="lg:col-span-1">
          <CardHeader title="Kỳ lương" icon={<FileText className="h-4 w-4" />} />
          {lp ? <div className="p-5"><Spinner /></div> : (periods ?? []).length === 0 ? <EmptyState icon={<BadgeDollarSign className="h-6 w-6" />} title="Chưa có kỳ lương" description="Chuyển bảng công sang lương để sinh kỳ." /> : (
            <div className="divide-y divide-slate-100">
              {periods!.map((p) => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`flex w-full items-center justify-between px-5 py-3 text-left transition hover:bg-slate-50 ${active === p ? 'bg-brand-50' : ''}`}>
                  <span className="text-sm font-medium text-slate-800">{periodLabel(p)}</span>
                  <span className="text-xs text-slate-400">{p}</span>
                </button>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-5 lg:col-span-3">
          {isLoading ? <Card className="p-5"><Spinner /></Card> : !sheet || sheet.length === 0 ? <Card><EmptyState icon={<BadgeDollarSign className="h-6 w-6" />} title="Không có phiếu lương" /></Card> : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <StatCard label="Tổng quỹ lương (NET)" value={fmtCurrency(totalNet)} icon={<BadgeDollarSign className="h-5 w-5" />} tone="brand" />
                <StatCard label="Tổng Gross" value={fmtCurrency(totalGross)} icon={<BadgeDollarSign className="h-5 w-5" />} tone="info" />
                <StatCard label="Số phiếu" value={sheet.length} icon={<FileText className="h-5 w-5" />} tone="success" />
              </div>
              <Card>
                <CardHeader title={periodLabel(active)} subtitle={`${sheet.length} phiếu lương`} icon={<BadgeDollarSign className="h-4 w-4" />} />
                <Table headers={['Nhân viên', 'Cơ bản', 'Công hưởng', 'OT', 'Phụ cấp', 'Khấu trừ', 'Thực lĩnh']}>
                  {sheet.map((p: Payslip) => (
                    <Tr key={p.id}>
                      <Td><p className="font-medium text-slate-800">{p.employeeName}</p><p className="text-xs text-slate-400">#{p.employeeId.slice(-6)}</p></Td>
                      <Td>{fmtCurrency(p.baseSalary)}</Td><Td>{fmtCurrency(p.paidWork)}</Td>
                      <Td>{fmtCurrency(p.overtime)}</Td><Td>{fmtCurrency(p.allowance)}</Td>
                      <Td className="text-danger-600">-{fmtCurrency(p.deductions)}</Td>
                      <Td className="font-bold text-brand-700">{fmtCurrency(p.net)}</Td>
                    </Tr>
                  ))}
                </Table>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function periodLabel(p: string): string {
  const y = p.slice(0, 4); const m = p.slice(4, 6); const h = p.slice(6)
  return `Tháng ${m}/${y} · ${h === '1' ? 'nửa đầu (1–15)' : 'nửa cuối (16–cuối)'}`
}