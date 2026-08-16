import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarRange, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { shiftsApi } from '@/api/shifts'
import { orgApi } from '@/api/org'
import { PageHeader, Card, Spinner, EmptyState, Button, Select, Modal } from '@/components/ui'
import { PeriodPicker } from '@/components/admin/widgets'

export default function AdminShiftSchedule() {
  const qc = useQueryClient()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [dept, setDept] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [cell, setCell] = useState<{ empId: string; date: string } | null>(null)
  const [pickShift, setPickShift] = useState('')
  const [bulkShift, setBulkShift] = useState('')
  const [fromDay, setFromDay] = useState(1)
  const [toDay, setToDay] = useState(31)

  const { data: departments } = useQuery({ queryKey: ['org', 'departments'], queryFn: () => orgApi.departments() })
  const { data: shifts } = useQuery({ queryKey: ['shifts', 'list'], queryFn: () => shiftsApi.list() })
  const { data, isLoading } = useQuery({
    queryKey: ['shifts', 'schedule', year, month, dept],
    queryFn: () => shiftsApi.schedule({ year, month, departmentId: dept || undefined }),
  })

  const shiftMap = useMemo(() => new Map((shifts ?? []).map((s) => [s.id, s])), [shifts])
  const days = data?.days ?? []
  const employees = data?.employees ?? []

  const assign = useMutation({
    mutationFn: (p: { employeeId: string; date: string; shiftId: string | null }) => shiftsApi.assign(p),
    onSuccess: () => { toast.success('Đã phân ca'); setCell(null); setPickShift(''); qc.invalidateQueries({ queryKey: ['shifts', 'schedule'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const bulk = useMutation({
    mutationFn: (p: { employeeIds: string[]; shiftId: string; dates: string[] }) => shiftsApi.bulkAssign(p),
    onSuccess: () => { toast.success('Đã phân ca hàng loạt'); qc.invalidateQueries({ queryKey: ['shifts', 'schedule'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const toggleEmp = (id: string) => {
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelected(next)
  }
  const doBulk = () => {
    if (selected.size === 0 || !bulkShift) { toast.error('Chọn nhân viên và ca để phân hàng loạt'); return }
    const dates = days.filter((d) => { const day = Number(d.slice(8, 10)); return day >= fromDay && day <= toDay })
    bulk.mutate({ employeeIds: [...selected], shiftId: bulkShift, dates })
  }

  return (
    <div>
      <PageHeader title="Phân ca" subtitle="Bảng phân ca nhân viên × ngày trong tháng" />

      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <PeriodPicker year={year} month={month} onYear={setYear} onMonth={setMonth} showHalf={false}
            departments={departments} departmentId={dept} onDepartment={(v) => { setDept(v); setSelected(new Set()) }} />
          <div className="flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-3">
            <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><Wand2 className="h-4 w-4" /> Phân hàng loạt</span>
            <Select value={bulkShift} onChange={(e) => setBulkShift(e.target.value)} className="w-40">
              <option value="">-- Chọn ca --</option>
              {(shifts ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <input type="number" min={1} max={31} value={fromDay} onChange={(e) => setFromDay(Number(e.target.value))} className="w-16 rounded-lg border border-slate-300 px-2 py-2 text-sm" title="Từ ngày" />
            <span className="text-slate-400">→</span>
            <input type="number" min={1} max={31} value={toDay} onChange={(e) => setToDay(Number(e.target.value))} className="w-16 rounded-lg border border-slate-300 px-2 py-2 text-sm" title="Đến ngày" />
            <Button size="sm" loading={bulk.isPending} onClick={doBulk} disabled={selected.size === 0}>Áp dụng ({selected.size})</Button>
          </div>
        </div>
      </Card>

      <Card>
        {isLoading ? <div className="p-5"><Spinner /></div> : employees.length === 0 ? <EmptyState icon={<CalendarRange className="h-6 w-6" />} title="Không có nhân viên" /> : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50">
                  <th className="sticky left-0 z-10 bg-slate-50 px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                    <input type="checkbox" className="mr-2 align-middle"
                      checked={selected.size === employees.length && employees.length > 0}
                      onChange={(e) => setSelected(e.target.checked ? new Set(employees.map((x) => x.id)) : new Set())} />
                    Nhân viên
                  </th>
                  {days.map((d) => {
                    const day = Number(d.slice(8, 10)); const isWk = [0, 6].includes(new Date(d).getDay())
                    return <th key={d} className={`px-1 py-2 text-center text-xs font-medium ${isWk ? 'text-danger-500' : 'text-slate-400'}`}>{day}</th>
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {employees.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2">
                      <div className="flex items-center gap-2">
                        <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggleEmp(e.id)} className="align-middle" />
                        <div><p className="whitespace-nowrap font-medium text-slate-800">{e.fullName}</p><p className="text-xs text-slate-400">{e.employeeCode}</p></div>
                      </div>
                    </td>
                    {days.map((d) => {
                      const sc = data?.schedules[e.id]?.[d]
                      const sh = sc ? shiftMap.get(sc.shiftId) : null
                      return (
                        <td key={d} className="px-1 py-2 text-center">
                          <button onClick={() => { setCell({ empId: e.id, date: d }); setPickShift(sc?.shiftId ?? '') }}
                            className="grid h-7 w-7 place-items-center rounded-md text-[10px] font-bold text-white transition hover:scale-110"
                            style={{ background: sh?.color ?? 'transparent', color: sh ? '#fff' : '#cbd5e1' }}
                            title={sh ? `${sh.name}` : 'Bấm để phân ca'}>
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

      <Modal open={!!cell} onClose={() => setCell(null)} size="sm"
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
    </div>
  )
}