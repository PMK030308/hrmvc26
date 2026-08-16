import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeDollarSign, FileText, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { payrollApi } from '@/api/timesheet'
import { fmtCurrency } from '@/lib/format'
import { PageHeader, Card, CardHeader, Spinner, EmptyState, Table, Tr, Td, Button, StatCard, ConfirmDialog } from '@/components/ui'

function periodLabel(p: string): string {
  const y = p.slice(0, 4); const m = p.slice(4, 6); const h = p.slice(6)
  return `Tháng ${m}/${y} · ${h === '1' ? 'nửa đầu (1–15)' : 'nửa cuối (16–cuối)'}`
}

export default function DirectorPayroll() {
  const qc = useQueryClient()
  const { data: periods, isLoading } = useQuery({ queryKey: ['payroll', 'periods'], queryFn: () => payrollApi.periods() })
  const [period, setPeriod] = useState('')
  const [approve, setApprove] = useState<string | null>(null)
  const active = period || (periods?.[0] ?? '')
  const { data: sheet, isLoading: ls } = useQuery({ queryKey: ['payroll', 'sheet', active], queryFn: () => payrollApi.sheet(active), enabled: !!active })

  const doApprove = useMutation({
    mutationFn: (p: string) => payrollApi.approvePayroll(p),
    onSuccess: () => { toast.success('Đã duyệt kỳ lương'); setApprove(null); qc.invalidateQueries({ queryKey: ['payroll', 'periods'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const totalNet = (sheet ?? []).reduce((s, p) => s + p.net, 0)
  const totalGross = (sheet ?? []).reduce((s, p) => s + p.gross, 0)

  return (
    <div>
      <PageHeader title="Kỳ lương" subtitle="Xem & phê duyệt kỳ lương" />

      <div className="grid gap-5 lg:grid-cols-4">
        <Card className="lg:col-span-1">
          <CardHeader title="Kỳ lương" icon={<FileText className="h-4 w-4" />} />
          {isLoading ? <div className="p-5"><Spinner /></div> : (periods ?? []).length === 0 ? <EmptyState icon={<BadgeDollarSign className="h-6 w-6" />} title="Chưa có kỳ lương" /> : (
            <div className="divide-y divide-slate-100">
              {periods!.map((p) => (
                <button key={p} onClick={() => setPeriod(p)} className={`flex w-full items-center justify-between px-5 py-3 text-left hover:bg-slate-50 ${active === p ? 'bg-brand-50' : ''}`}>
                  <span className="text-sm font-medium text-slate-800">{periodLabel(p)}</span>
                </button>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-5 lg:col-span-3">
          {ls ? <Card className="p-5"><Spinner /></Card> : !sheet || sheet.length === 0 ? <Card><EmptyState icon={<BadgeDollarSign className="h-6 w-6" />} title="Không có phiếu lương" /></Card> : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="grid flex-1 grid-cols-3 gap-4">
                  <StatCard label="Tổng NET" value={fmtCurrency(totalNet)} icon={<BadgeDollarSign className="h-5 w-5" />} tone="brand" />
                  <StatCard label="Tổng Gross" value={fmtCurrency(totalGross)} icon={<BadgeDollarSign className="h-5 w-5" />} tone="info" />
                  <StatCard label="Số phiếu" value={sheet.length} icon={<FileText className="h-5 w-5" />} tone="success" />
                </div>
                <Button variant="success" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setApprove(active)}>Duyệt kỳ này</Button>
              </div>
              <Card>
                <CardHeader title={periodLabel(active)} subtitle={`${sheet.length} phiếu`} icon={<BadgeDollarSign className="h-4 w-4" />} />
                <Table headers={['Nhân viên', 'Cơ bản', 'Công hưởng', 'OT', 'Khấu trừ', 'Thực lĩnh']}>
                  {sheet.map((p) => (
                    <Tr key={p.id}>
                      <Td className="font-medium text-slate-800">{p.employeeName}</Td>
                      <Td>{fmtCurrency(p.baseSalary)}</Td><Td>{fmtCurrency(p.paidWork)}</Td>
                      <Td>{fmtCurrency(p.overtime)}</Td><Td className="text-danger-600">-{fmtCurrency(p.deductions)}</Td>
                      <Td className="font-bold text-brand-700">{fmtCurrency(p.net)}</Td>
                    </Tr>
                  ))}
                </Table>
              </Card>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog open={!!approve} onClose={() => setApprove(null)} title="Duyệt kỳ lương"
        message={`Xác nhận duyệt kỳ ${approve ? periodLabel(approve) : ''}? Hành động sẽ được ghi vào audit log.`}
        confirmText="Duyệt" onConfirm={() => approve && doApprove.mutate(approve)} />
    </div>
  )
}