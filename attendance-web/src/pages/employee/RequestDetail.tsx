import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, XCircle, Ban, MessageSquare, UserCheck } from 'lucide-react'
import { toast } from 'sonner'
import { requestsApi, approvalsApi } from '@/api/requests'

import {
  REQUEST_TYPE_LABEL, REQUEST_STATUS_LABEL, LATE_EARLY_LABEL,
  ATT_UPDATE_TYPE_LABEL, OT_COMP_LABEL, SHIFT_SWAP_MODE_LABEL, SWAP_PARTNER_LABEL,
} from '@/constants/enums'
import { fmtDate } from '@/lib/date'
import { PageHeader, Card, CardHeader, CardBody, StatusBadge, Spinner, Button, Modal, Textarea, EmptyState, Avatar } from '@/components/ui'
import { MetaRow, RequestTimeline, Attachments, requestSummary } from '@/components/requests/widgets'
import type { AnyRequest, RequestType } from '@/types'

export default function RequestDetailPage() {
  const { type, id = '' } = useParams<{ type: RequestType; id: string }>()
  const navigate = useNavigate()

  const qc = useQueryClient()

  const { data: req, isLoading } = useQuery({
    queryKey: ['request', type, id],
    queryFn: () => requestsApi.detail(type as RequestType, id),
    enabled: !!type && !!id,
  })
  const { data: myPending } = useQuery({ queryKey: ['approvals', 'list'], queryFn: () => approvalsApi.list() })
  const canApprove = !!req && !!myPending?.some((r) => r.id === req.id)

  const [actionModal, setActionModal] = useState<null | { kind: 'approve' | 'reject' | 'cancel' | 'partner' }>(null)
  const [comment, setComment] = useState('')
  const [partnerAccept, setPartnerAccept] = useState(true)

  const approve = useMutation({
    mutationFn: () => approvalsApi.approve(type as RequestType, id, comment, req!.requestVersion),
    onSuccess: () => { toast.success('Đã duyệt đơn'); setActionModal(null); setComment(''); qc.invalidateQueries({ queryKey: ['request', type, id] }); qc.invalidateQueries({ queryKey: ['approvals', 'list'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const reject = useMutation({
    mutationFn: () => approvalsApi.reject(type as RequestType, id, comment, req!.requestVersion),
    onSuccess: () => { toast.success('Đã từ chối đơn'); setActionModal(null); setComment(''); qc.invalidateQueries({ queryKey: ['request', type, id] }); qc.invalidateQueries({ queryKey: ['approvals', 'list'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const cancel = useMutation({
    mutationFn: () => requestsApi.cancel(type as RequestType, id, req!.requestVersion),
    onSuccess: () => { toast.success('Đã hủy đơn'); setActionModal(null); qc.invalidateQueries({ queryKey: ['request', type, id] }); qc.invalidateQueries({ queryKey: ['requests', 'mine'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const partner = useMutation({
    mutationFn: () => requestsApi.partnerResponse(id, partnerAccept, partnerAccept ? null : comment, req!.requestVersion),
    onSuccess: () => { toast.success(partnerAccept ? 'Đã đồng ý đổi ca' : 'Đã từ chối đổi ca'); setActionModal(null); setComment(''); qc.invalidateQueries({ queryKey: ['request', type, id] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  if (isLoading || !req) return <Card className="p-5"><Spinner /></Card>
  const cap = req.capabilities

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`Đơn · ${REQUEST_TYPE_LABEL[req.type].label}`} subtitle={requestSummary(req)} back={() => navigate(-1)}
        actions={<StatusBadge map={REQUEST_STATUS_LABEL} value={req.status} />} />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* Thông tin người gửi */}
          <Card>
            <CardHeader title="Thông tin đơn" icon={<UserCheck className="h-4 w-4" />} />
            <CardBody>
              <div className="mb-4 flex items-center gap-3">
                <Avatar name={req.employeeName} size="md" />
                <div>
                  <p className="text-sm font-semibold text-slate-800">{req.employeeName}</p>
                  <p className="text-xs text-slate-500">{req.employeeCode} · gửi {fmtDate(req.createdAt, 'dd/MM/yyyy HH:mm')}</p>
                </div>
              </div>
              <DetailByType req={req} />
            </CardBody>
          </Card>

          <RequestTimeline type={req.type} id={req.id} approvals={req.approvals} />
          <Attachments type={req.type} id={req.id} attachments={req.attachments} canAdd={cap.canEdit || canApprove} />
        </div>

        {/* Sidebar actions */}
        <div className="space-y-5">
          <Card>
            <CardHeader title="Thao tác" icon={<MessageSquare className="h-4 w-4" />} />
            <CardBody className="space-y-2">
              {canApprove && (req.status === 2 || req.status === 8) && (
                <>
                  <Button className="w-full" variant="success" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setActionModal({ kind: 'approve' })}>Duyệt đơn</Button>
                  <Button className="w-full" variant="danger" icon={<XCircle className="h-4 w-4" />} onClick={() => setActionModal({ kind: 'reject' })}>Từ chối</Button>
                </>
              )}
              {cap.canRespond && (
                <>
                  <Button className="w-full" variant="success" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => { setPartnerAccept(true); setActionModal({ kind: 'partner' }) }}>Đồng ý đổi ca</Button>
                  <Button className="w-full" variant="secondary" icon={<XCircle className="h-4 w-4" />} onClick={() => { setPartnerAccept(false); setActionModal({ kind: 'partner' }) }}>Từ chối đổi ca</Button>
                </>
              )}
              {cap.canCancel && <Button className="w-full" variant="secondary" icon={<Ban className="h-4 w-4" />} onClick={() => setActionModal({ kind: 'cancel' })}>Hủy đơn</Button>}
              {!canApprove && !cap.canRespond && !cap.canCancel && <EmptyState icon={<MessageSquare className="h-6 w-6" />} title="Không có thao tác" description="Đơn ở trạng thái không cần xử lý." />}
            </CardBody>
          </Card>

          {req.type === 'shift-swaps' && <SwapInfo req={req} />}
        </div>
      </div>

      {/* Action modal */}
      <Modal open={!!actionModal} onClose={() => setActionModal(null)}
        title={actionModal?.kind === 'approve' ? 'Duyệt đơn' : actionModal?.kind === 'reject' ? 'Từ chối đơn' : actionModal?.kind === 'cancel' ? 'Hủy đơn' : (partnerAccept ? 'Đồng ý đổi ca' : 'Từ chối đổi ca')}
        footer={<>
          <Button variant="secondary" onClick={() => setActionModal(null)}>Đóng</Button>
          {actionModal?.kind === 'approve' && <Button variant="success" loading={approve.isPending} onClick={() => approve.mutate()}>Xác nhận duyệt</Button>}
          {actionModal?.kind === 'reject' && <Button variant="danger" loading={reject.isPending} onClick={() => reject.mutate()}>Xác nhận từ chối</Button>}
          {actionModal?.kind === 'cancel' && <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>Xác nhận hủy</Button>}
          {actionModal?.kind === 'partner' && <Button loading={partner.isPending} onClick={() => partner.mutate()} variant={partnerAccept ? 'success' : 'danger'}>Gửi phản hồi</Button>}
        </>}>
        {(actionModal?.kind === 'approve' || actionModal?.kind === 'reject' || (actionModal?.kind === 'partner' && !partnerAccept)) ? (
          <Textarea label={actionModal.kind === 'approve' ? 'Ghi chú duyệt (tùy chọn)' : 'Lý do'} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Nhập ý kiến..." />
        ) : actionModal?.kind === 'cancel' ? (
          <p className="text-sm text-slate-600">Bạn chắc chắn muốn hủy đơn này? Hành động không thể hoàn tác.</p>
        ) : (
          <p className="text-sm text-slate-600">Xác nhận đồng ý nhận đổi ca với {req.employeeName}?</p>
        )}
      </Modal>
    </div>
  )
}

function DetailByType({ req }: { req: AnyRequest }) {
  switch (req.type) {
    case 'leaves': return <>
      <MetaRow label="Loại nghỉ" value={req.leaveTypeName} />
      <MetaRow label="Khoảng ngày" value={`${fmtDate(req.startDate, 'dd/MM/yyyy')} → ${fmtDate(req.endDate, 'dd/MM/yyyy')}`} />
      <MetaRow label="Số ngày" value={`${req.totalDays} ngày`} />
      <MetaRow label="Lý do" value={req.reason || '—'} />
    </>
    case 'late-earlies': return <>
      <MetaRow label="Ngày" value={fmtDate(req.requestDate, 'dd/MM/yyyy')} />
      <MetaRow label="Loại" value={LATE_EARLY_LABEL[req.lateEarlyType].label} />
      <MetaRow label="Giờ mong muốn" value={req.requestedTime} />
      <MetaRow label="Số phút" value={`${req.minutes} phút`} />
      <MetaRow label="Lý do" value={req.reason || '—'} />
    </>
    case 'overtimes': return <>
      <MetaRow label="Ngày OT" value={fmtDate(req.otDate, 'dd/MM/yyyy')} />
      <MetaRow label="Giờ" value={`${req.startTime} – ${req.endTime}`} />
      <MetaRow label="Tổng giờ" value={`${req.totalHours}h`} />
      <MetaRow label="Bồi thường" value={OT_COMP_LABEL[req.compensationType].label} />
      <MetaRow label="Lý do" value={req.reason || '—'} />
    </>
    case 'business-trips': return <>
      <MetaRow label="Khoảng ngày" value={`${fmtDate(req.startDate, 'dd/MM/yyyy')} → ${fmtDate(req.endDate, 'dd/MM/yyyy')}`} />
      <MetaRow label="Số ngày" value={`${req.totalDays} ngày`} />
      <MetaRow label="Địa điểm" value={req.location} />
      <MetaRow label="Mục đích" value={req.purpose || '—'} />
    </>
    case 'shift-swaps': return <>
      <MetaRow label="Ngày đổi ca" value={fmtDate(req.requestedDate, 'dd/MM/yyyy')} />
      <MetaRow label="Hình thức" value={SHIFT_SWAP_MODE_LABEL[req.shiftSwapMode].label} />
      <MetaRow label="Đồng nghiệp" value={req.suggestedSwapPartnerName ?? '—'} />
      <MetaRow label="Lý do" value={req.reason || '—'} />
    </>
    case 'attendance-updates': return <>
      <MetaRow label="Ngày" value={fmtDate(req.requestDate, 'dd/MM/yyyy')} />
      <MetaRow label="Loại cập nhật" value={ATT_UPDATE_TYPE_LABEL[req.updateType].label} />
      <MetaRow label="Giờ vào mới" value={req.newCheckInTime ?? '—'} />
      <MetaRow label="Giờ ra mới" value={req.newCheckOutTime ?? '—'} />
      {req.newWorkHours != null && <MetaRow label="Giờ làm mới" value={`${req.newWorkHours}h`} />}
      <MetaRow label="Lý do" value={req.reason || '—'} />
    </>
  }
}

function SwapInfo({ req }: { req: Extract<AnyRequest, { type: 'shift-swaps' }> }) {
  return (
    <Card>
      <CardHeader title="Trạng thái đồng nghiệp" icon={<UserCheck className="h-4 w-4" />} />
      <CardBody>
        <p className="mb-2 text-sm text-slate-600">{req.suggestedSwapPartnerName ?? '—'}</p>
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
          <span className="text-xs text-slate-500">Xác nhận của đối tác</span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${SWAP_PARTNER_LABEL[req.swapPartnerStatus].tone === 'success' ? 'bg-success-50 text-success-700' : SWAP_PARTNER_LABEL[req.swapPartnerStatus].tone === 'warning' ? 'bg-warning-50 text-warning-700' : SWAP_PARTNER_LABEL[req.swapPartnerStatus].tone === 'danger' ? 'bg-danger-50 text-danger-700' : 'bg-slate-100 text-slate-500'}`}>
            {SWAP_PARTNER_LABEL[req.swapPartnerStatus].label}
          </span>
        </div>
      </CardBody>
    </Card>
  )
}