// ============================================================================
// Face routes (§5.6 / §14.3) — đăng ký khuôn mặt + chấm công bằng khuôn mặt.
//  - /status    : đã đăng ký chưa
//  - /register  : lưu descriptor 128-d (face-api) + ảnh tham chiếu
//  - /attempt   : token phiên 1 lần (chống replay)
//  - /verify    : so khớp Euclidean < 0.6 + liveness thụ động → processPunch(source=Face)
// Chấm mặt là TỰ CHẤM: employeeId lấy từ JWT của người dùng hiện tại.
// ============================================================================
import { Router } from 'express'
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js'
import { httpError } from '../types.js'
import { getClientIp } from '../lib/clientIp.js'
import {
  getFaceData, upsertFaceData, createAttemptToken, consumeAttemptToken, getRegulation,
} from '../repo.js'
import { pushAudit } from '../helpers.js'
import { processPunch } from '../engines/attendance.js'

export const faceRouter = Router()
const FACE_SELF_PERMISSION = 'face.manage.self'

// Ngưỡng khớp nới lỏng (0.6 → 0.7): cùng người đăng ký & chấm thường < 0.5, nhưng
// góc/ánh sáng khác làm khoảng cách tăng → 0.7 cho phép rộng hơn, "chỉ cần có khuôn mặt thật".
const MATCH_THRESHOLD = 0.7
const DESCRIPTOR_DIM = 128
const MAX_FACE_SAMPLES = 8
const MAX_FACE_IMAGE_CHARS = 3 * 1024 * 1024

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

/** Kiểm tra liveness theo mức strictness. Trả về true nếu đạt.
 *  Chính sách "chỉ cần có khuôn mặt": phát hiện mặt trong đủ số khung là đạt —
 *  blink/variance chỉ là gợi ý sống, KHÔNG bắt buộc (tránh fail oan khi đủ sáng nhưng
 *  nháy mắt không rõ). Trước đây Standard cần ≥3 khung nhưng client chỉ chụp 2 → fail 100%. */
function livenessOk(strictness: number, l: any): boolean {
  const frames = Number(l?.frameCount ?? 0)
  // Strict (2): cần ≥2 khung có mặt; Lenient(0)/Standard(1): chỉ cần ≥1 khung có mặt.
  const need = strictness >= 2 ? 2 : 1
  return frames >= need
}

/* ------------------------------- /status ---------------------------------- */
faceRouter.get('/status', requireAuth, requirePermission(FACE_SELF_PERMISSION), (req: AuthedRequest, res) => {
  const fd = getFaceData(req.user!.employeeId)
  res.json({
    registered: !!fd,
    capturedCount: fd?.capturedCount ?? 0,
    registeredAt: fd?.registeredAt ?? null,
  })
})

/* ------------------------------ /register --------------------------------- */
faceRouter.post('/register', requireAuth, requirePermission(FACE_SELF_PERMISSION), (req: AuthedRequest, res, next) => {
  try {
    const { descriptors, capturedCount, photoBase64 } = req.body ?? {}
    if (!Array.isArray(descriptors) || descriptors.length === 0)
      throw httpError(400, 'Thiếu descriptor khuôn mặt.')
    if (descriptors.length > MAX_FACE_SAMPLES) throw httpError(400, `Chỉ được đăng ký tối đa ${MAX_FACE_SAMPLES} mẫu khuôn mặt.`)
    if (photoBase64 != null && (typeof photoBase64 !== 'string' || photoBase64.length > MAX_FACE_IMAGE_CHARS))
      throw httpError(400, 'Ảnh khuôn mặt vượt quá giới hạn cho phép.')
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
faceRouter.get('/attempt', requireAuth, requirePermission(FACE_SELF_PERMISSION), (req: AuthedRequest, res) => {
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
faceRouter.post('/verify', requireAuth, requirePermission(FACE_SELF_PERMISSION), (req: AuthedRequest, res, next) => {
  try {
    const { descriptor, liveness, token, gps } = req.body ?? {}
    if (!token) throw httpError(400, 'Thiếu token phiên.')
    const consumed = consumeAttemptToken(token, req.user!.id)
    if (!consumed) throw httpError(401, 'Token phiên không hợp lệ hoặc đã hết hạn.')

    const empId = req.user!.employeeId
    const fd = getFaceData(empId)
    if (!fd || !Array.isArray(fd.descriptors) || fd.descriptors.length === 0)
      throw httpError(400, 'Bạn chưa đăng ký khuôn mặt. Vui lòng đăng ký trước khi chấm công.')

    if (!isValidDescriptor(descriptor)) throw httpError(400, 'Descriptor không hợp lệ.')
    if (liveness?.snapshotBase64 != null
      && (typeof liveness.snapshotBase64 !== 'string' || liveness.snapshotBase64.length > MAX_FACE_IMAGE_CHARS))
      throw httpError(400, 'Ảnh xác minh khuôn mặt vượt quá giới hạn cho phép.')

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

    // Hợp lệ -> ghi lượt chấm công (source=1 Face) + GPS + IP thiết bị người chấm.
    const snapshotBase64 = liveness?.snapshotBase64 ?? null
    const ipAddress = getClientIp(req)
    const result = processPunch(empId, 1, {
      latitude: gps?.lat, longitude: gps?.lng, accuracy: gps?.accuracy,
      ipAddress, snapshotBase64, notes: 'Face',
    })
    pushAudit(req.user!.id, req.user!.email, 1, 'AttendancePunch', null, `Chấm công (Face) - ${result.message}`)
    res.json(result)
  } catch (e) { next(e) }
})

