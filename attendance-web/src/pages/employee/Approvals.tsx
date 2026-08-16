import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, XCircle, ArrowRight, Inbox } from 'lucide-react'
import { toast } from 'sonner'
import { approvalsApi } from '@/api/requests'
import { REQUEST_TYPE_LABEL, REQUEST_STATUS_LABEL } from '@/constants/enums'
import { fmtDate } from '@/lib/date'
import { PageHeader, Card, StatusBadge, Button, Spinner, EmptyState, Avatar, Modal, Textarea } from '@/components/ui'
import { requestSummary } from '@/components/requests/widgets'
import type { AnyRequest } from '@/types'

export default function ApprovalsPage() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['approvals', 'list'], queryFn: () => approvalsApi.list() })
  const [modal, setModal] = useState<null | { req: AnyRequest; kind: 'approve' | 'reject' }>(null)
  const [comment, setComment] = useState('')

  const approve = useMutation({
    mutationFn: (req: AnyRequest) => approvalsApi.approve(req.type, req.id, comment, req.requestVersion),
    onSuccess: () => { toast.success('Đã duyệt'); setModal(null); setComment(''); qc.invalidateQueries({ queryKey: ['approvals', 'list'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const reject = useMutation({
    mutationFn: (req: AnyRequest) => approvalsApi.reject(req.type, req.id, comment, req.requestVersion),
    onSuccess: () => { toast.success('Đã từ chối'); setModal(null); setComment(''); qc.invalidateQueries({ queryKey: ['approvals', 'list'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div>
      <PageHeader title="Duyệt đơn" subtitle={data ? `${data.length} đơn đang chờ bạn` : 'Hàng đợi phê duyệt'} />
      {isLoading ? <Card className="p-5"><Spinner /></Card> : data && data.length === 0 ? (
        <Card><EmptyState icon={<Inbox className="h-6 w-6" />} title="Không có đơn chờ duyệt" description="Khi có đơn mới cần bạn phê duyệt, sẽ hiện tại đây." /></Card>
      ) : (
        <div className="grid gap-4">
          {data!.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <Avatar name={r.employeeName} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${REQUEST_TYPE_LABEL[r.type].tone === 'brand' ? 'bg-brand-50 text-brand-700' : REQUEST_TYPE_LABEL[r.type].tone === 'warning' ? 'bg-warning-50 text-warning-700' : REQUEST_TYPE_LABEL[r.type].tone === 'info' ? 'bg-info-50 text-info-600' : REQUEST_TYPE_LABEL[r.type].tone === 'success' ? 'bg-success-50 text-success-700' : REQUEST_TYPE_LABEL[r.type].tone === 'danger' ? 'bg-danger-50 text-danger-700' : 'bg-slate-100 text-slate-700'}`}>{REQUEST_TYPE_LABEL[r.type].label}</span>
                    <StatusBadge map={REQUEST_STATUS_LABEL} value={r.status} />
                    <span className="text-xs text-slate-400">cấp {r.currentLevel}</span>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-slate-800">{r.employeeName} <span className="font-normal text-slate-400">· {r.employeeCode}</span></p>
                  <p className="text-xs text-slate-500">{requestSummary(r)} · gửi {fmtDate(r.createdAt, 'dd/MM/yyyy HH:mm')}</p>
                </div>
                <div className="flex gap-2">
                  <Link to={`/employee/requests/${r.type}/${r.id}`} className="grid h-10 w-10 place-items-center rounded-lg text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50" title="Chi tiết"><ArrowRight className="h-4 w-4" /></Link>
                  <Button size="sm" variant="success" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => { setModal({ req: r, kind: 'approve' }); setComment('') }}>Duyệt</Button>
                  <Button size="sm" variant="secondary" icon={<XCircle className="h-4 w-4" />} onClick={() => { setModal({ req: r, kind: 'reject' }); setComment('') }}>Từ chối</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!modal} onClose={() => setModal(null)}
        title={modal?.kind === 'approve' ? 'Duyệt đơn' : 'Từ chối đơn'}
        footer={<>
          <Button variant="secondary" onClick={() => setModal(null)}>Hủy</Button>
          {modal?.kind === 'approve'
            ? <Button variant="success" loading={approve.isPending} onClick={() => modal && approve.mutate(modal.req)}>Xác nhận duyệt</Button>
            : <Button variant="danger" loading={reject.isPending} onClick={() => modal && reject.mutate(modal.req)}>Xác nhận từ chối</Button>}
        </>}>
        <p className="mb-3 text-sm text-slate-600">{modal?.req.employeeName} — {REQUEST_TYPE_LABEL[modal?.req.type ?? 'leaves'].label}</p>
        <Textarea label={modal?.kind === 'approve' ? 'Ghi chú (tùy chọn)' : 'Lý do từ chối'} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Modal>
    </div>
  )
}