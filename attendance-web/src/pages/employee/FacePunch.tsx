import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ScanFace, Camera, Fingerprint, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { attendanceApi } from '@/api/attendance'
import { Card, CardBody, PageHeader, Button, Spinner, Badge } from '@/components/ui'
import { fmtTime } from '@/lib/date'

export default function FacePunchPage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const [cameraOn, setCameraOn] = useState(false)
  const qc = useQueryClient()

  const punch = useMutation({
    mutationFn: (snap: string) => attendanceApi.punch({ source: 1, snapshotBase64: snap }),
    onSuccess: (res) => {
      toast.success(res.message)
      qc.invalidateQueries({ queryKey: ['attendance', 'today'] })
      qc.invalidateQueries({ queryKey: ['employee', 'dashboard'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  async function startCamera() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      setCameraOn(true)
      setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play() } }, 50)
    } catch {
      toast.info('Không truy cập được camera — dùng ảnh demo.')
      setSnapshot(`data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect fill="#e2e8f0" width="320" height="240"/><circle cx="160" cy="110" r="50" fill="#94a3b8"/><text x="50%" y="200" font-size="14" fill="#475569" text-anchor="middle">Khuôn mặt demo</text></svg>')}`)
    }
  }
  function capture() {
    if (videoRef.current && cameraOn) {
      const canvas = document.createElement('canvas')
      canvas.width = 320; canvas.height = 240
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(videoRef.current, 0, 0, 320, 240)
      const snap = canvas.toDataURL('image/png')
      setSnapshot(snap)
      punch.mutate(snap)
    }
  }

  return (
    <div>
      <PageHeader title="Chấm công bằng khuôn mặt" subtitle="Nhận diện khuôn mặt & chấm công tự động" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardBody>
            <div className="relative mx-auto grid aspect-[4/3] w-full max-w-md place-items-center overflow-hidden rounded-2xl bg-slate-900">
              {snapshot ? (
                <img src={snapshot} alt="snap" className="h-full w-full object-cover" />
              ) : cameraOn ? (
                <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
              ) : (
                <div className="text-center text-slate-400"><ScanFace className="mx-auto h-12 w-12" /><p className="mt-2 text-sm">Bật camera để chấm công</p></div>
              )}
              {/* Khung nhận diện */}
              <div className="pointer-events-none absolute inset-x-12 top-1/2 h-28 -translate-y-1/2 rounded-2xl border-2 border-white/70" />
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {!cameraOn && <Button onClick={startCamera} icon={<Camera className="h-4 w-4" />}>Bật camera</Button>}
              {cameraOn && !punch.isPending && <Button onClick={capture} icon={<Fingerprint className="h-4 w-4" />}>Chấm công</Button>}
              {punch.isPending && <Button loading>Đang nhận diện...</Button>}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-4 text-sm">
            <h3 className="text-base font-semibold text-slate-800">Trạng thái chấm công</h3>
            {punch.data ? (
              <div className="space-y-3 rounded-xl bg-success-50 p-4">
                <div className="flex items-center gap-2 text-success-700"><CheckCircle2 className="h-5 w-5" /><span className="font-semibold">{punch.data.message}</span></div>
                <div className="grid grid-cols-2 gap-3 text-slate-700">
                  <Field label="Giờ vào" value={punch.data.checkIn ?? '—'} />
                  <Field label="Giờ ra" value={punch.data.checkOut ?? '—'} />
                  <Field label="Tổng lượt" value={`${punch.data.totalPunches}`} />
                  <Field label="Tổng giờ" value={`${punch.data.totalWorkHours}h`} />
                </div>
                <p className="text-xs text-success-600">Thời điểm: {fmtTime(new Date())}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-8 text-slate-400">
                {punch.isPending ? <Spinner className="h-8 w-8" /> : <Fingerprint className="h-10 w-10" />}
                <p className="text-sm">Chưa chấm. Đặt khuôn mặt vào khung rồi bấm “Chấm công”.</p>
              </div>
            )}
            <div className="flex items-center gap-2 text-xs text-slate-500"><Badge tone="brand">Liveness</Badge> Hệ thống kiểm tra khuôn mặt thật (demo).</div>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-slate-500">{label}</p><p className="font-mono text-sm font-semibold text-slate-800">{value}</p></div>
}