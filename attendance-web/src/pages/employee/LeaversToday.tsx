import { useQuery } from '@tanstack/react-query'
import { Users2, Plane } from 'lucide-react'
import { attendanceApi } from '@/api/attendance'
import { Card, CardHeader, PageHeader, Spinner, EmptyState, Avatar, Badge } from '@/components/ui'

export default function LeaversTodayPage() {
  const { data, isLoading } = useQuery({ queryKey: ['attendance', 'leavers-today'], queryFn: () => attendanceApi.leaversToday() })
  return (
    <div>
      <PageHeader title="Nhân viên nghỉ hôm nay" subtitle="Đồng nghiệp cùng phòng ban đang nghỉ phép" />
      {isLoading ? <Card className="p-5"><Spinner /></Card> : (
        <Card>
          <CardHeader title="Danh sách" subtitle={`${data?.length ?? 0} người`} icon={<Users2 className="h-4 w-4" />} />
          {data && data.length === 0 ? <EmptyState icon={<Plane className="h-6 w-6" />} title="Không ai nghỉ hôm nay" description="Toàn bộ đồng nghiệp đang làm việc." /> : (
            <div className="divide-y divide-slate-100">
              {data?.map((l) => (
                <div key={l.employee.id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={l.employee.fullName} size="sm" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-800">{l.employee.fullName}</p>
                    <p className="text-xs text-slate-500">{l.employee.employeeCode}</p>
                  </div>
                  <Badge tone="brand">{l.leaveType}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}