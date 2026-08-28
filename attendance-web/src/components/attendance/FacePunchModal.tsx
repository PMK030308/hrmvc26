// ============================================================================
// FacePunchModal — quét khuôn mặt để chấm công (VÀO/RA) ngay trên trang Home.
// Mở camera → load model → detect nhanh → TỰ chấm khi nhận diện ổn định (quét nhanh).
// Chấm mặt là chấm thật: phải so khớp descriptor qua /api/face/verify (chống chấm hộ).
// ============================================================================
import { useEffect, useRef, useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ScanFace, UserPlus, CheckCircle2, Fingerprint, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Link } from 'react-router-dom'
import { faceApi } from '@/api/face'
import { loadFaceModels, detectFaceFast, computeLiveness } from '@/lib/face'
import type { FaceAttempt, LivenessPayload, PunchResponse } from '@/types'
import { Modal, Button, Spinner, Badge } from '@/components/ui'

const AUTO_FRAMES = 3 // số khung liên tiếp phát hiện mặt → tự chấm (quét nhanh)

export function FacePunchModal({
  open, onClose, nextAction, onDone,
}: {
  open: boolean
  onClose: () => void
  nextAction: 'check_in' | 'check_out' | 'completed'
  onDone?: (res?: PunchResponse) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const streakRef = useRef(0)
  const verifyingRef = useRef(false)
  const doneRef = useRef(false)
  const [modelsReady, setModelsReady] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [cameraOn, setCameraOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'verifying' | 'done'>('idle')
  const [result, setResult] = useState<PunchResponse | null>(null)
  const qc = useQueryClient()

  const status = useQuery({ queryKey: ['face', 'status'], queryFn: () => faceApi.status(), enabled: open })
  const registered = status.data?.registered ?? false

  const ensureModels = useCallback(async () => {
    setModelError(null)
    try { await loadFaceModels(); setModelsReady(true); return true }
    catch { setModelError('Không tải được model. Hãy chạy "npm run face-models" và đảm bảo /models có đủ file.'); return false }
  }, [])

  // Mở camera khi modal mở; dừng khi đóng.
  useEffect(() => {
    if (!open) return
    let active = true
    doneRef.current = false; verifyingRef.current = false; streakRef.current = 0
    setPhase('idle'); setResult(null)
    ;(async () => {
      const ok = await ensureModels()
      if (!ok || !active) return
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 480, height: 360 } })
        if (!active) { s.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = s; setCameraOn(true); setPhase('scanning')
        setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play() } }, 50)
      } catch { setModelError('Không truy cập được camera (cần quyền camera + HTTPS/localhost).') }
    })()
    return () => { active = false; streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; setCameraOn(false) }
  }, [open, ensureModels])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['attendance', 'today'] })
    qc.invalidateQueries({ queryKey: ['employee', 'dashboard'] })
    qc.invalidateQueries({ queryKey: ['attendance', 'detail'] })
  }

  const runVerify = useCallback(async () => {
    const v = videoRef.current
    if (!v || verifyingRef.current || doneRef.current) return
    verifyingRef.current = true
    setBusy(true); setPhase('verifying')
    try {
      const a: FaceAttempt = await faceApi.attempt()
      const det = await detectFaceFast(v)
      if (!det) { toast.error('Không thấy khuôn mặt. Đặt mặt thẳng vào khung.'); streakRef.current = 0; return }
      let liveness: LivenessPayload = { landmarkVariance: 0, blinkDetected: false, frameCount: 1, snapshotBase64: null }
      if (a.requireLiveness) {
        // Liveness NHANH: strictness 2→4 frame, 1→2 frame, 0→1 frame; interval 90ms.
        const frames = a.strictness === 2 ? 4 : a.strictness === 1 ? 2 : 1
        liveness = await computeLiveness(v, { frames, strictness: a.strictness, frameIntervalMs: 90, detect: detectFaceFast })
      } else {
        const c = document.createElement('canvas'); c.width = 320; c.height = 240
        c.getContext('2d')!.drawImage(v, 0, 0, 320, 240)
        liveness.snapshotBase64 = c.toDataURL('image/jpeg', 0.7)
      }
      const res = await faceApi.verify({ descriptor: Array.from(det.descriptor), liveness, token: a.token })
      if (res.success) {
        toast.success(res.message)
        setResult(res); setPhase('done'); doneRef.current = true
        invalidate(); onDone?.(res)
      } else { toast.warning(res.message); streakRef.current = 0 }
    } catch (e: any) {
      toast.error(e?.message ?? 'Chấm công thất bại.'); streakRef.current = 0
    } finally {
      verifyingRef.current = false; setBusy(false)
      setPhase((p) => (p === 'done' ? 'done' : 'scanning'))
    }
  }, [invalidate, onDone])
  // Detect loop + tự chấm khi nhận diện ổn định (streak >= AUTO_FRAMES)
  useEffect(() => {
    if (!cameraOn || !modelsReady) return
    let raf = 0, stop = false
    const loop = async () => {
      if (stop) return
      const v = videoRef.current, ov = overlayRef.current
      if (v && ov && v.videoWidth) {
        ov.width = v.videoWidth; ov.height = v.videoHeight
        const det = await detectFaceFast(v)
        const ctx = ov.getContext('2d')!
        ctx.clearRect(0, 0, ov.width, ov.height)
        if (det) {
          const { x, y, width, height } = det.box
          ctx.strokeStyle = phase === 'done' ? '#22c55e' : verifyingRef.current ? '#f59e0b' : '#3366ff'
          ctx.lineWidth = 3; ctx.strokeRect(x, y, width, height)
          if (phase === 'scanning' && !verifyingRef.current && !doneRef.current) {
            streakRef.current++
            if (streakRef.current >= AUTO_FRAMES) runVerify()
          }
        } else { streakRef.current = 0 }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { stop = true; cancelAnimationFrame(raf) }
  }, [cameraOn, modelsReady, phase, runVerify])

  const actionLabel = nextAction === 'check_in' ? 'Chấm VÀO' : nextAction === 'check_out' ? 'Chấm RA' : 'Hoàn tất'
  return (
    <Modal open={open} onClose={onClose} title={<span className="flex items-center gap-2"><ScanFace className="h-5 w-5 text-brand-600" /> Chấm công bằng khuôn mặt</span>} size="md">
      {!registered && status.isSuccess ? (
        <div className="rounded-xl bg-warning-50 px-4 py-6 text-center">
          <UserPlus className="mx-auto h-10 w-10 text-warning-600" />
          <p className="mt-2 text-sm font-medium text-warning-800">Bạn chưa đăng ký khuôn mặt.</p>
          <p className="text-xs text-warning-700">Vui lòng đăng ký trước khi chấm công.</p>
          <Link to="/employee/face-register" onClick={onClose} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-warning-600 px-4 py-2 text-sm font-semibold text-white hover:bg-warning-700">
            <UserPlus className="h-4 w-4" /> Đăng ký ngay
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative mx-auto grid aspect-[4/3] w-full max-w-sm place-items-center overflow-hidden rounded-2xl bg-slate-900">
            {cameraOn ? (
              <>
                <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
                <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
                <div className="absolute left-2 top-2">
                  {phase === 'scanning' && <Badge tone="brand" dot>Đang quét...</Badge>}
                  {phase === 'verifying' && <Badge tone="warning" dot>Đang nhận diện</Badge>}
                  {phase === 'done' && <Badge tone="success" dot>Thành công</Badge>}
                </div>
              </>
            ) : (
              <div className="text-center text-slate-400">
                {modelError ? <p className="px-6 text-sm text-danger-300">{modelError}</p>
                  : <><ScanFace className="mx-auto h-12 w-12 animate-pulse" /><p className="mt-2 text-sm">Đang bật camera...</p></>}
              </div>
            )}
          </div>
          {modelError && <p className="rounded-lg bg-danger-50 px-3 py-2 text-xs text-danger-700">{modelError}</p>}
          {result ? (
            <div className="rounded-xl bg-success-50 p-4 text-sm">
              <div className="flex items-center gap-2 text-success-700"><CheckCircle2 className="h-5 w-5" /><span className="font-semibold">{result.message}</span></div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-slate-700">
                <div><p className="text-xs text-slate-500">Giờ vào</p><p className="font-mono font-semibold">{result.checkIn ?? '—'}</p></div>
                <div><p className="text-xs text-slate-500">Giờ ra</p><p className="font-mono font-semibold">{result.checkOut ?? '—'}</p></div>
              </div>
            </div>
          ) : (
            <p className="text-center text-xs text-slate-500">
              {busy ? <span className="inline-flex items-center gap-1.5"><Loader2 className="h-4 w-4 animate-spin" /> Đang nhận diện khuôn mặt...</span>
                : <>Đặt khuôn mặt vào khung — hệ thống tự chấm {actionLabel.toLowerCase()} khi nhận diện.</>}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={onClose}>{result ? 'Đóng' : 'Hủy'}</Button>
            {!result && <Button onClick={runVerify} loading={busy} icon={<Fingerprint className="h-4 w-4" />} disabled={!cameraOn}>Chấm ngay</Button>}
          </div>
        </div>
      )}
      {!modelsReady && !modelError && <div className="mt-3 flex justify-center"><Spinner /></div>}
    </Modal>
  )
}