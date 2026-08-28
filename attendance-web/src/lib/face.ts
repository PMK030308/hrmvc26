// ============================================================================
// Wrapper face-api (@vladmandic/face-api) — load model, detect descriptor,
// liveness thụ động (landmark variance + blink). Dùng cho đăng ký & chấm mặt.
// ============================================================================
import * as faceapi from '@vladmandic/face-api'

const MODEL_URL = '/models'
let loadPromise: Promise<void> | null = null

/** Load 3 model cần thiết (chạy 1 lần, cache promise). */
export function loadFaceModels(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ])
    })().catch((e) => { loadPromise = null; throw e })
  }
  return loadPromise
}

// Detector chuẩn (đăng ký + vẽ khung): inputSize 224, ngưỡng thấp để detect dễ hơn,
// mặt gần camera + đủ sáng là nhận được (giúp đăng ký mượt, không bị "không phát hiện khuôn mặt").
export const detectorOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 })
// Detector "nhanh" cho chấm công: dùng cùng inputSize 224 (không phải 160) để detect
// đáng tin như khung vẽ — tránh "thấy khung nhưng chấm báo không phát hiện mặt".
export const detectorOptionsFast = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.3 })

export interface DetectedFace {
  descriptor: Float32Array
  box: { x: number; y: number; width: number; height: number }
  landmarks: faceapi.FaceLandmarks68
}

/** Detect 1 khuôn mặt + descriptor. Trả null nếu không thấy. */
export async function detectFace(input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement): Promise<DetectedFace | null> {
  const res = await faceapi
    .detectSingleFace(input, detectorOptions)
    .withFaceLandmarks()
    .withFaceDescriptor()
  if (!res) return null
  return {
    descriptor: res.descriptor,
    box: {
      x: res.detection.box.x, y: res.detection.box.y,
      width: res.detection.box.width, height: res.detection.box.height,
    },
    landmarks: res.landmarks,
  }
}

/** Detect nhanh (inputSize 160) — cho luồng chấm công cần tốc độ. */
export async function detectFaceFast(input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement): Promise<DetectedFace | null> {
  const res = await faceapi
    .detectSingleFace(input, detectorOptionsFast)
    .withFaceLandmarks()
    .withFaceDescriptor()
  if (!res) return null
  return {
    descriptor: res.descriptor,
    box: {
      x: res.detection.box.x, y: res.detection.box.y,
      width: res.detection.box.width, height: res.detection.box.height,
    },
    landmarks: res.landmarks,
  }
}

/** Eye Aspect Ratio từ 6 điểm mắt (p1..p6). */
function ear(eye: faceapi.Point[]): number {
  // p1=góc trong, p4=góc ngoài, p2/p3=mi mắt trên, p5/p6=mi mắt dưới
  const dist = (a: faceapi.Point, b: faceapi.Point) => Math.hypot(a.x - b.x, a.y - b.y)
  const vertical = (dist(eye[1]!, eye[5]!) + dist(eye[2]!, eye[4]!)) / 2
  const horizontal = dist(eye[0]!, eye[3]!)
  if (horizontal === 0) return 0
  return vertical / horizontal
}

const BLINK_THRESHOLD = 0.2

export interface LivenessResult {
  landmarkVariance: number
  blinkDetected: boolean
  frameCount: number
  snapshotBase64: string | null
}

/**
 * Liveness thụ động: lấy `frames` khung cách nhau ~`frameIntervalMs`ms, đo:
 *  - landmarkVariance: tổng dịch chuyển mũi (điểm 30) giữa các khung (chống ảnh tĩnh).
 *  - blinkDetected: EAR dip dưới ngưỡng rồi hồi → nháy mắt.
 * Trả snapshotBase64 của khung cuối (cho HR rà soát).
 * `detect` mặc định = detectFace; luồng nhanh có thể truyền detectFaceFast.
 */
export async function computeLiveness(
  video: HTMLVideoElement,
  opts: { frames: number; strictness: number; frameIntervalMs?: number; detect?: (input: HTMLVideoElement) => Promise<DetectedFace | null> },
): Promise<LivenessResult> {
  const detect = opts.detect ?? detectFace
  const interval = opts.frameIntervalMs ?? 90 // mặc định 90ms (nhanh hơn 180ms cũ)
  const frameCount = 0
  let prevNose: faceapi.Point | null = null
  let varianceSum = 0
  let blinkDetected = false
  let lastSnap: string | null = null
  let counted = 0

  for (let i = 0; i < opts.frames; i++) {
    const det = await detect(video)
    if (det) {
      counted++
      const nose = det.landmarks.positions[30]! // đầu mũi (68-point)
      if (prevNose) varianceSum += Math.hypot(nose.x - prevNose.x, nose.y - prevNose.y)
      prevNose = nose
      // EAR trung bình 2 mắt
      const leftEye = det.landmarks.getLeftEye()
      const rightEye = det.landmarks.getRightEye()
      const avgEar = (ear(leftEye) + ear(rightEye)) / 2
      if (avgEar < BLINK_THRESHOLD) blinkDetected = true
    }
    // snapshot khung cuối
    if (i === opts.frames - 1) {
      try {
        const c = document.createElement('canvas')
        c.width = 320; c.height = 240
        c.getContext('2d')!.drawImage(video, 0, 0, 320, 240)
        lastSnap = c.toDataURL('image/jpeg', 0.7)
      } catch { lastSnap = null }
    }
    if (i < opts.frames - 1) await sleep(interval)
  }

  return {
    landmarkVariance: Math.round(varianceSum * 1000) / 1000,
    blinkDetected,
    frameCount: counted,
    snapshotBase64: lastSnap,
  }
  void frameCount
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)) }

export { faceapi }