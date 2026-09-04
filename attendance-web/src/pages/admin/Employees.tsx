import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Users, Plus, Search, Pencil, Trash2, Mail, Phone, Download, Upload, FileSpreadsheet, CircleCheck, CircleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { orgApi, type EmployeeImportResult } from '@/api/org'
import { fmtCurrency } from '@/lib/format'
import { fmtDate } from '@/lib/date'
import { EMPLOYEE_STATUS_LABEL, GENDER_LABEL, WORK_NATURE_LABEL, CONTRACT_LABEL } from '@/constants/enums'
import {
  PageHeader, Card, CardHeader, Spinner, EmptyState, Avatar, StatusBadge, Button, Modal,
  Input, Select, Textarea, ConfirmDialog, Badge,
} from '@/components/ui'
import type { Employee, EmployeeProjection } from '@/types'
import { useAuthStore } from '@/stores/authStore'
import { organizationCapabilities } from '@/lib/organizationCapabilities'

const empty: Partial<Employee> = { firstName: '', lastName: '', gender: 1, email: '', phone: '', status: 1, workNature: 1, contractType: 2, wage: 0, maritalStatus: 'Single' }

export default function AdminEmployees() {
  const user = useAuthStore((state) => state.user)!
  const capabilities = organizationCapabilities(user.effectivePermissions ?? [])
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [dept, setDept] = useState('')
  const [editing, setEditing] = useState<Partial<Employee> | null>(null)
  const [del, setDel] = useState<EmployeeProjection | null>(null)
  const [importResult, setImportResult] = useState<EmployeeImportResult | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const { data: emps, isLoading } = useQuery({ queryKey: ['org', 'employees', { dept, q }], queryFn: () => orgApi.employees({ departmentId: dept || undefined, search: q || undefined }), enabled: capabilities.canViewEmployees })
  const { data: departments } = useQuery({ queryKey: ['org', 'departments'], queryFn: () => orgApi.departments(), enabled: capabilities.canViewCatalog })
  const { data: positions } = useQuery({ queryKey: ['org', 'positions'], queryFn: () => orgApi.positions(), enabled: capabilities.canViewCatalog })
  const { data: branches } = useQuery({ queryKey: ['org', 'branches'], queryFn: () => orgApi.branches(), enabled: capabilities.canViewCatalog })

  const save = useMutation({
    mutationFn: (p: Partial<Employee>) => editing?.id ? orgApi.updateEmployee(editing.id, p) : orgApi.createEmployee(p),
    onSuccess: () => { toast.success(editing?.id ? 'Đã cập nhật nhân viên' : 'Đã tạo nhân viên'); setEditing(null); qc.invalidateQueries({ queryKey: ['org'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => orgApi.deactivateEmployee(id),
    onSuccess: () => { toast.success('Đã chuyển nhân viên sang trạng thái nghỉ việc'); setDel(null); qc.invalidateQueries({ queryKey: ['org'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const downloadTemplate = useMutation({
    mutationFn: () => orgApi.downloadEmployeeTemplate(),
    onError: (e: Error) => toast.error(e.message),
  })
  const exportExcel = useMutation({
    mutationFn: () => orgApi.exportEmployees(),
    onError: (e: Error) => toast.error(e.message),
  })
  const importExcel = useMutation({
    mutationFn: (file: File) => orgApi.importEmployees(file),
    onSuccess: (result) => {
      setImportResult(result)
      if (result.importedCount > 0) {
        toast.success(`Đã nhập ${result.importedCount} nhân viên`)
        qc.invalidateQueries({ queryKey: ['org'] })
      }
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const selectExcel = (file?: File) => {
    if (file) importExcel.mutate(file)
    if (fileInput.current) fileInput.current.value = ''
  }

  const deptName = (id: string) => departments?.find((d) => d.id === id)?.name ?? '—'
  const posName = (id: string) => positions?.find((p) => p.id === id)?.name ?? '—'

  return (
    <div>
      <PageHeader title="Nhân viên" subtitle="Quản lý hồ sơ nhân sự" actions={<div className="flex flex-wrap justify-end gap-2">
        {capabilities.canViewEmployees && <Button variant="secondary" loading={exportExcel.isPending} icon={<Download className="h-4 w-4" />} onClick={() => exportExcel.mutate()}>Xuất Excel</Button>}
        {capabilities.canManageEmployees && <>
          <Button variant="secondary" loading={downloadTemplate.isPending} icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => downloadTemplate.mutate()}>Tải file mẫu</Button>
          <Button variant="secondary" loading={importExcel.isPending} icon={<Upload className="h-4 w-4" />} onClick={() => fileInput.current?.click()}>Nhập Excel</Button>
          <input ref={fileInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(event) => selectExcel(event.target.files?.[0])} />
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ ...empty })}>Thêm nhân viên</Button>
        </>}
      </div>} />

      <Card>
        <CardHeader title={`Danh sách (${emps?.length ?? 0})`} icon={<Users className="h-4 w-4" />} action={
          <div className="flex flex-wrap gap-2">
            <select value={dept} onChange={(e) => setDept(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm">
              <option value="">Tất cả phòng</option>
              {(departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tên / mã / email..."
                className="w-56 rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand-500/20" />
            </div>
          </div>
        } />
        {isLoading ? <div className="p-5"><Spinner /></div> : (emps?.length ?? 0) === 0 ? <EmptyState icon={<Users className="h-6 w-6" />} title="Không có nhân viên" description="Thử bỏ bộ lọc hoặc thêm nhân viên mới." /> : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50 text-left">
                  <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-500">Nhân viên</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-500">Phòng / Vị trí</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-500">Liên hệ</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-500">Trạng thái</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-500">Ngày vào</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-500 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {emps!.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Avatar name={e.fullName} size="sm" src={e.avatarData} />
                        <div>
                          <p className="font-medium text-slate-800">{e.fullName}</p>
                          <p className="text-xs text-slate-400">{e.employeeCode}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><p className="text-slate-700">{deptName(e.departmentId)}</p><p className="text-xs text-slate-400">{posName(e.positionId)}</p></td>
                    <td className="px-4 py-3"><p className="flex items-center gap-1 text-xs text-slate-600"><Mail className="h-3 w-3" />{e.email}</p>{capabilities.canViewPrivate && <p className="flex items-center gap-1 text-xs text-slate-400"><Phone className="h-3 w-3" />{e.phone || '—'}</p>}</td>
                    <td className="px-4 py-3"><StatusBadge map={EMPLOYEE_STATUS_LABEL} value={e.status} /></td>
                    <td className="px-4 py-3 text-slate-600">{e.hireDate ? fmtDate(e.hireDate) : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      {capabilities.canManageEmployees && <div className="flex justify-end gap-1">
                        <button onClick={() => setEditing(e)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" title="Sửa"><Pencil className="h-4 w-4" /></button>
                        <button onClick={() => setDel(e)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-danger-50 hover:text-danger-600" title="Cho nghỉ việc"><Trash2 className="h-4 w-4" /></button>
                      </div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} size="lg"
        title={editing?.id ? 'Sửa nhân viên' : 'Thêm nhân viên'}
        footer={<>
          <Button variant="secondary" onClick={() => setEditing(null)}>Hủy</Button>
          <Button loading={save.isPending} onClick={() => save.mutate(editing!)}>Lưu</Button>
        </>}>
        {editing && <EmployeeForm value={editing} onChange={setEditing} departments={departments} positions={positions} branches={branches}
          canViewPrivate={capabilities.canViewPrivate} canViewCompensation={capabilities.canViewCompensation} />}
      </Modal>

      <ConfirmDialog open={!!del} onClose={() => setDel(null)} danger
        title="Cho nhân viên nghỉ việc" message={`Chuyển "${del?.fullName}" sang trạng thái nghỉ việc? Hồ sơ và lịch sử vẫn được giữ lại.`}
        confirmText="Xác nhận nghỉ việc" onConfirm={() => del && remove.mutate(del.id)} />

      <Modal open={!!importResult} onClose={() => setImportResult(null)} size="lg" title="Kết quả nhập Excel"
        footer={<Button onClick={() => setImportResult(null)}>Đóng</Button>}>
        {importResult && <div className="space-y-4">
          <div className={`flex items-start gap-3 rounded-xl border p-4 ${importResult.errors.length === 0 ? 'border-success-200 bg-success-50' : 'border-danger-200 bg-danger-50'}`}>
            {importResult.errors.length === 0 ? <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-success-600" /> : <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger-600" />}
            <div>
              <p className="font-semibold text-slate-800">{importResult.errors.length === 0 ? `Đã nhập thành công ${importResult.importedCount} nhân viên` : `Có ${importResult.errors.length} lỗi cần sửa`}</p>
              <p className="mt-1 text-sm text-slate-600">Đã kiểm tra {importResult.totalRows} dòng. {importResult.errors.length > 0 && 'Chưa có nhân viên nào được thêm; hãy sửa file rồi tải lại.'}</p>
            </div>
          </div>
          {importResult.errors.length > 0 && <div className="max-h-80 overflow-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Dòng</th><th className="px-4 py-3">Cột</th><th className="px-4 py-3">Lỗi</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{importResult.errors.map((error, index) => <tr key={`${error.row}-${error.field}-${index}`}>
                <td className="whitespace-nowrap px-4 py-3 font-mono font-semibold text-danger-600">{error.row || '—'}</td>
                <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-700">{error.field}</td>
                <td className="px-4 py-3 text-slate-600">{error.message}</td>
              </tr>)}</tbody>
            </table>
          </div>}
        </div>}
      </Modal>
    </div>
  )
}

function EmployeeForm({ value, onChange, departments, positions, branches, canViewPrivate, canViewCompensation }: {
  value: Partial<Employee>; onChange: (v: Partial<Employee>) => void
  departments?: { id: string; name: string }[]; positions?: { id: string; name: string }[]; branches?: { id: string; name: string }[]
  canViewPrivate: boolean; canViewCompensation: boolean
}) {
  const set = (k: keyof Employee, v: any) => onChange({ ...value, [k]: v })
  return (
    <div className="grid grid-cols-2 gap-4">
      {canViewPrivate && <Input label="Họ" value={value.lastName ?? ''} onChange={(e) => set('lastName', e.target.value)} />}
      {canViewPrivate && <Input label="Tên" value={value.firstName ?? ''} onChange={(e) => set('firstName', e.target.value)} />}
      <Input label="Mã NV" value={value.employeeCode ?? ''} onChange={(e) => set('employeeCode', e.target.value)} placeholder="Tự sinh nếu trống" />
      {canViewPrivate && <Select label="Giới tính" value={value.gender ?? 1} onChange={(e) => set('gender', Number(e.target.value))}>
        {Object.entries(GENDER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </Select>}
      <Input label="Email" type="email" value={value.email ?? ''} onChange={(e) => set('email', e.target.value)} />
      {canViewPrivate && <Input label="Số điện thoại" value={value.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />}
      <Select label="Phòng ban" value={value.departmentId ?? ''} onChange={(e) => set('departmentId', e.target.value)}>
        <option value="">-- Chọn --</option>
        {(departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </Select>
      <Select label="Vị trí" value={value.positionId ?? ''} onChange={(e) => set('positionId', e.target.value)}>
        <option value="">-- Chọn --</option>
        {(positions ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select>
      <Select label="Chi nhánh" value={value.branchId ?? ''} onChange={(e) => set('branchId', e.target.value || null)}>
        <option value="">-- Không --</option>
        {(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </Select>
      <Select label="Trạng thái" value={value.status ?? 1} onChange={(e) => set('status', Number(e.target.value))}>
        {(Object.entries(EMPLOYEE_STATUS_LABEL) as [string, { label: string }][]).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </Select>
      {canViewPrivate && <Select label="Tính chất công việc" value={value.workNature ?? 1} onChange={(e) => set('workNature', Number(e.target.value))}>
        {Object.entries(WORK_NATURE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </Select>}
      {canViewPrivate && <Select label="Loại hợp đồng" value={value.contractType ?? 2} onChange={(e) => set('contractType', Number(e.target.value))}>
        {Object.entries(CONTRACT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </Select>}
      {canViewPrivate && <Input label="Ngày vào làm" type="date" value={value.hireDate ?? ''} onChange={(e) => set('hireDate', e.target.value)} />}
      {canViewCompensation && <Input label="Lương cơ bản (VND)" type="number" value={value.wage ?? 0} onChange={(e) => set('wage', Number(e.target.value))} />}
      {canViewPrivate && <div className="col-span-2"><Textarea label="Địa chỉ" rows={2} value={value.address ?? ''} onChange={(e) => set('address', e.target.value)} /></div>}
      {canViewCompensation && value.id && <div className="col-span-2"><Badge tone="info">Lương hiện tại: {fmtCurrency(value.wage ?? 0)}</Badge></div>}
    </div>
  )
}
