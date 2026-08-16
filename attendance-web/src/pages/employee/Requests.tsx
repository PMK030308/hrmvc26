import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus, FileText, Inbox } from 'lucide-react'
import { requestsApi } from '@/api/requests'
import { REQUEST_TYPE_LABEL, REQUEST_STATUS_LABEL } from '@/constants/enums'
import { fmtDate } from '@/lib/date'
import { PageHeader, Tabs, Card, StatusBadge, EmptyState, Button, Spinner } from '@/components/ui'
import { requestSummary } from '@/components/requests/widgets'
import type { RequestType } from '@/types'

const types: RequestType[] = ['leaves', 'late-earlies', 'overtimes', 'business-trips', 'shift-swaps', 'attendance-updates']

export default function RequestsPage() {
  const [tab, setTab] = useState<'all' | RequestType>('all')
  const { data, isLoading } = useQuery({ queryKey: ['requests', 'mine'], queryFn: () => requestsApi.mine() })

  const tabs = [
    { key: 'all', label: 'Tất cả', count: data?.mine.length ?? 0 },
    ...types.map((t) => ({ key: t, label: REQUEST_TYPE_LABEL[t].label, count: data?.mine.filter((r) => r.type === t).length ?? 0 })),
  ]
  const list = tab === 'all' ? data?.mine ?? [] : data?.mine.filter((r) => r.type === tab) ?? []

  return (
    <div>
      <PageHeader title="Đơn từ" subtitle="Tạo & theo dõi đơn của bạn"
        actions={<Link to="/employee/requests/leaves/new"><Button icon={<Plus className="h-4 w-4" />}>Tạo đơn</Button></Link>} />
      <div className="mb-5"><Tabs tabs={tabs} active={tab} onChange={(k) => setTab(k as 'all' | RequestType)} /></div>

      {isLoading ? <Card className="p-5"><Spinner /></Card> : list.length === 0 ? (
        <Card><EmptyState icon={<Inbox className="h-6 w-6" />} title="Chưa có đơn nào" description="Bấm “Tạo đơn” để gửi yêu cầu."
          action={<div className="flex flex-wrap justify-center gap-2 mt-1">
            {types.map((t) => <Link key={t} to={`/employee/requests/${t}/new`}><Button variant="secondary" size="sm" icon={<Plus className="h-3.5 w-3.5" />}>{REQUEST_TYPE_LABEL[t].label}</Button></Link>)}
          </div>} /></Card>
      ) : (
        <Card>
          <div className="divide-y divide-slate-100">
            {list.map((r) => (
              <Link key={r.id} to={`/employee/requests/${r.type}/${r.id}`} className="flex items-center gap-4 px-5 py-3.5 transition hover:bg-slate-50">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600"><FileText className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${REQUEST_TYPE_LABEL[r.type].tone === 'brand' ? 'bg-brand-50 text-brand-700' : REQUEST_TYPE_LABEL[r.type].tone === 'warning' ? 'bg-warning-50 text-warning-700' : REQUEST_TYPE_LABEL[r.type].tone === 'info' ? 'bg-info-50 text-info-600' : REQUEST_TYPE_LABEL[r.type].tone === 'success' ? 'bg-success-50 text-success-700' : REQUEST_TYPE_LABEL[r.type].tone === 'danger' ? 'bg-danger-50 text-danger-700' : 'bg-slate-100 text-slate-700'}`}>{REQUEST_TYPE_LABEL[r.type].label}</span>
                    <span className="text-xs text-slate-400">#{r.id.slice(-6)}</span>
                  </div>
                  <p className="mt-1 truncate text-sm text-slate-600">{requestSummary(r)} · {fmtDate(r.createdAt, 'dd/MM/yyyy HH:mm')}</p>
                </div>
                <StatusBadge map={REQUEST_STATUS_LABEL} value={r.status} />
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}