import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Settings2, Fingerprint, MapPin, Wifi, Globe, QrCode, ShieldCheck, ScanFace } from 'lucide-react'
import { attendanceApi } from '@/api/attendance'
import { Card, CardHeader, CardBody, PageHeader, Spinner, Badge } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { PunchSource } from '@/types'

const methods: { key: PunchSource; label: string; icon: React.ReactNode; desc: string }[] = [
  { key: 1, label: 'Khuôn mặt', icon: <Fingerprint className="h-5 w-5" />, desc: 'Nhận diện khuôn mặt + liveness check' },
  { key: 2, label: 'GPS', icon: <MapPin className="h-5 w-5" />, desc: 'Chấm công theo vị trí định vị' },
  { key: 3, label: 'Wi-Fi', icon: <Wifi className="h-5 w-5" />, desc: 'Chấm công theo SSID văn phòng' },
  { key: 4, label: 'QR Code', icon: <QrCode className="h-5 w-5" />, desc: 'Quét mã QR đặt tại công ty' },
  { key: 5, label: 'IP', icon: <Globe className="h-5 w-5" />, desc: 'Chấm công theo dải IP nội bộ' },
]

export default function PunchOptionsPage() {
  const { data, isLoading } = useQuery({ queryKey: ['punch-options'], queryFn: () => attendanceApi.punchOptions() })
  if (isLoading || !data) return <Card className="p-5"><Spinner /></Card>
  const reg = data.regulation
  const enabled = (s: PunchSource) => {
    if (s === 1) return reg.enablePunchFace
    if (s === 2) return reg.enablePunchGps
    if (s === 3) return reg.enablePunchWifi
    if (s === 4) return reg.enablePunchQr
    return reg.enablePunchIp
  }
  return (
    <div>
      <PageHeader title="Phương thức chấm công" subtitle="Cấu hình do HR thiết lập — bạn chỉ xem" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {methods.map((m) => {
          const on = enabled(m.key)
          return (
            <Card key={m.key} className={cn('p-4', !on && 'opacity-60')}>
              <div className="flex items-start justify-between">
                <div className={cn('grid h-11 w-11 place-items-center rounded-xl', on ? 'bg-brand-50 text-brand-600' : 'bg-slate-100 text-slate-400')}>{m.icon}</div>
                <Badge tone={on ? 'success' : 'muted'} dot>{on ? 'Đang bật' : 'Tắt'}</Badge>
              </div>
              <p className="mt-3 text-sm font-semibold text-slate-800">{m.label}</p>
              <p className="mt-1 text-xs text-slate-500">{m.desc}</p>
            </Card>
          )
        })}
        <Card className="p-4">
          <div className="flex items-start justify-between">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-info-50 text-info-600"><ShieldCheck className="h-5 w-5" /></div>
            <Badge tone={reg.requireLivenessCheck ? 'success' : 'muted'} dot>{reg.requireLivenessCheck ? 'Bắt buộc' : 'Không'}</Badge>
          </div>
          <p className="mt-3 text-sm font-semibold text-slate-800">Liveness check</p>
          <p className="mt-1 text-xs text-slate-500">Chống giả mạo khuôn mặt (ảnh/video).</p>
        </Card>
      </div>

      {reg.enablePunchFace && (
        <Card className="mt-5">
          <CardHeader title="Khuôn mặt" icon={<ScanFace className="h-4 w-4" />} />
          <CardBody className="flex flex-wrap gap-3">
            <Link to="/employee/face-register" className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"><ScanFace className="h-4 w-4" /> Đăng ký khuôn mặt</Link>
            <Link to="/employee/face-punch" className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200"><Fingerprint className="h-4 w-4" /> Chấm công bằng khuôn mặt</Link>
          </CardBody>
        </Card>
      )}

      <Card className="mt-5">
        <CardHeader title="Catalog vị trí" icon={<Settings2 className="h-4 w-4" />} />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <CatalogList title="GPS" items={reg.gpsCatalog.map((g) => `${g.name} · bán kính ${g.radiusMeters}m`)} />
          <CatalogList title="Wi-Fi" items={reg.wifiCatalog.map((w) => w.ssid)} />
          <CatalogList title="IP" items={reg.ipCatalog.map((i) => `${i.ipAddress}/${i.subnetBits}`)} />
        </CardBody>
      </Card>
    </div>
  )
}

function CatalogList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase text-slate-500">{title}</p>
      {items.length === 0 ? <p className="text-xs text-slate-400">Không có</p> : (
        <ul className="space-y-1">{items.map((it, i) => <li key={i} className="rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-600">{it}</li>)}</ul>
      )}
    </div>
  )
}