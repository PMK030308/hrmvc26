import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ScrollText, ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { toast } from 'sonner'
import { auditApi } from '@/api/audit'
import { AUDIT_ACTION_LABEL } from '@/constants/enums'
import { fmtDate } from '@/lib/date'
import { PageHeader, Card, CardHeader, Spinner, EmptyState, StatusBadge, Table, Tr, Td, Button, Badge } from '@/components/ui'

const PAGE_SIZE = 25

export default function AdminAudit() {
  const [page, setPage] = useState(1)
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['audit', 'list', page, PAGE_SIZE],
    queryFn: () => auditApi.list({ page, pageSize: PAGE_SIZE }),
  })
  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const exportExcel = useMutation({
    mutationFn: () => auditApi.exportExcel(), onSuccess: () => toast.success('Đã xuất audit log Excel'), onError: (error: Error) => toast.error(error.message),
  })

  return (
    <div>
      <PageHeader title="Audit log" subtitle="Nhật ký thao tác hệ thống theo quyền được cấp" actions={
        <Button variant="secondary" icon={<Download className="h-4 w-4" />} loading={exportExcel.isPending} disabled={total === 0} onClick={() => exportExcel.mutate()}>Xuất Excel</Button>
      } />
      <Card>
        <CardHeader title={`${total} bản ghi · trang ${page}/${pages}`} icon={<ScrollText className="h-4 w-4" />} action={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" icon={<ChevronLeft className="h-4 w-4" />} disabled={page <= 1 || isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}>Trước</Button>
            <Button size="sm" variant="secondary" disabled={page >= pages || isFetching} onClick={() => setPage((p) => Math.min(pages, p + 1))}>Sau <ChevronRight className="h-4 w-4" /></Button>
          </div>
        } />
        {isLoading ? <div className="p-5"><Spinner /></div> : items.length === 0 ? <EmptyState icon={<ScrollText className="h-6 w-6" />} title="Chưa có bản ghi audit" /> : (
          <Table headers={['Thời gian', 'Người dùng', 'Hành động', 'Đối tượng', 'Chi tiết', 'IP']}>
            {items.map((a) => (
              <Tr key={a.id}>
                <Td className="whitespace-nowrap text-xs text-slate-500">{fmtDate(a.createdAt, 'dd/MM/yyyy HH:mm:ss')}</Td>
                <Td className="font-medium text-slate-800">{a.userName}</Td>
                <Td><StatusBadge map={AUDIT_ACTION_LABEL} value={a.action} /></Td>
                <Td><Badge tone="muted">{a.entity}</Badge></Td>
                <Td className="max-w-md whitespace-normal text-slate-600">{a.detail}</Td>
                <Td className="font-mono text-xs text-slate-400">{a.ipAddress ?? '—'}</Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  )
}
