import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarRange, Download, FileSpreadsheet, Upload, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { shiftsApi } from '@/api/shifts'
import { orgApi } from '@/api/org'
import { PageHeader, Card, Spinner, EmptyState, Button, Select, Modal } from '@/components/ui'
import { PeriodPicker } from '@/components/admin/widgets'
import { usePermissions } from '@/hooks/usePermissions'
import type { Employee } from '@/types'
import type { BulkImportResult } from '@/api/shifts'
import { ImportResultModal } from '@/components/admin/ImportResultModal'
import {
  DEFAULT_WORK_WEEKDAYS,
  filterBulkScheduleDates,
  getScheduleDayMeta,
  WEEKDAY_OPTIONS,
} from './shiftScheduleUtils'

const EMPTY_DAYS: string[] = []
const EMPTY_EMPLOYEES: Employee[] = []

export default function AdminShiftSchedule() {
  const { hasPermission } = usePermissions()
  const canManage = hasPermission('shifts.schedule.manage_scoped') || hasPermission('shifts.schedule.manage_all')
  const qc = useQueryClient()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [dept, setDept] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [cell, setCell] = useState<{ empId: string; date: string } | null>(null)
  const [pickShift, setPickShift] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkShift, setBulkShift] = useState('')
  const [fromDay, setFromDay] = useState(1)
  const [toDay, setToDay] = useState(31)
  const [selectedWeekdays, setSelectedWeekdays] = useState<Set<number>>(
    () => new Set(DEFAULT_WORK_WEEKDAYS),
  )
  const importInput = useRef<HTMLInputElement>(null)
  const [importResult, setImportResult] = useState<BulkImportResult | null>(null)

  const { data: departments } = useQuery({ queryKey: ['org', 'departments'], queryFn: () => orgApi.departments() })
  const { data: shifts } = useQuery({ queryKey: ['shifts', 'list'], queryFn: () => shiftsApi.list() })
  const { data, isLoading } = useQuery({
    queryKey: ['shifts', 'schedule', year, month, dept],
    queryFn: () => shiftsApi.schedule({ year, month, departmentId: dept || undefined }),
  })

  const shiftMap = useMemo(() => new Map((shifts ?? []).map((s) => [s.id, s])), [shifts])
  const days = data?.days ?? EMPTY_DAYS
  const employees = data?.employees ?? EMPTY_EMPLOYEES
  const dayOptions = useMemo(() => days.map(getScheduleDayMeta), [days])
  const selectedEmployeeIds = useMemo(
    () => employees.filter((employee) => selected.has(employee.id)).map((employee) => employee.id),
    [employees, selected],
  )
  const bulkDates = useMemo(
    () => filterBulkScheduleDates(days, fromDay, toDay, selectedWeekdays),
    [days, fromDay, toDay, selectedWeekdays],
  )

  const assign = useMutation({
    mutationFn: (p: { employeeId: string; date: string; shiftId: string | null }) => shiftsApi.assign(p),
    onSuccess: () => { toast.success('Đã phân ca'); setCell(null); setPickShift(''); qc.invalidateQueries({ queryKey: ['shifts', 'schedule'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const bulk = useMutation({
    mutationFn: (p: { employeeIds: string[]; shiftId: string; dates: string[] }) => shiftsApi.bulkAssign(p),
    onSuccess: () => {
      toast.success('Đã phân ca hàng loạt')
      setBulkOpen(false)
      setBulkShift('')
      qc.invalidateQueries({ queryKey: ['shifts', 'schedule'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const exportExcel = useMutation({
    mutationFn: () => shiftsApi.exportSchedule({ year, month, departmentId: dept || undefined }),
    onSuccess: () => toast.success('Đã xuất lịch phân ca Excel'), onError: (error: Error) => toast.error(error.message),
  })
  const downloadTemplate = useMutation({
    mutationFn: () => shiftsApi.downloadScheduleTemplate(), onError: (error: Error) => toast.error(error.message),
  })
  const importExcel = useMutation({
    mutationFn: (file: File) => shiftsApi.importSchedule(file),
    onSuccess: (result) => {
      setImportResult(result)
      if (result.importedCount) { toast.success(`Đã nhập ${result.importedCount} lượt phân ca`); qc.invalidateQueries({ queryKey: ['shifts', 'schedule'] }) }
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const toggleEmp = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }
  const openBulk = () => {
    setBulkShift('')
    setFromDay(1)
    setToDay(days.length)
    setSelectedWeekdays(new Set(DEFAULT_WORK_WEEKDAYS))
    setBulkOpen(true)
  }
  const closeBulk = () => {
    if (!bulk.isPending) setBulkOpen(false)
  }
  const toggleWeekday = (weekday: number) => {
    setSelectedWeekdays((current) => {
      const next = new Set(current)
      if (next.has(weekday)) next.delete(weekday)
      else next.add(weekday)
      return next
    })
  }
  const doBulk = () => {
    if (selectedEmployeeIds.length === 0 || !bulkShift || bulkDates.length === 0) return
    bulk.mutate({ employeeIds: selectedEmployeeIds, shiftId: bulkShift, dates: bulkDates })
  }

  return (
    <div>
      <PageHeader title="Phân ca" subtitle="Bảng phân ca nhân viên × ngày trong tháng" actions={<div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon={<Download className="h-4 w-4" />} loading={exportExcel.isPending} onClick={() => exportExcel.mutate()}>Xuất Excel</Button>
        {canManage && <><Button variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} loading={downloadTemplate.isPending} onClick={() => downloadTemplate.mutate()}>File mẫu</Button>
          <Button variant="secondary" icon={<Upload className="h-4 w-4" />} loading={importExcel.isPending} onClick={() => importInput.current?.click()}>Nhập Excel</Button>
          <input ref={importInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) importExcel.mutate(file); event.target.value = '' }} /></>}
      </div>} />

      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <PeriodPicker year={year} month={month} onYear={setYear} onMonth={setMonth} showHalf={false}
            departments={departments} departmentId={dept} onDepartment={(v) => { setDept(v); setSelected(new Set()) }} />
          {canManage && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-3">
              <span className="text-xs text-slate-500">
                Đã chọn <strong className="font-semibold text-slate-700">{selectedEmployeeIds.length}</strong> nhân viên
              </span>
              <Button size="sm" icon={<Wand2 className="h-4 w-4" />} onClick={openBulk}
                disabled={selectedEmployeeIds.length === 0 || days.length === 0}>
                Phân ca hàng loạt
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Chú thích màu ca — khớp với ô màu trong bảng */}
      {shifts && shifts.length > 0 && (
        <Card className="mb-5 p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-600">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Chú thích màu ca</span>
            {shifts.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1.5">
                <span className="grid h-5 w-5 place-items-center rounded-md text-[10px] font-bold text-white" style={{ background: s.color }}>
                  {s.name.charAt(0)}
                </span>
                <span className="font-medium text-slate-700">{s.name}</span>
                <span className="text-slate-400">({s.startTime.slice(0, 5)}–{s.endTime.slice(0, 5)}{s.isOvernight ? '+hôm sau' : ''})</span>
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span className="grid h-5 w-5 place-items-center rounded-md border border-slate-200 text-[10px] text-slate-300">·</span>
              <span>Chưa phân ca</span>
            </span>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        {isLoading ? <div className="p-5"><Spinner /></div> : employees.length === 0 ? <EmptyState icon={<CalendarRange className="h-6 w-6" />} title="Không có nhân viên" /> : (
          <div className="w-full overflow-x-auto overscroll-x-contain">
            <table className="w-max min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50">
                  <th className="sticky left-0 z-20 w-[220px] min-w-[220px] border-r border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500 [box-shadow:4px_0_10px_-8px_rgba(15,23,42,0.8)]">
                    {canManage && <input type="checkbox" className="mr-2 align-middle"
                      checked={selected.size === employees.length && employees.length > 0}
                      onChange={(e) => setSelected(e.target.checked ? new Set(employees.map((x) => x.id)) : new Set())} />}
                    Nhân viên
                  </th>
                  {days.map((d) => {
                    const meta = getScheduleDayMeta(d)
                    return (
                      <th key={d} scope="col" title={`${meta.weekdayLabel}, ngày ${meta.dayLabel}/${String(month).padStart(2, '0')}/${year}`}
                        className={`min-w-[72px] px-2 py-2.5 text-center ${meta.isWeekend ? 'text-danger-500' : 'text-slate-500'}`}>
                        <span className="block text-sm font-semibold leading-5">{meta.dayLabel}</span>
                        <span className="block whitespace-nowrap text-[11px] font-medium leading-4">{meta.weekdayLabel}</span>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {employees.map((e) => (
                  <tr key={e.id} className="group hover:bg-slate-50">
                    <td className="sticky left-0 z-10 w-[220px] min-w-[220px] border-r border-slate-100 bg-white px-4 py-2 transition group-hover:bg-slate-50 [box-shadow:4px_0_10px_-8px_rgba(15,23,42,0.8)]">
                      <div className="flex items-center gap-2">
                        {canManage && <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggleEmp(e.id)} className="align-middle" />}
                        <div><p className="whitespace-nowrap font-medium text-slate-800">{e.fullName}</p><p className="text-xs text-slate-400">{e.employeeCode}</p></div>
                      </div>
                    </td>
                    {days.map((d) => {
                      const sc = data?.schedules[e.id]?.[d]
                      const sh = sc ? shiftMap.get(sc.shiftId) : null
                      return (
                        <td key={d} className="min-w-[72px] px-2 py-2 text-center">
                          <button disabled={!canManage} onClick={() => { if (canManage) { setCell({ empId: e.id, date: d }); setPickShift(sc?.shiftId ?? '') } }}
                            className="mx-auto grid h-9 w-9 place-items-center rounded-lg text-xs font-bold text-white transition enabled:hover:scale-110 disabled:cursor-default"
                            style={{ background: sh?.color ?? 'transparent', color: sh ? '#fff' : '#cbd5e1' }}
                            title={sh ? `${sh.name}` : canManage ? 'Bấm để phân ca' : 'Chỉ có quyền xem'}>
                            {sh ? sh.name.charAt(0) : '·'}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={canManage && bulkOpen} onClose={closeBulk} size="md" title="Phân ca hàng loạt"
        footer={<>
          <Button variant="secondary" onClick={closeBulk} disabled={bulk.isPending}>Hủy</Button>
          <Button loading={bulk.isPending}
            disabled={!bulkShift || selectedEmployeeIds.length === 0 || bulkDates.length === 0}
            onClick={doBulk}>
            Áp dụng {bulkDates.length > 0 ? `(${bulkDates.length} ngày)` : ''}
          </Button>
        </>}>
        <div className="space-y-5">
          <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-800">
            Áp dụng cho <strong>{selectedEmployeeIds.length} nhân viên</strong> trong tháng {String(month).padStart(2, '0')}/{year}.
          </div>

          <Select id="bulk-shift" label="Ca làm việc" value={bulkShift} disabled={bulk.isPending}
            onChange={(event) => setBulkShift(event.target.value)}>
            <option value="">-- Chọn ca --</option>
            {(shifts ?? []).map((shift) => (
              <option key={shift.id} value={shift.id}>
                {shift.name} ({shift.startTime.slice(0, 5)}–{shift.endTime.slice(0, 5)})
              </option>
            ))}
          </Select>

          <fieldset disabled={bulk.isPending}>
            <legend className="mb-2 text-sm font-medium text-slate-700">Khoảng ngày</legend>
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
              <Select id="bulk-from-day" label="Từ ngày" value={fromDay}
                onChange={(event) => setFromDay(Number(event.target.value))}>
                {dayOptions.map(({ day, dayLabel }) => <option key={day} value={day}>{dayLabel}</option>)}
              </Select>
              <span className="pb-2 text-slate-400">→</span>
              <Select id="bulk-to-day" label="Đến ngày" value={toDay}
                onChange={(event) => setToDay(Number(event.target.value))}>
                {dayOptions.map(({ day, dayLabel }) => <option key={day} value={day}>{dayLabel}</option>)}
              </Select>
            </div>
          </fieldset>

          <fieldset disabled={bulk.isPending}>
            <legend className="mb-2 text-sm font-medium text-slate-700">Chọn thứ áp dụng</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {WEEKDAY_OPTIONS.map((option) => {
                const active = selectedWeekdays.has(option.value)
                return (
                  <button key={option.value} type="button" aria-pressed={active} onClick={() => toggleWeekday(option.value)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-brand-500/30 ${
                      active
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                    }`}>
                    {option.label}
                  </button>
                )
              })}
            </div>
          </fieldset>

          <div className={`rounded-xl px-4 py-3 text-sm ${
            bulkDates.length > 0 && fromDay <= toDay
              ? 'bg-slate-50 text-slate-600'
              : 'bg-danger-50 text-danger-700'
          }`}>
            {fromDay > toDay
              ? 'Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc.'
              : selectedWeekdays.size === 0
                ? 'Hãy chọn ít nhất một thứ trong tuần.'
                : bulkDates.length === 0
                  ? 'Không có ngày nào phù hợp với lựa chọn hiện tại.'
                  : <>Sẽ phân <strong>{bulkDates.length} ngày</strong> cho <strong>{selectedEmployeeIds.length} nhân viên</strong>.</>}
          </div>

          <p className="text-xs leading-5 text-slate-500">
            Ca hiện có trong những ngày được chọn sẽ được cập nhật sang ca mới.
          </p>
        </div>
      </Modal>

      <Modal open={canManage && !!cell} onClose={() => setCell(null)} size="sm"
        title={`Phân ca · ${cell?.date ?? ''}`}
        footer={<>
          <Button variant="secondary" onClick={() => { setCell(null); setPickShift('') }}>Hủy</Button>
          {pickShift && <Button variant="danger" onClick={() => cell && assign.mutate({ employeeId: cell.empId, date: cell.date, shiftId: null })}>Xóa ca</Button>}
          <Button loading={assign.isPending} disabled={!pickShift} onClick={() => cell && pickShift && assign.mutate({ employeeId: cell.empId, date: cell.date, shiftId: pickShift })}>Lưu</Button>
        </>}>
        <Select label="Chọn ca" value={pickShift} onChange={(e) => setPickShift(e.target.value)}>
          <option value="">-- Chọn ca --</option>
          {(shifts ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.startTime.slice(0, 5)}–{s.endTime.slice(0, 5)})</option>)}
        </Select>
      </Modal>
      <ImportResultModal result={importResult} onClose={() => setImportResult(null)} />
    </div>
  )
}
