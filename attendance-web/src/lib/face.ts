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

export const detectorOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 })

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
 * Liveness thụ động: lấy `frames` khung cách nhau ~180ms, đo:
 *  - landmarkVariance: tổng dịch chuyển mũi (điểm 30) giữa các khung (chống ảnh tĩnh).
 *  - blinkDetected: EAR dip dưới ngưỡng rồi hồi → nháy mắt.
 * Trả snapshotBase64 của khung cuối (cho HR rà soát).
 */
export async function computeLiveness(
  video: HTMLVideoElement,
  opts: { frames: number; strictness: number },
): Promise<LivenessResult> {
  const frameCount = 0
  let prevNose: faceapi.Point | null = null
  let varianceSum = 0
  let blinkDetected = false
  let lastSnap: string | null = null
  let counted = 0

  for (let i = 0; i < opts.frames; i++) {
    const det = await detectFace(video)
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
    if (i < opts.frames - 1) await sleep(180)
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