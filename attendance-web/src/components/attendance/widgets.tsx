// Widget chấm công: PunchCard, Summary30, RecentAttendance, StatusPill.
import { motion } from 'framer-motion'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Fingerprint, LogIn, LogOut, CheckCircle2, Clock3, UserPlus } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { attendanceApi } from '@/api/attendance'
import { faceApi } from '@/api/face'
import { usePunch, useClock } from '@/hooks/usePunch'
import { ATTENDANCE_STATUS_LABEL } from '@/constants/enums'
import { fmtDate, fmtHours, fmtMinutes } from '@/lib/date'
import { Badge, Button, Card, CardHeader, CardBody, Spinner, StatusBadge, EmptyState } from '@/components/ui'
import type { AttendanceRecord } from '@/types'
import { cn } from '@/lib/cn'
import { FacePunchModal } from './FacePunchModal'

/** Trạng thái chấm công hôm nay dạng pill. */
export function PunchStatusPill({ record, totalPunches }: { record: AttendanceRecord | null; totalPunches: number }) {
  if (!record || totalPunches === 0) return <Badge tone="muted" dot>Chưa chấm</Badge>
  const completed = record.checkInTime != null && record.checkOutTime != null
  if (completed) return <Badge tone="success" dot>Hoàn tất</Badge>
  if (record.checkInTime != null) return <Badge tone="brand" dot>Đã vào</Badge>
  return <Badge tone="warning" dot>Đang xử lý</Badge>
}

