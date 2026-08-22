// ============================================================================
// Face routes (§5.6 / §14.3) — đăng ký khuôn mặt + chấm công bằng khuôn mặt.
//  - /status    : đã đăng ký chưa
//  - /register  : lưu descriptor 128-d (face-api) + ảnh tham chiếu
//  - /attempt   : token phiên 1 lần (chống replay)
//  - /verify    : so khớp Euclidean < 0.6 + liveness thụ động → processPunch(source=Face)
// Chấm mặt là TỰ CHẤM: employeeId lấy từ JWT của người dùng hiện tại.
// ============================================================================
import { Router } from 'express'
import { requireAuth, type AuthedRequest } from '../middleware/auth.js'
import { httpError } from '../types.js'
import {
  getFaceData, upsertFaceData, createAttemptToken, consumeAttemptToken, getRegulation,
} from '../repo.js'
import { pushAudit } from '../helpers.js'
import { processPunch } from '../engines/attendance.js'

export const faceRouter = Router()

const MATCH_THRESHOLD = 0.6 // §5.6: Euclidean distance < 0.6
const DESCRIPTOR_DIM = 128

/** Khoảng cách Euclidean giữa 2 descriptor (number[] | Float32Array). */
function euclideanDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0
  for (let i = 0; i < DESCRIPTOR_DIM; i++) {
    const d = (a as any)[i] - (b as any)[i]
    sum += d * d
  }
  return Math.sqrt(sum)
}

/** Validate 1 descriptor: mảng đúng 128 phần tử số hữu hạn. */
function isValidDescriptor(d: any): boolean {
  if (!Array.isArray(d) || d.length !== DESCRIPTOR_DIM) return false
  for (let i = 0; i < DESCRIPTOR_DIM; i++) if (typeof d[i] !== 'number' || !Number.isFinite(d[i])) return false
  return true
}

/** Kiểm tra liveness theo mức strictness (§5.6). Trả về true nếu đạt. */
function livenessOk(strictness: number, l: any): boolean {
  const frames = Number(l?.frameCount ?? 0)
  const blink = !!l?.blinkDetected
  const variance = Number(l?.landmarkVariance ?? 0)
  if (strictness === 0) return frames >= 1                 // Lenient
  if (strictness === 1) return frames >= 3 && (blink || variance > 0.01) // Standard
  return frames >= 5 && blink && variance > 0.02            // Strict
}

/* ------------------------------- /status ---------------------------------- */
faceRouter.get('/status', requireAuth, (req: AuthedRequest, res) => {
  const fd = getFaceData(req.user!.employeeId)
  res.json({
    registered: !!fd,
    capturedCount: fd?.capturedCount ?? 0,
    registeredAt: fd?.registeredAt ?? null,
  })
})

/* ------------------------------ /register --------------------------------- */
faceRouter.post('/register', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const { descriptors, capturedCount, photoBase64 } = req.body ?? {}
    if (!Array.isArray(descriptors) || descriptors.length === 0)
      throw httpError(400, 'Thiếu descriptor khuôn mặt.')
    for (const d of descriptors) {
      if (!isValidDescriptor(d)) throw httpError(400, `Descriptor không hợp lệ (cần mảng ${DESCRIPTOR_DIM} số).`)
    }
    const count = Number(capturedCount ?? descriptors.length)
    upsertFaceData(req.user!.employeeId, JSON.stringify(descriptors), photoBase64 ?? null, count)
    pushAudit(req.user!.id, req.user!.email, 1, 'FaceRegister', null, `Đăng ký khuôn mặt (${count} mẫu)`)
    res.json({ ok: true, capturedCount: count })
  } catch (e) { next(e) }
})

/* ------------------------------- /attempt --------------------------------- */
faceRouter.get('/attempt', requireAuth, (req: AuthedRequest, res) => {
  const reg = getRegulation()
  const { token, expiresAt } = createAttemptToken(req.user!.id)
  res.json({
    token,
    expiresAt,
    requireLiveness: !!reg?.requireLivenessCheck,
    strictness: reg?.livenessStrictness ?? 1,
  })
})

/* ------------------------------- /verify ---------------------------------- */
faceRouter.post('/verify', requireAuth, (req: AuthedRequest, res, next) => {
  try {
    const { descriptor, liveness, token } = req.body ?? {}
    if (!token) throw httpError(400, 'Thiếu token phiên.')
    const consumed = consumeAttemptToken(token)
    if (!consumed) throw httpError(401, 'Token phiên không hợp lệ hoặc đã hết hạn.')

    const empId = req.user!.employeeId
    const fd = getFaceData(empId)
    if (!fd || !Array.isArray(fd.descriptors) || fd.descriptors.length === 0)
      throw httpError(400, 'Bạn chưa đăng ký khuôn mặt. Vui lòng đăng ký trước khi chấm công.')

    if (!isValidDescriptor(descriptor)) throw httpError(400, 'Descriptor không hợp lệ.')

    // So khớp: lấy khoảng cách nhỏ nhất tới các mẫu đã đăng ký.
    let minDist = Infinity
    for (const stored of fd.descriptors) {
      if (!isValidDescriptor(stored)) continue
      const dist = euclideanDistance(descriptor, stored)
      if (dist < minDist) minDist = dist
    }
    if (minDist >= MATCH_THRESHOLD)
      throw httpError(401, `Khuôn mặt không khớp (khoảng cách ${minDist.toFixed(3)} >= ${MATCH_THRESHOLD}).`)

    // Liveness (nếu regulation bật).
    const reg = getRegulation()
    if (reg?.requireLivenessCheck) {
      if (!liveness || !livenessOk(reg.livenessStrictness ?? 1, liveness))
        throw httpError(400, 'Liveness check thất bại - cần khuôn mặt thật (nháy mắt / di chuyển nhẹ).')
    }

    // Hợp lệ -> ghi lượt chấm công (source=1 Face).
    const snapshotBase64 = liveness?.snapshotBase64 ?? null
    const result = processPunch(empId, 1, { snapshotBase64, notes: 'Face' })
    pushAudit(req.user!.id, req.user!.email, 1, 'AttendancePunch', null, `Chấm công (Face) - ${result.message}`)
    res.json(result)
  } catch (e) { next(e) }
})