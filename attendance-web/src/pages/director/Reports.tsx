import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Download, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { dashboardApi } from '@/api/dashboard'
import { ymd, addDays, fmtHours } from '@/lib/date'
import { fmtCurrency, fmtNum } from '@/lib/format'
import { PageHeader, Card, CardHeader, CardBody, Spinner, EmptyState, Button, Table, Tr, Td, Input, StatCard } from '@/components/ui'

export default function DirectorReports() {
  const [from, setFrom] = useState(ymd(addDays(new Date(), -29)))
  const [to, setTo] = useState(ymd(new Date()))
  const [run, setRun] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['director', 'report', from, to, run],
    queryFn: () => dashboardApi.directorReports(from, to),
  })
  const rows = data?.employees ?? []
  const showNet = data?.projection === 'detail'
  const totalNet = data?.payroll?.totalNet ?? 0
  const totalPaid = rows.reduce((s, r) => s + r.paidUnits, 0)
  const totalOt = rows.reduce((s, r) => s + r.otHours, 0)

  function exportCsv() {
    if (rows.length === 0) { toast.error('Chưa có dữ liệu'); return }
    const out = [['Nhân viên', 'Công hưởng (h)', 'Giờ OT', 'Ngày muộn', 'Thực lĩnh']]
      .concat(rows.map((r) => [r.name, String(r.paidUnits), String(r.otHours), String(r.late), String(r.net)]))
    const csv = '﻿' + out.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `director-report-${from}_${to}.csv`; a.click(); URL.revokeObjectURL(url)
    toast.success('Đã xuất CSV')
  }

  return (
    <div>
      <PageHeader title="Báo cáo" subtitle="Tổng hợp hiệu suất & chi phí lương theo khoảng thời gian" actions={
        <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={rows.length === 0}>Xuất CSV</Button>
      } />

      <Card className="mb-5">
        <CardBody><div className="flex flex-wrap items-end gap-3">
          <Input label="Từ ngày" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-44" />
          <Input label="Đến ngày" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-44" />
          <Button icon={<BarChart3 className="h-4 w-4" />} onClick={() => setRun((r) => r + 1)}>Tạo báo cáo</Button>
        </div></CardBody>
      </Card>

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Tổng công hưởng" value={fmtHours(totalPaid)} icon={<BarChart3 className="h-5 w-5" />} tone="brand" />
        <StatCard label="Tổng giờ OT" value={fmtHours(totalOt)} icon={<BarChart3 className="h-5 w-5" />} tone="info" />
        {data?.payroll && <StatCard label="Tổng thực lĩnh" value={fmtCurrency(totalNet)} icon={<Wallet className="h-5 w-5" />} tone="success" />}
      </div>

      <Card>
        <CardHeader title={`Báo cáo · ${from} → ${to}`} icon={<BarChart3 className="h-4 w-4" />} />
        {isLoading ? <div className="p-5"><Spinner /></div> : rows.length === 0 ? <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="Không có dữ liệu" /> : (
          <Table headers={['Nhân viên', 'Công hưởng', 'Giờ OT', 'Ngày muộn', ...(showNet ? ['Thực lĩnh'] : [])]}>
            {rows.map((r) => (
              <Tr key={r.name}>
                <Td className="font-medium text-slate-800">{r.name}</Td>
                <Td>{fmtHours(r.paidUnits)}</Td><Td>{fmtHours(r.otHours)}</Td><Td>{fmtNum(r.late)}</Td>
                {showNet && <Td className="font-semibold text-slate-800">{fmtCurrency(r.net ?? 0)}</Td>}
              </Tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  )
}
