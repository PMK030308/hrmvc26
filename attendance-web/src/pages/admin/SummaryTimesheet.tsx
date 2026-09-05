import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileText, ListChecks, Plus, RefreshCw, CheckCircle2, BadgeDollarSign, Eye } from 'lucide-react'
import { toast } from 'sonner'
import { timesheetApi } from '@/api/timesheet'
import { fmtHours } from '@/lib/date'
import { SUMMARY_TS_LABEL, CONFIRM_LABEL } from '@/constants/enums'
import { PageHeader, Card, CardHeader, CardBody, Spinner, EmptyState, Button, StatusBadge, Modal, Table, Tr, Td, Badge } from '@/components/ui'
import { PeriodPicker } from '@/components/admin/widgets'
import type { SummaryTimesheet } from '@/types'
import { useAuthStore } from '@/stores/authStore'
import { phase5Capabilities, shouldReloadFinancialState } from '@/lib/phase5Capabilities'
import { allowsUiPermission } from '@/lib/permissionCompatibility'

export default function AdminSummaryTimesheet() {
  const qc = useQueryClient()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [half, setHalf] = useState<1 | 2>(now.getDate() <= 15 ? 1 : 2)
  const [view, setView] = useState<SummaryTimesheet | null>(null)
  const user = useAuthStore((state) => state.user)!
  const capabilities = phase5Capabilities(user.effectivePermissions ?? [])
  const canBuildSummary = allowsUiPermission(user.effectivePermissions, 'timesheet.summary.build', user.roles)

  const { data: list, isLoading } = useQuery({ queryKey: ['summary', 'list'], queryFn: () => timesheetApi.listSummary() })

  const build = useMutation({
    mutationFn: () => timesheetApi.buildSummary({ year, month, half }),
    onSuccess: () => { toast.success('Đã tạo bảng công tổng hợp'); qc.invalidateQueries({ queryKey: ['summary', 'list'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const confirm = useMutation({
    mutationFn: (summary: SummaryTimesheet) => timesheetApi.confirmByHr(summary.id, summary.version),
    onSuccess: () => { toast.success('Đã xác nhận bảng công'); qc.invalidateQueries({ queryKey: ['summary', 'list'] }) },
    onError: handleFinancialError,
  })
  const transfer = useMutation({
    mutationFn: (summary: SummaryTimesheet) => timesheetApi.transferToPayroll(summary.id, summary.version),
    onSuccess: () => { toast.success('Đã chuyển sang lương'); qc.invalidateQueries({ queryKey: ['summary', 'list'] }) },
    onError: handleFinancialError,
  })
  const rebuild = useMutation({
    mutationFn: (summary: SummaryTimesheet) => timesheetApi.rebuild(summary.id, summary.version),
    onSuccess: () => { toast.success('Đã tính lại bảng công'); qc.invalidateQueries({ queryKey: ['summary', 'list'] }) },
    onError: handleFinancialError,
  })
  const exportFile = useMutation({
    mutationFn: ({ id, format }: { id: string; format: 'excel' | 'pdf' }) => timesheetApi.exportSummary(id, format),
    onSuccess: (_data, variables) => toast.success(`Đã xuất ${variables.format === 'excel' ? 'Excel' : 'PDF'} bảng công`),
    onError: (error: Error) => toast.error(error.message),
  })

  function handleFinancialError(error: Error) {
    if (shouldReloadFinancialState(error)) {
      toast.error('Dữ liệu đã thay đổi. Danh sách đang được tải lại.')
      qc.invalidateQueries({ queryKey: ['summary', 'list'] })
      return
    }
    toast.error(error.message)
  }

  return (
    <div>
      <PageHeader title="Bảng công tổng hợp" subtitle="Tạo & xử lý bảng công theo kỳ (nửa tháng)" />

      {(capabilities.canBuildSummary || canBuildSummary) && <Card className="mb-5">
        <CardHeader title="Tạo bảng công mới" icon={<Plus className="h-4 w-4" />} />
        <CardBody>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <PeriodPicker year={year} month={month} half={half} onYear={setYear} onMonth={setMonth} onHalf={setHalf} showHalf />
            <Button icon={<Plus className="h-4 w-4" />} loading={build.isPending} onClick={() => build.mutate()}>Tạo bảng công</Button>
          </div>
          <p className="mt-3 text-xs text-slate-400">Nếu kỳ đã tồn tại, hệ thống trả về bảng cũ.</p>
        </CardBody>
      </Card>}

      <div className="grid gap-4">
        {isLoading ? <Card className="p-5"><Spinner /></Card> : (list ?? []).length === 0 ? <Card><EmptyState icon={<ListChecks className="h-6 w-6" />} title="Chưa có bảng công tổng hợp" description="Tạo bảng công mới cho kỳ hiện tại." /></Card> : list!.map((st) => (
          <Card key={st.id}>
            <CardHeader title={periodLabel(st.period)} subtitle={`${st.details.length} nhân viên · ${st.from} → ${st.to}`}
              icon={<ListChecks className="h-4 w-4" />}
              action={<StatusBadge map={SUMMARY_TS_LABEL} value={st.status} />} />
            <CardBody className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" icon={<Eye className="h-4 w-4" />} onClick={() => setView(st)}>Chi tiết</Button>
              <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} loading={exportFile.isPending} onClick={() => exportFile.mutate({ id: st.id, format: 'excel' })}>Excel</Button>
              <Button size="sm" variant="secondary" icon={<FileText className="h-4 w-4" />} loading={exportFile.isPending} onClick={() => exportFile.mutate({ id: st.id, format: 'pdf' })}>PDF</Button>
              {st.capabilities.canRebuild && <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} loading={rebuild.isPending} onClick={() => rebuild.mutate(st)}>Tính lại</Button>}
              {st.capabilities.canConfirmHr && <Button size="sm" variant="success" icon={<CheckCircle2 className="h-4 w-4" />} loading={confirm.isPending} onClick={() => confirm.mutate(st)}>HR xác nhận</Button>}
              {st.capabilities.canTransferPayroll && <Button size="sm" icon={<BadgeDollarSign className="h-4 w-4" />} loading={transfer.isPending} onClick={() => transfer.mutate(st)}>Chuyển sang lương</Button>}
              {st.status === 4 && <Badge tone="brand" dot>Đã sinh phiếu lương</Badge>}
            </CardBody>
          </Card>
        ))}
      </div>

      <Modal open={!!view} onClose={() => setView(null)} size="xl" title={view ? `Bảng công ${periodLabel(view.period)}` : ''}>
        {view && (
          <Table headers={['NV', 'Mã', 'Công hưởng', 'Giờ OT', 'Muộn/Về sớm', 'Giờ làm', 'Xác nhận']}>
            {view.details.map((d) => (
              <Tr key={d.id}>
                <Td>{d.employeeName}</Td><Td className="font-mono text-xs">{d.employeeCode}</Td>
                <Td className="font-semibold">{fmtHours(d.paidUnits)}</Td>
                <Td>{fmtHours(d.otHours)}</Td><Td>{d.lateEarlyCount}</Td>
                <Td>{fmtHours(d.workHours)}</Td>
                <Td><StatusBadge map={CONFIRM_LABEL} value={d.confirmationStatus} /></Td>
              </Tr>
            ))}
          </Table>
        )}
      </Modal>
    </div>
  )
}

function periodLabel(p: string): string {
  const y = p.slice(0, 4); const m = p.slice(4, 6); const h = p.slice(6)
  return `Tháng ${m}/${y} · ${h === '1' ? 'nửa đầu' : 'nửa cuối'}`
}
