// ============================================================================
// Trang Ủy quyền duyệt (Delegation) — quản lý cài người ủy quyền + khoảng vắng
// mặt. Trong khoảng đó đơn tự chuyển sang người được ủy quyền + ghi vết "thay mặt".
// Dành cho approver: Manager / HR / Director / Accountant / Admin.
// ============================================================================
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserCheck, Plus, Trash2, ArrowRight, ShieldCheck, CalendarRange } from 'lucide-react'
import { toast } from 'sonner'
import { delegationApi } from '@/api/delegation'
import { useAuthStore } from '@/stores/authStore'
import { fmtDate } from '@/lib/date'
import { PageHeader, Card, CardHeader, CardBody, Spinner, EmptyState, Button, Select, Input, Textarea, Badge, ConfirmDialog } from '@/components/ui'
import type { DelegationRich } from '@/types'

const APPROVER_ROLES = ['Manager', 'HR', 'Director', 'Accountant', 'Admin']

export default function DelegationPage() {
  const user = useAuthStore((s) => s.user)!
  const canDelegate = user.roles.some((r) => APPROVER_ROLES.includes(r))
  const isHrAdmin = user.roles.includes('HR') || user.roles.includes('Admin')
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({ queryKey: ['delegation', 'mine'], queryFn: () => delegationApi.mine() })
  const { data: approvers } = useQuery({ queryKey: ['delegation', 'approvers'], queryFn: () => delegationApi.approvers(), enabled: canDelegate })
  const { data: all } = useQuery({ queryKey: ['delegation', 'all'], queryFn: () => delegationApi.all(), enabled: isHrAdmin })

  const [delegateUserId, setDelegateUserId] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [reason, setReason] = useState('')
  const [confirmDel, setConfirmDel] = useState<DelegationRich | null>(null)

  const createMut = useMutation({
    mutationFn: () => delegationApi.create({ delegateUserId, fromDate, toDate, reason: reason || undefined }),
    onSuccess: () => { toast.success('Đã thiết lập ủy quyền'); setDelegateUserId(''); setFromDate(''); setToDate(''); setReason(''); qc.invalidateQueries({ queryKey: ['delegation'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const removeMut = useMutation({
    mutationFn: (id: string) => delegationApi.remove(id),
    onSuccess: () => { toast.success('Đã hủy ủy quyền'); setConfirmDel(null); qc.invalidateQueries({ queryKey: ['delegation'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!canDelegate) {
    return <Card><EmptyState icon={<ShieldCheck className="h-6 w-6" />} title="Không có quyền" description="Chỉ quản lý / HR / Giám đốc / Kế toán mới được ủy quyền duyệt đơn." /></Card>
  }

  const today = fmtDate(new Date().toISOString(), 'yyyy-MM-dd')
  const active = (d: DelegationRich) => d.isActive && d.fromDate <= today && d.toDate >= today

  return (
    <div>
      <PageHeader title="Ủy quyền duyệt" subtitle="Cài người ủy quyền + khoảng vắng mặt — đơn tự chuyển & ghi vết 'thay mặt'" />

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Form tạo ủy quyền */}
        <Card className="lg:col-span-1">
          <CardHeader title="Thiết lập ủy quyền" icon={<Plus className="h-4 w-4" />} />
          <CardBody className="space-y-3">
            <Select label="Người được ủy quyền" value={delegateUserId} onChange={(e) => setDelegateUserId(e.target.value)}>
              <option value="">— Chọn người —</option>
              {(approvers ?? []).map((a) => <option key={a.userId} value={a.userId}>{a.name} ({a.email})</option>)}
            </Select>
            <Input label="Từ ngày" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            <Input label="Đến ngày" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            <Textarea label="Lý do (tuỳ chọn)" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button icon={<UserCheck className="h-4 w-4" />} loading={createMut.isPending}
              disabled={!delegateUserId || !fromDate || !toDate} onClick={() => createMut.mutate()}>
              Thiết lập
            </Button>
            <p className="text-xs text-slate-400">Trong khoảng này, mọi đơn đáng lẽ gửi cho bạn sẽ tự chuyển sang người được ủy quyền. Vết duyệt ghi rõ <i>"Được duyệt bởi [ủy quyền] thay mặt cho [quản lý]"</i>.</p>
          </CardBody>
        </Card>

        {/* Danh sách ủy quyền của tôi + chuyển tới tôi */}
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Ủy quyền do tôi tạo" subtitle="Tôi ủy quyền cho người khác khi vắng" icon={<UserCheck className="h-4 w-4" />} />
            <DlgList items={data?.asDelegator ?? []} loading={isLoading} active={active} onDelete={setConfirmDel} mode="delegator" />
          </Card>

          <Card>
            <CardHeader title="Đơn chuyển tới tôi (được ủy quyền)" subtitle="Tôi thay mặt người khác duyệt" icon={<ArrowRight className="h-4 w-4" />} />
            <DlgList items={data?.asDelegate ?? []} loading={isLoading} active={active} mode="delegate" />
          </Card>

          {isHrAdmin && (
            <Card>
              <CardHeader title="Tất cả ủy quyền (giám sát HR)" icon={<ShieldCheck className="h-4 w-4" />} action={<Badge tone="muted">{all?.length ?? 0}</Badge>} />
              <DlgList items={all ?? []} loading={false} active={(d) => !!d.isActiveNow} mode="all" onDelete={(d) => setConfirmDel(d)} />
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog open={!!confirmDel} onClose={() => setConfirmDel(null)} danger
        title="Hủy ủy quyền này?" message={confirmDel ? `Hủy ủy quyền ${confirmDel.delegateName} (${confirmDel.fromDate} → ${confirmDel.toDate}). Đơn sẽ quay về người duyệt gốc.` : ''}
        confirmText="Hủy ủy quyền" onConfirm={() => confirmDel && removeMut.mutate(confirmDel.id)} />
    </div>
  )
}

function DlgList({ items, loading, active, mode, onDelete }: {
  items: DelegationRich[]
  loading: boolean
  active: (d: DelegationRich) => boolean
  mode: 'delegator' | 'delegate' | 'all'
  onDelete?: (d: DelegationRich) => void
}) {
  if (loading) return <CardBody><Spinner /></CardBody>
  if (items.length === 0) return <CardBody><EmptyState icon={<CalendarRange className="h-6 w-6" />} title="Chưa có ủy quyền" /></CardBody>
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((d) => {
        const on = active(d)
        return (
          <li key={d.id} className="flex items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800">
                {mode === 'delegate' ? <>{d.delegatorName} <ArrowRight className="mx-1 inline h-3.5 w-3.5 text-slate-400" /> <span className="text-slate-500">tôi</span></>
                  : mode === 'all' ? <>{d.delegatorName} <ArrowRight className="mx-1 inline h-3.5 w-3.5 text-slate-400" /> {d.delegateName}</>
                  : <><span className="text-slate-500">tôi</span> <ArrowRight className="mx-1 inline h-3.5 w-3.5 text-slate-400" /> {d.delegateName}</>}
              </p>
              <p className="text-xs text-slate-400">{d.fromDate} → {d.toDate}{d.reason ? ` · ${d.reason}` : ''}</p>
            </div>
            <Badge tone={on ? 'success' : 'muted'} dot>{on ? 'Đang hiệu lực' : d.isActive ? 'Chưa đến/kết thúc' : 'Đã hủy'}</Badge>
            {onDelete && d.isActive && <Button size="sm" variant="secondary" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => onDelete(d)}>Hủy</Button>}
          </li>
        )
      })}
    </ul>
  )
}