import { useEffect, useRef, useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ScanFace, Camera, Fingerprint, CheckCircle2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Link } from 'react-router-dom'
import { faceApi } from '@/api/face'
import { loadFaceModels, detectFace, detectFaceFast, computeLiveness } from '@/lib/face'
import type { FaceAttempt, LivenessPayload, PunchResponse } from '@/types'
import { Card, CardBody, PageHeader, Button, Spinner, Badge } from '@/components/ui'
import { fmtTime } from '@/lib/date'

export default function FacePunchPage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cameraOn, setCameraOn] = useState(false)
  const [modelsReady, setModelsReady] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState<FaceAttempt | null>(null)
  const [gpsState, setGpsState] = useState<'idle' | 'ok' | 'off'>('idle')
  const qc = useQueryClient()

  const status = useQuery({ queryKey: ['face', 'status'], queryFn: () => faceApi.status() })

  const ensureModels = useCallback(async () => {
    if (modelsReady) return true
    setModelError(null)
    try { await loadFaceModels(); setModelsReady(true); return true }
    catch { setModelError('Không tải được model. Hãy chạy "npm run face-models".'); return false }
  }, [modelsReady])

  const startCamera = useCallback(async () => {
    setModelError(null)
    const ok = await ensureModels()
    if (!ok) return
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      streamRef.current = s
      setCameraOn(true)
      setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play() } }, 50)
    } catch { setModelError('Không truy cập được camera (cần quyền camera + HTTPS/localhost).') }
  }, [ensureModels])

  // Detect loop vẽ khung
  useEffect(() => {
    if (!cameraOn || !modelsReady) return
    let raf = 0, stop = false
    const loop = async () => {
      if (stop) return
      const v = videoRef.current, ov = overlayRef.current
      if (v && ov && v.videoWidth) {
        ov.width = v.videoWidth; ov.height = v.videoHeight
        const det = await detectFace(v)
        const ctx = ov.getContext('2d')!
        ctx.clearRect(0, 0, ov.width, ov.height)
        if (det) { const { x, y, width, height } = det.box; ctx.strokeStyle = '#3366ff'; ctx.lineWidth = 3; ctx.strokeRect(x, y, width, height) }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { stop = true; cancelAnimationFrame(raf) }
  }, [cameraOn, modelsReady])

  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()) }, [])

  // Xin vị trí GPS (warn-only: không chặn nếu từ chối/out-of-office — NV có thể đang công tác).
  function getPosition(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) { setGpsState('off'); resolve(null); return }
      navigator.geolocation.getCurrentPosition(
        (pos) => { setGpsState('ok'); resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }) },
        () => { setGpsState('off'); resolve(null) },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 60_000 },
      )
    })
  }

  // Xin token (1 lần) rồi verify ngay — tránh stale closure của `attempt`.
  async function doPunchFixed() {
    setBusy(true)
    try {
      const v = videoRef.current
      if (!v) { toast.error('Camera chưa sẵn sàng.'); return }
      const a = await faceApi.attempt()
      setAttempt(a)
      const det = await detectFaceFast(v)
      if (!det) { toast.error('Không phát hiện khuôn mặt. Đặt mặt thẳng vào khung.'); return }
      let liveness: LivenessPayload = { landmarkVariance: 0, blinkDetected: false, frameCount: 1, snapshotBase64: null }
      if (a.requireLiveness) {
        // Liveness NHANH: strictness 2→4 frame, 1→2 frame, 0→1 frame; interval 90ms.
        const frames = a.strictness === 2 ? 4 : a.strictness === 1 ? 2 : 1
        toast.info(`Đang kiểm tra liveness (${frames} khung)...`)
        liveness = await computeLiveness(v, { frames, strictness: a.strictness, frameIntervalMs: 90, detect: detectFaceFast })
      } else {
        const c = document.createElement('canvas'); c.width = 320; c.height = 240
        c.getContext('2d')!.drawImage(v, 0, 0, 320, 240)
        liveness.snapshotBase64 = c.toDataURL('image/jpeg', 0.7)
      }
      const gps = await getPosition()
      const res = await faceApi.verify({ descriptor: Array.from(det.descriptor), liveness, token: a.token, gps })
      if (res.success) toast.success(res.message); else toast.warning(res.message)
      qc.invalidateQueries({ queryKey: ['attendance', 'today'] })
      qc.invalidateQueries({ queryKey: ['employee', 'dashboard'] })
      setPunchResult(res)
      setAttempt(null)
    } catch (e: any) {
      toast.error(e?.message ?? 'Chấm công thất bại.')
      setAttempt(null)
    } finally { setBusy(false) }
  }

  const [punchResult, setPunchResult] = useState<PunchResponse | null>(null)

  return (
    <div>
      <PageHeader title="Chấm công bằng khuôn mặt" subtitle="Nhận diện khuôn mặt + liveness → chấm công tự động" />
      {status.isLoading && <Card className="p-5"><Spinner /></Card>}
      {status.data && !status.data.registered && (
        <Card className="mb-4 border-warning-200 bg-warning-50">
          <CardBody className="flex flex-wrap items-center justify-between gap-3 text-sm text-warning-800">
            <span>Bạn chưa đăng ký khuôn mặt — không thể chấm bằng khuôn mặt.</span>
            <Link to="/employee/face-register" className="inline-flex items-center gap-2 rounded-lg bg-warning-600 px-4 py-2 text-sm font-semibold text-white hover:bg-warning-700"><UserPlus className="h-4 w-4" /> Đăng ký ngay</Link>
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
                <div className="text-center text-slate-400"><ScanFace className="mx-auto h-12 w-12" /><p className="mt-2 text-sm">Bật camera để chấm công</p></div>
              )}
            </div>
            {modelError && <p className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-xs text-danger-700">{modelError}</p>}
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {!cameraOn && <Button onClick={startCamera} icon={<Camera className="h-4 w-4" />}>Bật camera</Button>}
              {cameraOn && !busy && <Button onClick={doPunchFixed} icon={<Fingerprint className="h-4 w-4" />}>Chấm công</Button>}
              {busy && <Button loading>Đang nhận diện...</Button>}
            </div>
            <p className="mt-2 text-center text-xs text-slate-500">
              {gpsState === 'ok' ? '📍 Đã ghi GPS vị trí chấm công' : gpsState === 'off' ? '📍 GPS tắt — chấm vẫn hợp lệ (có thể đang công tác)' : '📍 Sẽ xin GPS khi bấm chấm công'}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-4 text-sm">
            <h3 className="text-base font-semibold text-slate-800">Trạng thái chấm công</h3>
            {punchResult ? (
              <div className="space-y-3 rounded-xl bg-success-50 p-4">
                <div className="flex items-center gap-2 text-success-700"><CheckCircle2 className="h-5 w-5" /><span className="font-semibold">{punchResult.message}</span></div>
                <div className="grid grid-cols-2 gap-3 text-slate-700">
                  <Field label="Giờ vào" value={punchResult.checkIn ?? '—'} />
                  <Field label="Giờ ra" value={punchResult.checkOut ?? '—'} />
                  <Field label="Tổng lượt" value={`${punchResult.totalPunches}`} />
                  <Field label="Tổng giờ" value={`${punchResult.totalWorkHours}h`} />
                </div>
                <p className="text-xs text-success-600">Thời điểm: {fmtTime(new Date())}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-8 text-slate-400">
                {busy ? <Spinner className="h-8 w-8" /> : <Fingerprint className="h-10 w-10" />}
                <p className="text-sm">Đặt khuôn mặt vào khung rồi bấm "Chấm công".</p>
              </div>
            )}
            {attempt && <div className="flex items-center gap-2 text-xs text-slate-500"><Badge tone="brand">Phiên</Badge> token đã cấp (1 lần). Liveness: {attempt.requireLiveness ? <Badge tone="success" dot>{attempt.strictness === 0 ? 'Lenient' : attempt.strictness === 1 ? 'Standard' : 'Strict'}</Badge> : 'tắt'}</div>}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-slate-500">{label}</p><p className="font-mono text-sm font-semibold text-slate-800">{value}</p></div>
}