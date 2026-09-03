import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, Pencil, Plus, Search, ShieldCheck, Users } from 'lucide-react'
import { toast } from 'sonner'
import { rolesApi } from '@/api/config'
import { orgApi } from '@/api/org'
import { ROLE_LABEL } from '@/constants/enums'
import { togglePermission } from '@/lib/requestPermissionMatrix'
import { useAuthStore } from '@/stores/authStore'
import { Badge, Button, Card, CardHeader, EmptyState, Input, Modal, PageHeader, Select, Spinner } from '@/components/ui'
import type { PermissionMatrixEntry, RoleCode, User } from '@/types'
import { countPermissionChanges, groupPermissionRows, matchesNormalizedSearch } from './rolePermissionUiUtils'

const ALL_ROLES: RoleCode[] = ['Employee', 'Manager', 'Accountant', 'HR', 'Director', 'Admin']
const MATRIX_ROLES: RoleCode[] = ['Guest', ...ALL_ROLES]
type PageTab = 'matrix' | 'accounts'

export default function AdminRoles() {
  const qc = useQueryClient()
  const refreshCapabilities = useAuthStore((state) => state.refreshCapabilities)
  const { data: matrix, isLoading } = useQuery({ queryKey: ['roles', 'matrix'], queryFn: () => rolesApi.matrix() })
  const { data: users } = useQuery({ queryKey: ['roles', 'users'], queryFn: () => rolesApi.users() })
  const { data: emps } = useQuery({ queryKey: ['org', 'employees', 'all'], queryFn: () => orgApi.employees() })
  const [activeTab, setActiveTab] = useState<PageTab>('matrix')
  const [edit, setEdit] = useState<User | null>(null)
  const [creating, setCreating] = useState(false)
  const [matrixVersion, setMatrixVersion] = useState(0)
  const [matrixBaseline, setMatrixBaseline] = useState<PermissionMatrixEntry[]>([])
  const [matrixDraft, setMatrixDraft] = useState<PermissionMatrixEntry[]>([])
  const [permissionQuery, setPermissionQuery] = useState('')
  const [accountQuery, setAccountQuery] = useState('')
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set())
  const matrixInitialized = useRef(false)

  useEffect(() => {
    if (!matrix || matrixInitialized.current) return
    matrixInitialized.current = true
    const nextRows = matrix.permissions.map((row) => ({ ...row, roles: { ...row.roles } }))
    setMatrixVersion(matrix.version)
    setMatrixBaseline(nextRows.map((row) => ({ ...row, roles: { ...row.roles } })))
    setMatrixDraft(nextRows)
    setExpandedModules((current) => current.size > 0 || !nextRows[0] ? current : new Set([nextRows[0].module]))
  }, [matrix])

  const employeeNames = useMemo(() => new Map((emps ?? []).map((employee) => [employee.id, employee.fullName])), [emps])
  const permissionGroups = useMemo(() => groupPermissionRows(matrixDraft, permissionQuery), [matrixDraft, permissionQuery])
  const changedPermissions = useMemo(() => countPermissionChanges(matrixBaseline, matrixDraft), [matrixBaseline, matrixDraft])
  const filteredUsers = useMemo(() => {
    if (!accountQuery.trim()) return users ?? []
    return (users ?? []).filter((user) => {
      const employeeName = employeeNames.get(user.employeeId) ?? ''
      const roles = user.roles.map((role) => ROLE_LABEL[role].label).join(' ')
      return matchesNormalizedSearch(`${user.email} ${employeeName} ${roles}`, accountQuery)
    })
  }, [accountQuery, employeeNames, users])

  const update = useMutation({
    mutationFn: ({ id, user }: { id: string; user: User }) => rolesApi.updateUserAuthorization(id, user),
    onSuccess: async () => {
      toast.success('Đã cập nhật tài khoản')
      setEdit(null)
      await qc.invalidateQueries({ queryKey: ['roles', 'users'] })
      await refreshCapabilities()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const create = useMutation({
    mutationFn: (payload: { email: string; employeeId: string; roles: RoleCode[] }) => rolesApi.createUser(payload),
    onSuccess: () => {
      toast.success('Đã tạo tài khoản')
      setCreating(false)
      qc.invalidateQueries({ queryKey: ['roles', 'users'] })
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const saveMatrix = useMutation({
    mutationFn: () => rolesApi.updateMatrix(matrixVersion, matrixDraft),
    onSuccess: async (saved) => {
      const nextRows = saved.permissions.map((row) => ({ ...row, roles: { ...row.roles } }))
      setMatrixVersion(saved.version)
      setMatrixBaseline(nextRows.map((row) => ({ ...row, roles: { ...row.roles } })))
      setMatrixDraft(nextRows)
      toast.success('Đã cập nhật ma trận phân quyền')
      await qc.invalidateQueries({ queryKey: ['roles', 'matrix'] })
      await refreshCapabilities()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const toggleModule = (module: string) => {
    setExpandedModules((current) => {
      const next = new Set(current)
      if (next.has(module)) next.delete(module)
      else next.add(module)
      return next
    })
  }

  return <div>
    <PageHeader title="Quản lý vai trò & quyền" subtitle="Phân quyền hệ thống và quản lý tài khoản tập trung"
      actions={activeTab === 'accounts' ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Tạo tài khoản</Button> : undefined} />

    <div className="mb-5 inline-flex w-full rounded-xl bg-slate-100 p-1 sm:w-auto" aria-label="Nội dung quản lý quyền">
      <TabButton active={activeTab === 'matrix'} onClick={() => setActiveTab('matrix')} icon={<ShieldCheck className="h-4 w-4" />} label="Ma trận quyền" count={matrixDraft.length} />
      <TabButton active={activeTab === 'accounts'} onClick={() => setActiveTab('accounts')} icon={<Users className="h-4 w-4" />} label="Tài khoản" count={users?.length ?? 0} />
    </div>

    {activeTab === 'matrix' ? <PermissionMatrix
      groups={permissionGroups} loading={isLoading} version={matrixVersion} total={matrixDraft.length}
      query={permissionQuery} onQuery={setPermissionQuery} changed={changedPermissions}
      expanded={expandedModules} onToggleModule={toggleModule} onCollapse={() => setExpandedModules(new Set())}
      onExpandAll={() => setExpandedModules(new Set(permissionGroups.map((group) => group.module)))}
      setDraft={setMatrixDraft} saving={saveMatrix.isPending} onSave={() => saveMatrix.mutate()}
    /> : <AccountList users={filteredUsers} total={users?.length ?? 0} employeeNames={employeeNames}
      query={accountQuery} onQuery={setAccountQuery} onEdit={setEdit} />}

    <Modal open={!!edit} onClose={() => setEdit(null)} size="sm" title="Chỉnh vai trò"
      footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Hủy</Button><Button loading={update.isPending} onClick={() => edit && update.mutate({ id: edit.id, user: edit })}>Lưu</Button></>}>
      {edit && <div className="space-y-4">
        <label className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-sm"><input type="checkbox" checked={edit.isActive} onChange={(event) => setEdit({ ...edit, isActive: event.target.checked })} />Tài khoản đang hoạt động</label>
        <RolePicker roles={edit.roles} onChange={(roles) => setEdit({ ...edit, roles })} />
      </div>}
    </Modal>
    <CreateUserModal open={creating} onClose={() => setCreating(false)} employees={emps ?? []} loading={create.isPending} onCreate={(payload) => create.mutate(payload)} />
  </div>
}

function PermissionMatrix({ groups, loading, version, total, query, onQuery, changed, expanded, onToggleModule, onCollapse, onExpandAll, setDraft, saving, onSave }: {
  groups: ReturnType<typeof groupPermissionRows<PermissionMatrixEntry>>
  loading: boolean; version: number; total: number; query: string; onQuery: (value: string) => void; changed: number
  expanded: Set<string>; onToggleModule: (module: string) => void; onCollapse: () => void; onExpandAll: () => void
  setDraft: React.Dispatch<React.SetStateAction<PermissionMatrixEntry[]>>; saving: boolean; onSave: () => void
}) {
  return <Card className="overflow-hidden">
    <CardHeader title="Ma trận phân quyền" subtitle={`${groups.length} nhóm quyền · phiên bản ${version || '—'}`} icon={<ShieldCheck className="h-4 w-4" />}
      action={<Button size="sm" loading={saving} disabled={changed === 0} icon={<Check className="h-3.5 w-3.5" />} onClick={onSave}>{changed > 0 ? `Lưu ${changed} thay đổi` : 'Đã lưu'}</Button>} />
    <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <SearchBox value={query} onChange={onQuery} placeholder="Tìm tên hoặc mã quyền..." label="Tìm quyền" />
      <div className="flex items-center justify-between gap-2 sm:justify-end"><span className="text-xs text-slate-500">{total} quyền · {changed} thay đổi</span>{query.trim() ? <span className="text-xs font-medium text-brand-600">Đang lọc kết quả</span> : <><Button size="sm" variant="ghost" onClick={onCollapse}>Thu gọn</Button><Button size="sm" variant="ghost" onClick={onExpandAll}>Mở tất cả</Button></>}</div>
    </div>
    {loading ? <div className="p-5"><Spinner /></div> : groups.length === 0 ? <EmptyState icon={<Search className="h-6 w-6" />} title="Không tìm thấy quyền phù hợp" /> : (
      <div className="space-y-3 p-3 sm:p-4">{groups.map((group) => {
        const open = query.trim().length > 0 || expanded.has(group.module)
        return <section key={group.module} className="overflow-hidden rounded-xl border border-slate-200">
          <button type="button" disabled={query.trim().length > 0} onClick={() => onToggleModule(group.module)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 bg-slate-50 px-4 py-3 text-left transition hover:bg-slate-100 disabled:cursor-default disabled:hover:bg-slate-50">
            <span><span className="block text-sm font-semibold text-slate-800">{group.label}</span><span className="mt-0.5 block text-xs text-slate-500">{group.rows.length} quyền</span></span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && <div className="overflow-x-auto"><table className="w-full min-w-[880px] border-collapse text-sm"><thead><tr className="border-y border-slate-200 bg-white">
            <th className="sticky left-0 z-10 min-w-64 border-r border-slate-100 bg-white px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Quyền</th>
            {MATRIX_ROLES.map((role) => <th key={role} className="min-w-20 px-2 py-2.5 text-center text-xs font-semibold text-slate-500">{ROLE_LABEL[role].label}</th>)}
          </tr></thead><tbody className="divide-y divide-slate-100">{group.rows.map((row) => <tr key={row.key} title={row.key} className={`group ${row.enforced ? 'hover:bg-slate-50' : 'bg-slate-50/60 text-slate-400'}`}>
            <td className={`sticky left-0 z-10 border-r border-slate-100 px-4 py-2.5 ${row.enforced ? 'bg-white group-hover:bg-slate-50' : 'bg-slate-50'}`}><div className="flex items-center gap-2"><span className="font-medium text-slate-700">{row.label}</span>{!row.enforced && <Badge tone="neutral">Chưa thực thi</Badge>}</div></td>
            {MATRIX_ROLES.map((role) => <td key={role} className="px-2 py-2.5 text-center"><input type="checkbox" aria-label={`${row.label} - ${ROLE_LABEL[role].label}`} checked={row.roles[role]} disabled={!row.enforced || saving} onChange={() => setDraft((current) => togglePermission(current, row.key, role))} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" /></td>)}
          </tr>)}</tbody></table></div>}
        </section>
      })}</div>
    )}
  </Card>
}

function AccountList({ users, total, employeeNames, query, onQuery, onEdit }: { users: User[]; total: number; employeeNames: Map<string, string>; query: string; onQuery: (value: string) => void; onEdit: (user: User) => void }) {
  return <Card className="overflow-hidden"><CardHeader title={`Tài khoản (${total})`} subtitle="Tìm và chỉnh vai trò theo từng tài khoản" icon={<Users className="h-4 w-4" />} />
    <div className="border-b border-slate-100 px-4 py-3"><SearchBox value={query} onChange={onQuery} placeholder="Tìm email, nhân viên hoặc vai trò..." label="Tìm tài khoản" /></div>
    {users.length === 0 ? <EmptyState icon={<Users className="h-6 w-6" />} title={query ? 'Không tìm thấy tài khoản phù hợp' : 'Không có tài khoản'} /> : <div className="divide-y divide-slate-100">{users.map((user) => <div key={user.id} className="grid gap-3 px-4 py-4 transition hover:bg-slate-50 sm:px-5 md:grid-cols-[minmax(220px,1.2fr)_minmax(150px,.8fr)_minmax(220px,1fr)_auto] md:items-center">
      <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800">{user.email}</p><p className="mt-0.5 truncate text-xs text-slate-500">{employeeNames.get(user.employeeId) ?? user.employeeId}</p></div>
      <div><Badge tone={user.isActive ? 'success' : 'neutral'}>{user.isActive ? 'Hoạt động' : 'Vô hiệu hóa'}</Badge></div>
      <div className="flex flex-wrap gap-1">{user.roles.map((role) => <Badge key={role} tone={ROLE_LABEL[role].tone as any}>{ROLE_LABEL[role].label}</Badge>)}</div>
      <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => onEdit(user)}>Sửa vai trò</Button>
    </div>)}</div>}
  </Card>
}

function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (value: string) => void; placeholder: string; label: string }) {
  return <div className="relative w-full sm:max-w-sm"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={label} className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" /></div>
}

function TabButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; count: number }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition sm:flex-none ${active ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{icon}<span>{label}</span><span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">{count}</span></button>
}

function RolePicker({ roles, onChange }: { roles: RoleCode[]; onChange: (roles: RoleCode[]) => void }) {
  const toggle = (role: RoleCode) => onChange(roles.includes(role) ? roles.filter((item) => item !== role) : [...roles, role])
  return <div className="grid grid-cols-2 gap-2">{ALL_ROLES.map((role) => <label key={role} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm hover:bg-slate-50"><input type="checkbox" checked={roles.includes(role)} onChange={() => toggle(role)} /><Badge tone={ROLE_LABEL[role].tone as any}>{ROLE_LABEL[role].label}</Badge></label>)}</div>
}

function CreateUserModal({ open, onClose, employees, loading, onCreate }: { open: boolean; onClose: () => void; employees: { id: string; fullName: string; employeeCode: string }[]; loading: boolean; onCreate: (payload: { email: string; employeeId: string; roles: RoleCode[] }) => void }) {
  const [email, setEmail] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [roles, setRoles] = useState<RoleCode[]>(['Employee'])
  return <Modal open={open} onClose={onClose} size="md" title="Tạo tài khoản mới" footer={<><Button variant="secondary" onClick={onClose}>Hủy</Button><Button loading={loading} disabled={!email || !employeeId || roles.length === 0} onClick={() => onCreate({ email, employeeId, roles })}>Tạo</Button></>}><div className="space-y-4">
    <Input label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="user@technova.vn" />
    <Select label="Nhân viên liên kết" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">-- Chọn nhân viên --</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName} ({employee.employeeCode})</option>)}</Select>
    <div><p className="mb-2 text-sm font-medium text-slate-700">Vai trò</p><RolePicker roles={roles} onChange={setRoles} /></div>
    <p className="rounded-lg bg-info-50 px-3 py-2 text-xs text-info-700">Mật khẩu mặc định: <b>123456</b> (demo).</p>
  </div></Modal>
}
