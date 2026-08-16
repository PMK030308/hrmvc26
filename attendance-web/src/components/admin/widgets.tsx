// Widget dùng chung cho các cổng Admin/HR/Director/Accountant: biểu đồ,
// bộ chọn kỳ (năm/tháng/nửa tháng/phòng ban), chip trạng thái động.
import type { ReactNode } from 'react'
import { Select } from '@/components/ui'
import { cn } from '@/lib/cn'

type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'muted'
const barTone: Record<Tone, string> = {
  neutral: 'bg-slate-400', brand: 'bg-brand-500', success: 'bg-success-500',
  warning: 'bg-warning-500', danger: 'bg-danger-500', info: 'bg-info-500', muted: 'bg-slate-300',
}

/** Biểu đồ cột dọc đơn luồng. */
export function BarChart({ data, height = 160, tone = 'brand', valueFmt }: {
  data: { label: string; value: number }[]; height?: number; tone?: Tone; valueFmt?: (n: number) => string
}) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div className="flex items-end gap-1.5" style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="group flex flex-1 flex-col items-center justify-end gap-1.5">
          <span className="text-[10px] font-semibold text-slate-500 opacity-0 transition group-hover:opacity-100">
            {valueFmt ? valueFmt(d.value) : d.value}
          </span>
          <div
            className={cn('w-full rounded-t-md transition-all', barTone[tone])}
            style={{ height: `${Math.max(2, (d.value / max) * (height - 24))}px` }}
            title={`${d.label}: ${valueFmt ? valueFmt(d.value) : d.value}`}
          />
          <span className="w-full truncate text-center text-[10px] text-slate-400">{d.label}</span>
        </div>
      ))}
    </div>
  )
}

/** Biểu đồ cột nhóm 2 luồng (VD: đúng giờ vs đi muộn). */
export function GroupedBars({ data, height = 160, legend }: {
  data: { label: string; a: number; b: number }[]; height?: number; legend?: ReactNode
}) {
  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b]))
  return (
    <div>
      <div className="flex items-end gap-2" style={{ height }}>
        {data.map((d, i) => (
          <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1.5">
            <div className="flex w-full items-end justify-center gap-0.5" style={{ height: height - 18 }}>
              <div className="w-1/2 rounded-t bg-brand-500 transition-all group-hover:opacity-80"
                style={{ height: `${Math.max(2, (d.a / max) * (height - 22))}px` }} title={`Đúng giờ: ${d.a}`} />
              <div className="w-1/2 rounded-t bg-warning-400 transition-all"
                style={{ height: `${Math.max(2, (d.b / max) * (height - 22))}px` }} title={`Muộn: ${d.b}`} />
            </div>
            <span className="w-full truncate text-center text-[10px] text-slate-400">{d.label}</span>
          </div>
        ))}
      </div>
      {legend && <div className="mt-3 flex items-center justify-center gap-4 text-xs text-slate-500">{legend}</div>}
    </div>
  )
}

const MONTHS = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12']

/** Bộ chọn kỳ bảng công/lương. */
export function PeriodPicker({
  year, month, half, onYear, onMonth, onHalf,
  departments, departmentId, onDepartment, showHalf = true,
}: {
  year: number; month: number; half?: 1 | 2
  onYear: (y: number) => void; onMonth: (m: number) => void; onHalf?: (h: 1 | 2) => void
  departments?: { id: string; name: string }[]
  departmentId?: string; onDepartment?: (id: string) => void
  showHalf?: boolean
}) {
  const now = new Date()
  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Select label="Năm" value={year} onChange={(e) => onYear(Number(e.target.value))} className="w-28">
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </Select>
      <Select label="Tháng" value={month} onChange={(e) => onMonth(Number(e.target.value))} className="w-32">
        {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
      </Select>
      {showHalf && half && onHalf && (
        <Select label="Nửa tháng" value={half} onChange={(e) => onHalf(Number(e.target.value) as 1 | 2)} className="w-36">
          <option value={1}>Nửa đầu (1–15)</option>
          <option value={2}>Nửa cuối (16–cuối)</option>
        </Select>
      )}
      {departments && onDepartment && (
        <Select label="Phòng ban" value={departmentId ?? ''} onChange={(e) => onDepartment(e.target.value)} className="w-44">
          <option value="">Tất cả phòng</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
      )}
    </div>
  )
}

/** Khoảng rời rạc (legend chip). */
export function LegendDot({ tone, label }: { tone: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className={cn('h-2.5 w-2.5 rounded-sm', tone)} />{label}</span>
}