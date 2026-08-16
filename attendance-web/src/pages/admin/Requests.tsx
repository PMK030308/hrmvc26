import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { FileText, ArrowRight } from 'lucide-react'
import { requestsApi } from '@/api/requests'
import { REQUEST_TYPE_LABEL, REQUEST_STATUS_LABEL } from '@/constants/enums'
import { fmtDate } from '@/lib/date'
import { PageHeader, Card, CardHeader, Spinner, EmptyState, Tabs, Table, Tr, Td, StatusBadge, Avatar } from '@/components/ui'
import { requestSummary } from '@/components/requests/widgets'
import type { RequestType } from '@/types'

const TYPES: RequestType[] = ['leaves', 'late-earlies', 'overtimes', 'business-trips', 'shift-swaps', 'attendance-updates']

export default function AdminRequests() {
  const [type, setType] = useState<RequestType>('leaves')
  const { data, isLoading } = useQuery({ queryKey: ['requests', 'list', type], queryFn: () => requestsApi.list(type) })

  return (
    <div>
      <PageHeader title="Quản lý đơn từ" subtitle="Tất cả đơn theo loại (toàn công ty)" />
      <Tabs active={type} onChange={(t) => setType(t as RequestType)} tabs={TYPES.map((t) => ({ key: t, label: REQUEST_TYPE_LABEL[t].label, count: undefined }))} />

      <Card className="mt-5">
        <CardHeader title={`${REQUEST_TYPE_LABEL[type].label} · ${data?.length ?? 0} đơn`} icon={<FileText className="h-4 w-4" />} />
        {isLoading ? <div className="p-5"><Spinner /></div> : (data ?? []).length === 0 ? <EmptyState icon={<FileText className="h-6 w-6" />} title="Không có đơn" /> : (
          <Table headers={['Nhân viên', 'Tóm tắt', 'Trạng thái', 'Cấp duyệt', 'Ngày gửi', '']}>
            {data!.map((r) => (
              <Tr key={r.id}>
                <Td><div className="flex items-center gap-2"><Avatar name={r.employeeName} size="sm" /><div><p className="font-medium text-slate-800">{r.employeeName}</p><p className="text-xs text-slate-400">{r.employeeCode}</p></div></div></Td>
                <Td className="max-w-xs"><span className="text-xs text-slate-600">{requestSummary(r)}</span></Td>
                <Td><StatusBadge map={REQUEST_STATUS_LABEL} value={r.status} /></Td>
                <Td>{r.currentLevel}</Td>
                <Td className="text-xs text-slate-500">{fmtDate(r.createdAt, 'dd/MM/yyyy HH:mm')}</Td>
                <Td className="text-right">
                  <Link to={`/employee/requests/${r.type}/${r.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-brand-600 hover:underline">Chi tiết <ArrowRight className="h-3.5 w-3.5" /></Link>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  )
}