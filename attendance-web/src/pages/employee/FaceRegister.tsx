import { useEffect, useRef, useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ScanFace, Camera, CheckCircle2, RefreshCw, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { faceApi } from '@/api/face'
import { loadFaceModels, detectFace } from '@/lib/face'
import { Card, CardBody, PageHeader, Button, Spinner, Badge } from '@/components/ui'

const REQUIRED_SAMPLES = 3

export default function FaceRegisterPage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cameraOn, setCameraOn] = useState(false)
  const [modelsReady, setModelsReady] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [captured, setCaptured] = useState<Float32Array[]>([])
  const [lastSnap, setLastSnap] = useState<string | null>(null)
  const qc = useQueryClient()

  const status = useQuery({ queryKey: ['face', 'status'], queryFn: () => faceApi.status() })

  // Tải model khi mở camera
  const ensureModels = useCallback(async () => {
    if (modelsReady) return true
    setModelError(null)
    try {
      await loadFaceModels()
      setModelsReady(true)
      return true
    } catch (e: any) {
      setModelError('Không tải được model nhận diện. Hãy chạy "npm run face-models" và đảm bảo /models có đủ file.')
      console.error(e)
      return false
    }
  }, [modelsReady])

  const startCamera = useCallback(async () => {
    setModelError(null)
    const ok = await ensureModels()
    if (!ok) return
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      streamRef.current = s
      setCameraOn(true)
      setTimeout(() => {
        if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play() }
      }, 50)
    } catch {
      setModelError('Không truy cập được camera. Cho phép quyền camera trong trình duyệt (cần HTTPS hoặc localhost).')
    }
  }, [ensureModels])

  // Vòng lặp detect để vẽ bounding box (feedback trực quan)
  useEffect(() => {
    if (!cameraOn || !modelsReady) return
    let raf = 0
    let stop = false
    const loop = async () => {
      if (stop) return
      const v = videoRef.current, ov = overlayRef.current
      if (v && ov && v.videoWidth) {
        ov.width = v.videoWidth; ov.height = v.videoHeight
        const det = await detectFace(v)
        const ctx = ov.getContext('2d')!
        ctx.clearRect(0, 0, ov.width, ov.height)
        if (det) {
          const { x, y, width, height } = det.box
          ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 3; ctx.strokeRect(x, y, width, height)
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { stop = true; cancelAnimationFrame(raf) }
  }, [cameraOn, modelsReady])

  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()) }, [])

  async function captureSample() {
    if (!videoRef.current) return
    setBusy(true)
    try {
      const det = await detectFace(videoRef.current)
      if (!det) { toast.error('Không phát hiện khuôn mặt. Đặt mặt thẳng vào khung.'); return }
      setCaptured((prev) => [...prev, det.descriptor])
      // snapshot tham chiếu
      const c = document.createElement('canvas')
      c.width = 320; c.height = 240
      c.getContext('2d')!.drawImage(videoRef.current, 0, 0, 320, 240)
      setLastSnap(c.toDataURL('image/jpeg', 0.7))
      toast.success(`Đã chụp mẫu ${captured.length + 1}/${REQUIRED_SAMPLES}`)
    } catch (e: any) {
      toast.error('Lỗi nhận diện: ' + (e?.message ?? e))
    } finally { setBusy(false) }
  }

  async function submitRegister() {
    if (captured.length === 0) return
    setBusy(true)
    try {
      const descriptors = captured.map((d) => Array.from(d))
      await faceApi.register({ descriptors, capturedCount: captured.length, photoBase64: lastSnap })
      toast.success('Đăng ký khuôn mặt thành công!')
      qc.invalidateQueries({ queryKey: ['face', 'status'] })
      setCaptured([])
    } catch (e: any) {
      toast.error(e?.message ?? 'Đăng ký thất bại.')
    } finally { setBusy(false) }
  }

  function reset() { setCaptured([]); setLastSnap(null) }

  const isRegistered = !!status.data?.registered

  return (
    <div>
      <PageHeader title="Đăng ký khuôn mặt" subtitle="Chụp mẫu khuôn mặt để dùng cho chấm công nhận diện" />
      {isRegistered && (
        <Card className="mb-4 border-success-200 bg-success-50">
          <CardBody className="flex items-center gap-2 text-sm text-success-700">
            <CheckCircle2 className="h-5 w-5" /> Đã đăng ký {status.data?.capturedCount} mẫu (cập nhật lúc {status.data?.registeredAt?.slice(11, 19)}).
            Bạn có thể chấm công tại <span className="font-semibold">Chấm công khuôn mặt</span>.
          </CardBody>
        </Card>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardBody>
            <div className="relative mx-auto grid aspect-[4/3] w-full max-w-md place-items-center overflow-hidden rounded-2xl bg-slate-900">
              {cameraOn ? (
                <>
                  <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
                  <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
                </>
              ) : (
                <div className="text-center text-slate-400"><ScanFace className="mx-auto h-12 w-12" /><p className="mt-2 text-sm">Bật camera để bắt đầu</p></div>
              )}
            </div>
            {modelError && <p className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-xs text-danger-700">{modelError}</p>}
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {!cameraOn && <Button onClick={startCamera} icon={<Camera className="h-4 w-4" />}>Bật camera</Button>}
              {cameraOn && !busy && <Button onClick={captureSample} icon={<Camera className="h-4 w-4" />}>Chụp mẫu ({captured.length}/{REQUIRED_SAMPLES})</Button>}
              {busy && <Button loading>Đang xử lý...</Button>}
              {captured.length > 0 && <Button variant="secondary" onClick={reset} icon={<RefreshCw className="h-4 w-4" />}>Chụp lại</Button>}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-4 text-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-800">Tiến độ</h3>
              <Badge tone={captured.length >= REQUIRED_SAMPLES ? 'success' : 'muted'} dot>{captured.length}/{REQUIRED_SAMPLES} mẫu</Badge>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: REQUIRED_SAMPLES }).map((_, i) => (
                <div key={i} className="grid aspect-square place-items-center rounded-lg border" style={{ borderColor: i < captured.length ? '#22c55e' : '#e2e8f0', background: i < captured.length ? '#f0fdf4' : '#f8fafc' }}>
                  {i < captured.length ? <CheckCircle2 className="h-6 w-6 text-success-600" /> : <span className="text-xs text-slate-400">{i + 1}</span>}
                </div>
              ))}
            </div>
            {lastSnap && <img src={lastSnap} alt="snapshot" className="mx-auto h-24 rounded-lg border object-cover" />}
            <Button className="w-full" disabled={captured.length === 0 || busy} onClick={submitRegister} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}>
              Hoàn tất đăng ký
            </Button>
            <ol className="list-decimal space-y-2 pl-5 text-xs text-slate-500">
              <li>Đặt khuôn mặt ngay ngang, nhìn thẳng, đủ sáng.</li>
              <li>Bấm <strong>Chụp mẫu</strong> {REQUIRED_SAMPLES} lần (đổi góc nhẹ giữa các lần).</li>
              <li>Nhấn <strong>Hoàn tất đăng ký</strong> để lưu.</li>
            </ol>
            {modelsReady && <p className="text-xs text-slate-400">Models: <Badge tone="success" dot>loaded</Badge></p>}
          </CardBody>
        </Card>
      </div>
      {!modelsReady && <Spinner className="mt-4" />}
    </div>
  )
}