// Widget đơn từ: RequestTimeline, Attachments, RequestMetaRow.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, XCircle, Clock, MinusCircle, Paperclip, Upload, Trash2, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { requestsApi } from '@/api/requests'
import { APPROVAL_STEP_STATUS_LABEL } from '@/constants/enums'
import { fmtDate, fmtTime } from '@/lib/date'
import { fmtBytes } from '@/lib/format'
import { Card, CardHeader, CardBody, Spinner, EmptyState } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { AnyRequest, RequestType, RequestApproval, RequestAttachment } from '@/types'

/** Dòng meta cho RequestDetail. */
export function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-slate-50 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-800 text-right">{value ?? '—'}</span>
    </div>
  )
}

const stepIcon: Record<number, React.ReactNode> = {
  3: <CheckCircle2 className="h-5 w-5 text-success-600" />,
  4: <XCircle className="h-5 w-5 text-danger-600" />,
  2: <Clock className="h-5 w-5 text-warning-500" />,
  5: <MinusCircle className="h-5 w-5 text-slate-400" />,
  1: <Clock className="h-5 w-5 text-slate-300" />,
}

/** Timeline duyệt nhiều cấp. */
export function RequestTimeline({ type, id, approvals }: { type: RequestType; id: string; approvals: RequestApproval[] }) {
  const timeline = useQuery({
    queryKey: ['request', type, id, 'timeline'],
    queryFn: () => requestsApi.timeline(type, id),
    initialData: approvals,
  })
  const sorted = [...(timeline.data ?? [])].sort((a, b) => a.level - b.level)
  return (
    <Card>
      <CardHeader title="Quy trình duyệt" subtitle="Tiến trình từng cấp" icon={<Clock className="h-4 w-4" />} />
      <CardBody>
        {sorted.length === 0 ? <EmptyState icon={<Clock className="h-6 w-6" />} title="Chưa có bước duyệt" /> : (
          <ol className="relative space-y-5">
            {sorted.map((a, i) => (
              <li key={a.id} className="relative flex gap-3 pl-1">
                {i < sorted.length - 1 && <span className="absolute left-[10px] top-7 h-[calc(100%+4px)] w-px bg-slate-200" />}
                <div className="z-10 grid h-5 w-5 shrink-0 place-items-center">{stepIcon[a.status] ?? <Clock className="h-5 w-5 text-slate-300" />}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-800">Cấp {a.level} · {a.approverName}</p>
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium',
                      APPROVAL_STEP_STATUS_LABEL[a.status].tone === 'success' ? 'bg-success-50 text-success-700' :
                      APPROVAL_STEP_STATUS_LABEL[a.status].tone === 'danger' ? 'bg-danger-50 text-danger-700' :
                      APPROVAL_STEP_STATUS_LABEL[a.status].tone === 'warning' ? 'bg-warning-50 text-warning-700' : 'bg-slate-100 text-slate-500')}>
                      {APPROVAL_STEP_STATUS_LABEL[a.status].label}
                    </span>
                  </div>
                  {a.comment && <p className="mt-1 text-xs text-slate-500">"{a.comment}"</p>}
                  {a.approvedAt && <p className="mt-0.5 text-[11px] text-slate-400">{fmtDate(a.approvedAt)} {fmtTime(a.approvedAt)}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  )
}

/** Đính kèm — upload (base64) + xóa. */
export function Attachments({ type, id, attachments, canUpload, canDelete }: {
  type: RequestType
  id: string
  attachments: RequestAttachment[]
  canUpload: boolean
  canDelete: boolean
}) {
  const qc = useQueryClient()
  const list = useQuery({
    queryKey: ['request', type, id, 'attachments'],
    queryFn: () => requestsApi.attachments(type, id),
    initialData: attachments,
  })
  const upload = useMutation({
    mutationFn: (file: File) => new Promise<{ fileName: string; fileSize: number; mimeType: string; dataUrl: string }>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve({ fileName: file.name, fileSize: file.size, mimeType: file.type, dataUrl: String(reader.result) })
      reader.onerror = reject
      reader.readAsDataURL(file)
    }).then((f) => requestsApi.uploadAttachment(type, id, f)),
    onSuccess: () => { toast.success('Đã tải lên đính kèm'); qc.invalidateQueries({ queryKey: ['request', type, id] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const del = useMutation({
    mutationFn: (aid: string) => requestsApi.deleteAttachment(aid),
    onSuccess: () => { toast.success('Đã xóa đính kèm'); qc.invalidateQueries({ queryKey: ['request', type, id] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Card>
      <CardHeader title="Tệp đính kèm" icon={<Paperclip className="h-4 w-4" />} action={
        canUpload && (
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200">
            <Upload className="h-3.5 w-3.5" /> Tải lên
            <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = '' }} />
          </label>
        )
      } />
      {list.data.length === 0 ? (
        <CardBody><EmptyState icon={<FileText className="h-6 w-6" />} title="Chưa có tệp đính kèm" description={canUpload ? 'Tải lên minh chứng (ảnh, PDF).' : undefined} /></CardBody>
      ) : (
        <ul className="divide-y divide-slate-100">
          {list.data.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-5 py-3">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-slate-500"><FileText className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{a.fileName}</p>
                <p className="text-xs text-slate-400">{fmtBytes(a.fileSize)} · {fmtDate(a.uploadedAt)}</p>
              </div>
              {a.mimeType.startsWith('image/') && <img src={a.dataUrl} alt={a.fileName} className="h-10 w-10 rounded-lg object-cover ring-1 ring-slate-200" />}
              {canDelete && (
                <button onClick={() => del.mutate(a.id)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-danger-50 hover:text-danger-600">
                  {del.isPending ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** Tóm tắt 1 đơn (dùng trong list). */
export function RequestSummaryLine({ req }: { req: AnyRequest }) {
  const summary = requestSummary(req)
  return <span className="text-xs text-slate-500">{summary}</span>
}

export function requestSummary(req: AnyRequest): string {
  switch (req.type) {
    case 'leaves': return `${fmtDate(req.startDate, 'dd/MM')} – ${fmtDate(req.endDate, 'dd/MM/yyyy')} · ${req.totalDays} ngày`
    case 'late-earlies': return `${fmtDate(req.requestDate, 'dd/MM/yyyy')} · ${req.minutes} phút`
    case 'overtimes': return `${fmtDate(req.otDate, 'dd/MM/yyyy')} · ${req.totalHours}h OT`
    case 'business-trips': return `${req.location} · ${req.totalDays} ngày`
    case 'shift-swaps': return `${fmtDate(req.requestedDate, 'dd/MM/yyyy')}`
    case 'attendance-updates': return `${fmtDate(req.requestDate, 'dd/MM/yyyy')}`
    default: return ''
  }
}
