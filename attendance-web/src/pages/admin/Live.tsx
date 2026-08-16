import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Radio, RefreshCw, CheckCircle2, XCircle, Clock3, LogOut, Users } from 'lucide-react'
import { timesheetApi } from '@/api/timesheet'
import { orgApi } from '@/api/org'
import { ymd } from '@/lib/date'
import { ATTENDANCE_STATUS_LABEL } from '@/constants/enums'
import { PageHeader, StatCard, Card, CardHeader, Spinner, EmptyState, Avatar, StatusBadge, Input, Badge } from '@/components/ui'
import type { AttendanceRecord } from '@/types'

type Bucket = 'present' | 'late' | 'early' | 'notyet'

export default function AdminLive() {
  const now = new Date()
  const today = ymd(now)
  const half = (now.getDate() <= 15 ? 1 : 2) as 1 | 2
  const [q, setQ] = useState('')
  const [dept, setDept] = useState('')

  const { data: depts } = useQuery({ queryKey: ['org', 'departments'], queryFn: () => orgApi.departments() })
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['timesheet', 'detailed', now.getFullYear(), now.getMonth() + 1, half, 'live'],
    queryFn: () => timesheetApi.detailed({ year: now.getFullYear(), month: now.getMonth() + 1, half }),
    refetchInterval: 30000,
  })

  const rows = useMemo(() => {
    if (!data) return []
    const deptMap = new Map((depts ?? []).map((d) => [d.id, d.name]))
    return data.employees
      .filter((e) => !dept || e.departmentId === dept)
      .filter((e) => !q || e.fullName.toLowerCase().includes(q.toLowerCase()) || e.employeeCode.toLowerCase().includes(q.toLowerCase()))
      .map((e) => {
        const rec = data.rows[e.id]?.[today] ?? null
        const bucket: Bucket = !rec || rec.checkInTime == null ? 'notyet' : rec.lateMinutes > 0 ? 'late' : rec.earlyLeaveMinutes > 0 ? 'early' : 'present'
        return { emp: e, rec, bucket, deptName: deptMap.get(e.departmentId) ?? '—' }
      })
  }, [data, depts, dept, q, today])

  const counts = useMemo(() => ({
    present: rows.filter((r) => r.bucket === 'present').length,
    late: rows.filter((r) => r.bucket === 'late').length,
    early: rows.filter((r) => r.bucket === 'early').length,
    notyet: rows.filter((r) => r.bucket === 'notyet').length,
  }), [rows])

  return (
    <div>
      <PageHeader title="Theo dõi Live" subtitle={`Chấm công realtime · ${today} · tự refresh 30s`}
        actions={
          <button onClick={() => refetch()} className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> Làm mới
          </button>
        } />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Đã có mặt" value={counts.present} icon={<CheckCircle2 className="h-5 w-5" />} tone="success" />
        <StatCard label="Đi muộn" value={counts.late} icon={<Clock3 className="h-5 w-5" />} tone="warning" />
        <StatCard label="Về sớm" value={counts.early} icon={<LogOut className="h-5 w-5" />} tone="info" />
        <StatCard label="Chưa chấm" value={counts.notyet} icon={<XCircle className="h-5 w-5" />} tone="danger" />
      </div>

      <Card className="mt-5">
        <CardHeader title="Danh sách nhân sự" icon={<Users className="h-4 w-4" />} action={
          <div className="flex flex-wrap gap-2">
            <select value={dept} onChange={(e) => setDept(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm">
              <option value="">Tất cả phòng</option>
              {(depts ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <Input placeholder="Tìm theo tên / mã NV..." value={q} onChange={(e) => setQ(e.target.value)} className="w-56" />
          </div>
        } />
        {isLoading ? <div className="p-5"><Spinner /></div> : rows.length === 0 ? <EmptyState icon={<Radio className="h-6 w-6" />} title="Không có dữ liệu" /> : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50 text-left">
                  <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-500">Nhân viên</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-500">Phòng ban</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-500">Giờ vào</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-500">Giờ ra</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-500">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(({ emp, rec, deptName }) => (
                  <tr key={emp.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Avatar name={emp.fullName} size="sm" />
                        <div>
                          <p className="font-medium text-slate-800">{emp.fullName}</p>
                          <p className="text-xs text-slate-400">{emp.employeeCode}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{deptName}</td>
                    <td className="px-4 py-3 font-mono text-slate-700">{rec?.checkInTime ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-slate-700">{rec?.checkOutTime ?? '—'}</td>
                    <td className="px-4 py-3">{renderLiveStatus(rec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function renderLiveStatus(rec: AttendanceRecord | null) {
  if (!rec || rec.checkInTime == null) return <Badge tone="muted" dot>Chưa chấm</Badge>
  if (rec.lateMinutes > 0) return <span className="inline-flex items-center gap-1.5"><Badge tone="warning" dot>Đi muộn {rec.lateMinutes}m</Badge></span>
  if (rec.earlyLeaveMinutes > 0) return <Badge tone="info" dot>Về sớm {rec.earlyLeaveMinutes}m</Badge>
  if (rec.checkOutTime == null) return <Badge tone="brand" dot>Đang làm</Badge>
  return <StatusBadge map={ATTENDANCE_STATUS_LABEL} value={rec.status} />
}