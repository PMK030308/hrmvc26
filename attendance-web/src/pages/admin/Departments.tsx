import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Building2, Briefcase, MapPin, Users } from 'lucide-react'
import { orgApi } from '@/api/org'
import { PageHeader, Card, CardHeader, CardBody, Spinner, EmptyState, Tabs, Avatar, Badge } from '@/components/ui'

export default function AdminDepartments() {
  const [tab, setTab] = useState('departments')
  const { data: departments, isLoading: ld } = useQuery({ queryKey: ['org', 'departments'], queryFn: () => orgApi.departments() })
  const { data: positions, isLoading: lp } = useQuery({ queryKey: ['org', 'positions'], queryFn: () => orgApi.positions() })
  const { data: branches, isLoading: lb } = useQuery({ queryKey: ['org', 'branches'], queryFn: () => orgApi.branches() })
  const { data: emps } = useQuery({ queryKey: ['org', 'employees', 'all'], queryFn: () => orgApi.employees() })

  const mgrName = (id: string | null) => emps?.find((e) => e.id === id)?.fullName
  const deptCount = (depId: string) => emps?.filter((e) => e.departmentId === depId && e.status === 2).length ?? 0

  return (
    <div>
      <PageHeader title="Phòng ban & Tổ chức" subtitle="Cơ cấu tổ chức TechNova JSC" />
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'departments', label: 'Phòng ban', count: departments?.length },
        { key: 'positions', label: 'Vị trí', count: positions?.length },
        { key: 'branches', label: 'Chi nhánh', count: branches?.length },
      ]} />

      <div className="mt-5">
        {tab === 'departments' && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ld ? <Card className="p-5"><Spinner /></Card> : (departments ?? []).map((d) => (
              <Card key={d.id}>
                <CardHeader title={d.name} subtitle={d.code} icon={<Building2 className="h-4 w-4" />} action={<Badge tone="brand">{deptCount(d.id)} NV</Badge>} />
                <CardBody className="space-y-3">
                  {d.managerEmployeeId && (
                    <div className="flex items-center gap-2">
                      <Avatar name={mgrName(d.managerEmployeeId) ?? '?'} size="sm" />
                      <div><p className="text-xs text-slate-400">Trưởng phòng</p><p className="text-sm font-medium text-slate-700">{mgrName(d.managerEmployeeId) ?? '—'}</p></div>
                    </div>
                  )}
                  <p className="text-xs text-slate-500">ID: <span className="font-mono">{d.id}</span></p>
                </CardBody>
              </Card>
            ))}
          </div>
        )}

        {tab === 'positions' && (
          <Card>
            {lp ? <div className="p-5"><Spinner /></div> : (positions ?? []).length === 0 ? <EmptyState icon={<Briefcase className="h-6 w-6" />} title="Không có vị trí" /> : (
              <div className="grid gap-px overflow-hidden bg-slate-100 sm:grid-cols-2 lg:grid-cols-3">
                {positions!.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 bg-white p-4">
                    <div className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-600"><Briefcase className="h-5 w-5" /></div>
                    <div><p className="text-sm font-semibold text-slate-800">{p.name}</p><p className="text-xs text-slate-400">{p.code}</p></div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {tab === 'branches' && (
          <div className="grid gap-4 sm:grid-cols-2">
            {lb ? <Card className="p-5"><Spinner /></Card> : (branches ?? []).map((b) => (
              <Card key={b.id}>
                <CardHeader title={b.name} icon={<MapPin className="h-4 w-4" />} />
                <CardBody><p className="text-sm text-slate-600">{b.address}</p>
                  <p className="mt-2 flex items-center gap-1 text-xs text-slate-400"><Users className="h-3 w-3" /> {emps?.filter((e) => e.branchId === b.id && e.status === 2).length ?? 0} nhân sự</p>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}