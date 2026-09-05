import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { BarChart3, Download, FileText, TrendingUp, Clock3, AlertTriangle, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { dashboardApi } from '@/api/dashboard'
import { ymd, addDays, fmtHours } from '@/lib/date'
import { fmtCurrency, fmtNum } from '@/lib/format'
import { PageHeader, Card, CardHeader, CardBody, Spinner, EmptyState, Button, Table, Tr, Td, StatCard, Input, ProgressBar } from '@/components/ui'

export default function AdminReports() {
  const today = ymd(new Date())
  const [from, setFrom] = useState(ymd(addDays(new Date(), -29)))
  const [to, setTo] = useState(today)
  const [run, setRun] = useState(0)

  const { data: admin } = useQuery({ queryKey: ['dashboard', 'admin'], queryFn: () => dashboardApi.admin() })
  const { data, isLoading } = useQuery({
    queryKey: ['report', 'range', from, to, run],
    queryFn: () => dashboardApi.directorReports(from, to),
    enabled: run > 0,
  })

  const rows = data?.employees ?? []
  const totalPaid = rows.reduce((s, r) => s + r.paidUnits, 0)
  const totalOt = rows.reduce((s, r) => s + r.otHours, 0)
  const totalLate = rows.reduce((s, r) => s + r.late, 0)
  const showNet = data?.projection === 'detail'
  const totalNet = data?.payroll?.totalNet ?? 0

  const exportReport = useMutation({
    mutationFn: (format: 'excel' | 'pdf') => dashboardApi.exportReport(from, to, format),
    onSuccess: (_data, format) => toast.success(`Đã xuất báo cáo ${format === 'excel' ? 'Excel' : 'PDF'}`),
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <div>
      <PageHeader title="Báo cáo" subtitle="Phân tích chấm công & lương theo khoảng thời gian" actions={
        <div className="flex gap-2"><Button variant="secondary" icon={<Download className="h-4 w-4" />} loading={exportReport.isPending} onClick={() => exportReport.mutate('excel')} disabled={rows.length === 0}>Xuất Excel</Button>
          <Button variant="secondary" icon={<FileText className="h-4 w-4" />} loading={exportReport.isPending} onClick={() => exportReport.mutate('pdf')} disabled={rows.length === 0}>Xuất PDF</Button></div>
      } />

      <Card className="mb-5">
        <CardBody>
          <div className="flex flex-wrap items-end gap-3">
            <Input label="Từ ngày" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-44" />
            <Input label="Đến ngày" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-44" />
            <Button icon={<BarChart3 className="h-4 w-4" />} onClick={() => setRun((r) => r + 1)}>Tạo báo cáo</Button>
          </div>
        </CardBody>
      </Card>

      {admin && (
        <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Tỷ lệ đúng giờ" value={`${admin.kpi.onTimeRate}%`} icon={<TrendingUp className="h-5 w-5" />} tone="success" />
          <StatCard label="Đi muộn hôm nay" value={admin.kpi.lateToday} icon={<Clock3 className="h-5 w-5" />} tone="warning" />
          <StatCard label="Vắng hôm nay" value={admin.kpi.absentToday} icon={<AlertTriangle className="h-5 w-5" />} tone="danger" />
          <StatCard label="Đơn chờ duyệt" value={admin.kpi.pendingApprovals} icon={<BarChart3 className="h-5 w-5" />} tone="brand" />
        </div>
      )}

      {admin && (
        <Card className="mb-5">
          <CardHeader title="Tỷ lệ có mặt theo phòng ban" icon={<TrendingUp className="h-4 w-4" />} />
          <CardBody className="space-y-4">
            {admin.byDepartment.map((d) => {
              const pct = d.total ? Math.round((d.present / d.total) * 100) : 0
              return <div key={d.name}><div className="mb-1 flex justify-between text-sm"><span className="font-medium text-slate-700">{d.name}</span><span className="text-xs text-slate-500">{pct}%</span></div><ProgressBar value={pct} tone={pct >= 80 ? 'success' : pct >= 50 ? 'warning' : 'danger'} /></div>
            })}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title={`Báo cáo chi tiết · ${from} → ${to}`} icon={<BarChart3 className="h-4 w-4" />} />
        {run === 0 ? <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="Chọn khoảng ngày và bấm Tạo báo cáo" /> : isLoading ? <div className="p-5"><Spinner /></div> : rows.length === 0 ? <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="Không có dữ liệu trong khoảng này" /> : (
          <>
            <div className="grid grid-cols-2 gap-4 border-b border-slate-100 p-4 sm:grid-cols-4">
              <Mini label="Tổng công hưởng" value={fmtHours(totalPaid)} />
              <Mini label="Tổng giờ OT" value={fmtHours(totalOt)} />
              <Mini label="Số lượt muộn" value={fmtNum(totalLate)} />
              {data?.payroll && <Mini label="Tổng thực lĩnh" value={fmtCurrency(totalNet)} />}
            </div>
            <Table headers={['Nhân viên', 'Công hưởng', 'Giờ OT', 'Ngày muộn', ...(showNet ? ['Thực lĩnh'] : [])]}>
              {rows.map((r) => (
                <Tr key={r.name}>
                  <Td className="font-medium text-slate-800">{r.name}</Td>
                  <Td>{fmtHours(r.paidUnits)}</Td><Td>{fmtHours(r.otHours)}</Td>
                  <Td>{r.late}</Td>
                  {showNet && <Td className="flex items-center gap-1.5 font-semibold text-slate-800"><Wallet className="h-3.5 w-3.5 text-slate-400" />{fmtCurrency(r.net ?? 0)}</Td>}
                </Tr>
              ))}
            </Table>
          </>
        )}
      </Card>
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-lg font-bold text-slate-800">{value}</p></div>
}