/** Thẻ chấm công lớn: đồng hồ + trạng thái + nút chấm. */
export function PunchCard() {
  const clock = useClock()
  const { record, punches, nextAction, isCompleted } = usePunch()
  const [faceOpen, setFaceOpen] = useState(false)
  const faceStatus = useQuery({ queryKey: ['face', 'status'], queryFn: () => faceApi.status() })
  const registered = faceStatus.data?.registered ?? false

  const actionLabel = nextAction === 'check_in' ? 'Chấm VÀO' : nextAction === 'check_out' ? 'Chấm RA' : 'Đã hoàn tất'
  const actionIcon = nextAction === 'check_in' ? <LogIn className="h-6 w-6" /> : nextAction === 'check_out' ? <LogOut className="h-6 w-6" /> : <CheckCircle2 className="h-6 w-6" />

  return (
    <Card className="overflow-hidden">
      <div className="relative bg-gradient-to-br from-brand-600 to-brand-800 px-6 py-6 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-brand-100">
            <Fingerprint className="h-5 w-5" /><span className="text-sm font-medium">Chấm công hôm nay</span>
          </div>
          <PunchStatusPill record={record} totalPunches={punches.length} />
        </div>
        <motion.div key={clock} initial={{ opacity: 0.6 }} animate={{ opacity: 1 }} className="mt-3 text-center">
          <p className="font-mono text-5xl font-bold tracking-tight tabular-nums">{clock}</p>
          <p className="mt-1 text-sm text-brand-200">{new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</p>
        </motion.div>
        {/* Vào / Ra hiện tại */}
        <div className="mt-4 grid grid-cols-2 gap-3 text-center">
          <div className="rounded-xl bg-white/10 py-2">
            <p className="text-[10px] uppercase text-brand-200">Giờ vào</p>
            <p className="font-mono text-lg font-semibold">{record?.checkInTime ?? '—'}</p>
          </div>
          <div className="rounded-xl bg-white/10 py-2">
            <p className="text-[10px] uppercase text-brand-200">Giờ ra</p>
            <p className="font-mono text-lg font-semibold">{record?.checkOutTime ?? '—'}</p>
          </div>
        </div>
      </div>
      <CardBody>
        {isCompleted ? (
          <Button disabled size="lg" className="w-full" icon={<CheckCircle2 className="h-6 w-6" />}>Đã hoàn tất chấm công hôm nay</Button>
        ) : registered ? (
          <Button onClick={() => setFaceOpen(true)} size="lg" className="w-full" icon={actionIcon}>
            {actionLabel} · quét khuôn mặt
          </Button>
        ) : (
          <div className="rounded-xl bg-warning-50 p-4 text-center">
            <p className="text-sm font-medium text-warning-800">Bạn chưa đăng ký khuôn mặt</p>
            <p className="mt-0.5 text-xs text-warning-700">Chấm công bắt buộc quét mặt thật — vui lòng đăng ký trước.</p>
            <Link to="/employee/face-register" className="mt-3 inline-flex items-center gap-2 rounded-lg bg-warning-600 px-4 py-2 text-sm font-semibold text-white hover:bg-warning-700">
              <UserPlus className="h-4 w-4" /> Đăng ký khuôn mặt
            </Link>
          </div>
        )}
        {punches.length > 0 && (
          <p className="mt-3 text-center text-xs text-slate-400">Đã chấm {punches.length} lượt hôm nay · Tổng {fmtHours(record?.actualWorkHours ?? 0)}</p>
        )}
      </CardBody>
      <FacePunchModal open={faceOpen} onClose={() => setFaceOpen(false)} nextAction={nextAction} onDone={() => setFaceOpen(false)} />
    </Card>
  )
}



/** Tổng hợp 30 ngày. */
export function Summary30() {
  const { data, isLoading } = useQuery({ queryKey: ['employee', 'dashboard'], queryFn: () => attendanceApi.dashboard() })
  if (isLoading || !data) return <Card className="p-5"><Spinner /></Card>
  const s = data.summary30
  const items = [
    { label: 'Có mặt', value: s.present, tone: 'success' as const, icon: <CheckCircle2 className="h-4 w-4" /> },
    { label: 'Vắng', value: s.absent, tone: 'danger' as const, icon: <Clock3 className="h-4 w-4" /> },
    { label: 'Đi muộn', value: s.late, tone: 'warning' as const, icon: <Clock3 className="h-4 w-4" /> },
    { label: 'Về sớm', value: s.early, tone: 'warning' as const, icon: <Clock3 className="h-4 w-4" /> },
    { label: 'Giờ làm', value: fmtHours(s.workHours), tone: 'brand' as const, icon: <Clock3 className="h-4 w-4" /> },
    { label: 'OT', value: fmtHours(s.otHours), tone: 'info' as const, icon: <Clock3 className="h-4 w-4" /> },
  ]
  return (
    <Card>
      <CardHeader title="Tổng hợp 30 ngày" subtitle="Thống kê chấm công gần đây" icon={<Clock3 className="h-4 w-4" />} />
      <CardBody className="grid grid-cols-3 gap-3">
        {items.map((it) => (
          <div key={it.label} className="rounded-xl bg-slate-50 p-3 text-center">
            <div className={cn('mx-auto mb-1 grid h-7 w-7 place-items-center rounded-lg',
              it.tone === 'success' ? 'bg-success-100 text-success-600' : it.tone === 'danger' ? 'bg-danger-100 text-danger-600' :
              it.tone === 'warning' ? 'bg-warning-100 text-warning-600' : it.tone === 'info' ? 'bg-info-100 text-info-600' : 'bg-brand-100 text-brand-600')}>{it.icon}</div>
            <p className="text-lg font-bold text-slate-800">{it.value}</p>
            <p className="text-[10px] text-slate-500">{it.label}</p>
          </div>
        ))}
      </CardBody>
    </Card>
  )
}

/** Bảng chấm công gần đây. */
export function RecentAttendance({ records }: { records: AttendanceRecord[] }) {
  return (
    <Card>
      <CardHeader title="Chấm công gần đây" icon={<Clock3 className="h-4 w-4" />} />
      {records.length === 0 ? <EmptyState icon={<Clock3 className="h-6 w-6" />} title="Chưa có dữ liệu" /> : (
        <div className="divide-y divide-slate-100">
          {records.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">{fmtDate(r.date, 'EEEE dd/MM')}</p>
                <p className="text-xs text-slate-500">{r.shiftName ?? 'Không ca'} · {r.checkInTime ?? '--:--'} → {r.checkOutTime ?? '--:--'}</p>
              </div>
              <div className="flex items-center gap-2">
                {r.lateMinutes > 0 && <Badge tone="warning">Muộn {fmtMinutes(r.lateMinutes)}</Badge>}
                {r.earlyLeaveMinutes > 0 && <Badge tone="warning">Sớm {fmtMinutes(r.earlyLeaveMinutes)}</Badge>}
                {r.overtimeHours > 0 && <Badge tone="info">OT {fmtHours(r.overtimeHours)}</Badge>}
                <StatusBadge map={ATTENDANCE_STATUS_LABEL} value={r.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

/** Nút chấm nổi (mobile) — mở quét khuôn mặt. */
export function FloatingPunch() {
  const { record, punches, nextAction, isCompleted } = usePunch()
  const [faceOpen, setFaceOpen] = useState(false)
  const label = nextAction === 'check_in' ? 'VÀO' : nextAction === 'check_out' ? 'RA' : 'OK'
  return (
    <>
      <motion.button
        onClick={() => setFaceOpen(true)} disabled={isCompleted}
        whileTap={{ scale: 0.9 }}
        className={cn('fixed bottom-20 right-4 z-20 grid h-16 w-16 place-items-center rounded-full text-white shadow-pop lg:hidden',
          isCompleted ? 'bg-success-600' : nextAction === 'check_out' ? 'bg-warning-600' : 'bg-brand-600')}>
        {!isCompleted && <span className="absolute inset-0 animate-pulse-ring rounded-full bg-brand-400/40" />}
        <span className="relative text-sm font-bold">{label}</span>
        {void record}{void punches}
      </motion.button>
      <FacePunchModal open={faceOpen} onClose={() => setFaceOpen(false)} nextAction={nextAction} onDone={() => setFaceOpen(false)} />
    </>
  )
}