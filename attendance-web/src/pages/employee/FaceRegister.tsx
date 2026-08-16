import { useRef, useState } from 'react'
import { ScanFace, Camera, CheckCircle2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardBody, PageHeader, Button } from '@/components/ui'

export default function FaceRegisterPage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const [, setStream] = useState<MediaStream | null>(null)
  const [registered, setRegistered] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)

  async function startCamera() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      setStream(s)
      setCameraOn(true)
      setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play() } }, 50)
    } catch {
      // Fallback demo khi không có camera (headless / từ chối quyền)
      toast.info('Không truy cập được camera — dùng ảnh đại diện demo.')
      setSnapshot(`data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect fill="#e2e8f0" width="320" height="240"/><text x="50%" y="50%" font-size="18" fill="#64748b" text-anchor="middle">Ảnh demo</text></svg>')}`)
    }
  }
  function capture() {
    if (videoRef.current && cameraOn) {
      const canvas = document.createElement('canvas')
      canvas.width = 320; canvas.height = 240
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(videoRef.current, 0, 0, 320, 240)
      setSnapshot(canvas.toDataURL('image/png'))
    }
  }
  function register() {
    if (!snapshot) return
    setRegistered(true)
    toast.success('Đã đăng ký khuôn mặt thành công (demo).')
  }
  function reset() { setSnapshot(null); setRegistered(false) }

  return (
    <div>
      <PageHeader title="Đăng ký khuôn mặt" subtitle="Chụp ảnh khuôn mặt để dùng cho chấm công nhận diện" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardBody>
            <div className="relative mx-auto grid aspect-[4/3] w-full max-w-md place-items-center overflow-hidden rounded-2xl bg-slate-900">
              {snapshot ? (
                <img src={snapshot} alt="snapshot" className="h-full w-full object-cover" />
              ) : cameraOn ? (
                <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
              ) : (
                <div className="text-center text-slate-400">
                  <ScanFace className="mx-auto h-12 w-12" />
                  <p className="mt-2 text-sm">Bật camera để bắt đầu</p>
                </div>
              )}
              {registered && <div className="absolute right-3 top-3 rounded-full bg-success-500 p-1.5 text-white shadow"><CheckCircle2 className="h-4 w-4" /></div>}
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {!cameraOn && !snapshot && <Button onClick={startCamera} icon={<Camera className="h-4 w-4" />}>Bật camera</Button>}
              {cameraOn && !snapshot && <Button onClick={capture} icon={<Camera className="h-4 w-4" />}>Chụp ảnh</Button>}
              {snapshot && !registered && <Button onClick={register} icon={<CheckCircle2 className="h-4 w-4" />}>Xác nhận đăng ký</Button>}
              {snapshot && <Button variant="secondary" onClick={reset} icon={<RefreshCw className="h-4 w-4" />}>Chụp lại</Button>}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-3 text-sm text-slate-600">
            <h3 className="text-base font-semibold text-slate-800">Hướng dẫn</h3>
            <ol className="list-decimal space-y-2 pl-5">
              <li>Đặt khuôn mặt ngay ngang, nhìn thẳng vào camera.</li>
              <li>Đảm bảo ánh sáng đầy đủ, không đeo kính tối.</li>
              <li>Bấm <strong>Chụp ảnh</strong> để lưu khung hình.</li>
              <li>Nếu ưng ý, bấm <strong>Xác nhận đăng ký</strong>.</li>
            </ol>
            <p className="rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-700">Lưu ý: Đây là bản demo. Dữ liệu khuôn mặt chỉ lưu trình duyệt, không gửi đi đâu.</p>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}