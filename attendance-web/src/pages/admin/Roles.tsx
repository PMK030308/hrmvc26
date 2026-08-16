import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck, Plus, Pencil, Check } from 'lucide-react'
import { toast } from 'sonner'
import { rolesApi } from '@/api/config'
import { orgApi } from '@/api/org'
import { ROLE_LABEL, PERMISSION_LABEL } from '@/constants/enums'
import { PageHeader, Card, CardHeader, Spinner, EmptyState, Button, Modal, Badge, Input, Select, Table, Tr, Td } from '@/components/ui'
import type { RoleCode, User } from '@/types'

const ALL_ROLES: RoleCode[] = ['Employee', 'Manager', 'Accountant', 'HR', 'Director', 'Admin']

export default function AdminRoles() {
  const qc = useQueryClient()
  const { data: matrix, isLoading } = useQuery({ queryKey: ['roles', 'matrix'], queryFn: () => rolesApi.matrix() })
  const { data: users } = useQuery({ queryKey: ['roles', 'users'], queryFn: () => rolesApi.users() })
  const { data: emps } = useQuery({ queryKey: ['org', 'employees', 'all'], queryFn: () => orgApi.employees() })
  const [edit, setEdit] = useState<User | null>(null)
  const [creating, setCreating] = useState(false)

  const empName = (id: string) => emps?.find((e) => e.id === id)?.fullName ?? id

  const update = useMutation({
    mutationFn: ({ id, roles }: { id: string; roles: RoleCode[] }) => rolesApi.updateUserRoles(id, roles),
    onSuccess: () => { toast.success('Đã cập nhật vai trò'); setEdit(null); qc.invalidateQueries({ queryKey: ['roles', 'users'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const create = useMutation({
    mutationFn: (p: { email: string; employeeId: string; roles: RoleCode[] }) => rolesApi.createUser(p),
    onSuccess: () => { toast.success('Đã tạo tài khoản'); setCreating(false); qc.invalidateQueries({ queryKey: ['roles', 'users'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div>
      <PageHeader title="Role & Phân quyền" subtitle="Ma trận quyền và quản lý tài khoản" actions={
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Tạo tài khoản</Button>
      } />

      <Card className="mb-5">
        <CardHeader title="Ma trận phân quyền" subtitle="Quyền theo tính năng & vai trò" icon={<ShieldCheck className="h-4 w-4" />} />
        {isLoading ? <div className="p-5"><Spinner /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50 text-left">
                  <th className="px-4 py-3 text-xs font-semibold uppercase text-slate-500">Tính năng</th>
                  {ALL_ROLES.map((r) => <th key={r} className="px-3 py-3 text-center text-xs font-semibold uppercase text-slate-500">{ROLE_LABEL[r].label}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(matrix ?? []).map((f) => (
                  <tr key={f.feature} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">{f.feature}</td>
                    {ALL_ROLES.map((r) => {
                      const perms = f.perms.find((p) => p.role === r)?.flags ?? []
                      return <td key={r} className="px-3 py-3 text-center">
                        {perms.length === 0 ? <span className="text-slate-300">—</span> :
                          <span className="inline-flex flex-wrap justify-center gap-1">{perms.map((p) => <span key={p} className="inline-flex items-center gap-0.5 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700"><Check className="h-2.5 w-2.5" />{PERMISSION_LABEL[p]}</span>)}</span>}
                      </td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title={`Tài khoản (${users?.length ?? 0})`} icon={<ShieldCheck className="h-4 w-4" />} />
        {(users ?? []).length === 0 ? <EmptyState icon={<ShieldCheck className="h-6 w-6" />} title="Không có tài khoản" /> : (
          <Table headers={['Tài khoản', 'Nhân viên', 'Vai trò', 'Thao tác']}>
            {users!.map((u) => (
              <Tr key={u.id}>
                <Td className="font-medium text-slate-800">{u.email}</Td>
                <Td>{empName(u.employeeId)}</Td>
                <Td><div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r} tone={ROLE_LABEL[r].tone as any}>{ROLE_LABEL[r].label}</Badge>)}</div></Td>
                <Td><Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEdit(u)}>Sửa vai trò</Button></Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={!!edit} onClose={() => setEdit(null)} size="sm" title="Chỉnh vai trò"
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Hủy</Button><Button loading={update.isPending} onClick={() => edit && update.mutate({ id: edit.id, roles: edit.roles })}>Lưu</Button></>}>
        {edit && <RolePicker roles={edit.roles} onChange={(roles) => setEdit({ ...edit, roles })} />}
      </Modal>

      <CreateUserModal open={creating} onClose={() => setCreating(false)} employees={emps ?? []} loading={create.isPending} onCreate={(p) => create.mutate(p)} />
    </div>
  )
}

function RolePicker({ roles, onChange }: { roles: RoleCode[]; onChange: (r: RoleCode[]) => void }) {
  const toggle = (r: RoleCode) => onChange(roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r])
  return (
    <div className="space-y-2">
      {ALL_ROLES.map((r) => (
        <label key={r} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-sm hover:bg-slate-50">
          <input type="checkbox" checked={roles.includes(r)} onChange={() => toggle(r)} />
          <Badge tone={ROLE_LABEL[r].tone as any}>{ROLE_LABEL[r].label}</Badge>
        </label>
      ))}
    </div>
  )
}

function CreateUserModal({ open, onClose, employees, loading, onCreate }: {
  open: boolean; onClose: () => void; employees: { id: string; fullName: string; employeeCode: string }[]
  loading: boolean; onCreate: (p: { email: string; employeeId: string; roles: RoleCode[] }) => void
}) {
  const [email, setEmail] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [roles, setRoles] = useState<RoleCode[]>(['Employee'])
  return (
    <Modal open={open} onClose={onClose} size="md" title="Tạo tài khoản mới"
      footer={<><Button variant="secondary" onClick={onClose}>Hủy</Button><Button loading={loading} disabled={!email || !employeeId || roles.length === 0} onClick={() => onCreate({ email, employeeId, roles })}>Tạo</Button></>}>
      <div className="space-y-4">
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@technova.vn" />
        <Select label="Nhân viên liên kết" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">-- Chọn nhân viên --</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName} ({e.employeeCode})</option>)}
        </Select>
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Vai trò</p>
          <RolePicker roles={roles} onChange={setRoles} />
        </div>
        <p className="rounded-lg bg-info-50 px-3 py-2 text-xs text-info-700">Mật khẩu mặc định: <b>123456</b> (demo).</p>
      </div>
    </Modal>
  )
}