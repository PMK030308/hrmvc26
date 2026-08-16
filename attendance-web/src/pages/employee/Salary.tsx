import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Wallet, ChevronRight, FileText } from 'lucide-react'
import { payrollApi } from '@/api/timesheet'
import { fmtCurrency } from '@/lib/format'

import { Card, CardHeader, CardBody, PageHeader, Spinner, EmptyState, Table, Tr, Td, Badge } from '@/components/ui'
import { PAYROLL_COMPONENT_LABEL } from '@/constants/enums'


function periodLabel(p: string): string {
  const y = p.slice(0, 4); const m = p.slice(4, 6); const h = p.slice(6)
  return `Tháng ${m}/${y} · ${h === '1' ? 'nửa đầu (1–15)' : 'nửa cuối (16–cuối)'}`
}

export default function SalaryPage() {
  const { data, isLoading } = useQuery({ queryKey: ['payroll', 'mine'], queryFn: () => payrollApi.mine() })
  const [selected, setSelected] = useState<string | null>(null)
  if (isLoading) return <Card className="p-5"><Spinner /></Card>
  const list = data?.list ?? []
  const slip = selected ? list.find((p) => p.period === selected) : data?.latest ?? null

  return (
    <div>
      <PageHeader title="Lương" subtitle="Phiếu lương theo kỳ thanh toán" />
      {list.length === 0 ? <Card><EmptyState icon={<Wallet className="h-6 w-6" />} title="Chưa có phiếu lương" description="Phiếu lương sẽ xuất hiện sau khi HR chuyển bảng công." /></Card> : (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader title="Lịch sử kỳ lương" icon={<FileText className="h-4 w-4" />} />
            <div className="divide-y divide-slate-100">
              {list.map((p) => (
                <button key={p.period} onClick={() => setSelected(p.period)}
                  className={`flex w-full items-center justify-between px-5 py-3 text-left transition hover:bg-slate-50 ${(slip?.period === p.period) ? 'bg-brand-50' : ''}`}>
                  <div>
                    <p className="text-sm font-medium text-slate-800">{periodLabel(p.period)}</p>
                    <p className="text-xs text-slate-500">Lý nhận: {fmtCurrency(p.net)}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </button>
              ))}
            </div>
          </Card>

          {slip && (
            <Card className="lg:col-span-2">
              <CardHeader title={periodLabel(slip.period)} subtitle={slip.employeeName} icon={<Wallet className="h-4 w-4" />} />
              <CardBody>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat label="Lương cơ bản" value={fmtCurrency(slip.baseSalary)} />
                  <Stat label="Công hưởng" value={fmtCurrency(slip.paidWork)} tone="success" />
                  <Stat label="Làm thêm" value={fmtCurrency(slip.overtime)} tone="info" />
                  <Stat label="Phụ cấp" value={fmtCurrency(slip.allowance)} />
                  <Stat label="Khấu trừ" value={fmtCurrency(slip.deductions)} tone="danger" />
                  <Stat label="Thực lĩnh" value={fmtCurrency(slip.net)} tone="brand" />
                </div>
                <h4 className="mt-5 mb-2 text-sm font-semibold text-slate-700">Chi tiết khoản</h4>
                <Table headers={['Khoản', 'Loại', 'Số tiền']}>
                  {slip.components.map((c, i) => (
                    <Tr key={i}>
                      <Td>{c.name}</Td>
                      <Td><Badge tone={c.amount >= 0 ? 'success' : 'danger'}>{PAYROLL_COMPONENT_LABEL[c.type]}</Badge></Td>
                      <Td className={c.amount >= 0 ? 'font-semibold text-slate-800' : 'font-semibold text-danger-600'}>{fmtCurrency(c.amount)}</Td>
                    </Tr>
                  ))}
                  <Tr className="bg-slate-50 font-bold">
                    <Td>Thực lĩnh (NET)</Td><Td>{''}</Td><Td className="text-brand-700">{fmtCurrency(slip.net)}</Td>
                  </Tr>
                </Table>
                <p className="mt-3 text-xs text-slate-400">Phiếu tạo dựa trên bảng công kỳ {slip.period}. Nếu sai sót, liên hệ HR/ kế toán.</p>
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'brand' | 'success' | 'danger' | 'info' }) {
  const cls = tone === 'brand' ? 'text-brand-700' : tone === 'success' ? 'text-success-700' : tone === 'danger' ? 'text-danger-600' : tone === 'info' ? 'text-info-600' : 'text-slate-800'
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-base font-bold ${cls}`}>{value}</p>
    </div>
  )
}