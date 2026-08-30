import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeDollarSign, CheckCircle2, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { dashboardApi } from '@/api/dashboard'
import { payrollApi } from '@/api/timesheet'
import { fmtCurrency } from '@/lib/format'
import { shouldReloadFinancialState } from '@/lib/phase5Capabilities'
import { PageHeader, Card, CardHeader, Spinner, EmptyState, Button, StatCard, ConfirmDialog, StatusBadge } from '@/components/ui'
import { SUMMARY_TS_LABEL } from '@/constants/enums'

function periodLabel(period: string): string {
  const year = period.slice(0, 4); const month = period.slice(4, 6); const half = period.slice(6)
  return `Tháng ${month}/${year} · ${half === '1' ? 'nửa đầu (1–15)' : 'nửa cuối (16–cuối)'}`
}

export default function DirectorPayroll() {
  const queryClient = useQueryClient()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const { data, isLoading } = useQuery({ queryKey: ['dashboard', 'director-payroll'], queryFn: dashboardApi.directorPayrolls })
  const approve = useMutation({
    mutationFn: () => {
      if (!data) throw new Error('Không tìm thấy kỳ lương.')
      return payrollApi.approvePayroll(data.period, data.version)
    },
    onSuccess: () => {
      toast.success('Đã duyệt kỳ lương')
      setConfirmOpen(false)
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'director-payroll'] })
    },
    onError: (error: Error) => {
      if (shouldReloadFinancialState(error)) {
        toast.error('Kỳ lương đã thay đổi. Dữ liệu đang được tải lại.')
        queryClient.invalidateQueries({ queryKey: ['dashboard', 'director-payroll'] })
      } else toast.error(error.message)
    },
  })

  return (
    <div>
      <PageHeader title="Kỳ lương" subtitle="Phê duyệt theo số liệu tổng hợp; chi tiết từng nhân viên cần quyền riêng" />
      {isLoading ? <Card className="p-5"><Spinner /></Card> : !data ? (
        <Card><EmptyState icon={<BadgeDollarSign className="h-6 w-6" />} title="Chưa có kỳ lương chờ xử lý" /></Card>
      ) : (
        <div className="space-y-5">
          <Card>
            <CardHeader title={periodLabel(data.period)} subtitle={`Phiên bản ${data.version}`} icon={<FileText className="h-4 w-4" />}
              action={<StatusBadge map={SUMMARY_TS_LABEL} value={data.status} />} />
          </Card>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Tổng NET" value={fmtCurrency(data.totalNet)} icon={<BadgeDollarSign className="h-5 w-5" />} tone="brand" />
            <StatCard label="Tổng Gross" value={fmtCurrency(data.totalGross)} icon={<BadgeDollarSign className="h-5 w-5" />} tone="info" />
            <StatCard label="Số phiếu" value={data.headcount} icon={<FileText className="h-5 w-5" />} tone="success" />
          </div>
          {data.canApprove && <Button variant="success" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setConfirmOpen(true)}>Duyệt kỳ này</Button>}
        </div>
      )}
      <ConfirmDialog open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Duyệt kỳ lương"
        message={`Xác nhận duyệt kỳ ${data ? periodLabel(data.period) : ''}? Hành động sẽ được ghi audit log.`}
        confirmText={approve.isPending ? 'Đang duyệt...' : 'Duyệt'} onConfirm={() => approve.mutate()} />
    </div>
  )
}
