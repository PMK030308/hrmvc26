// Đợi backend (Express, port 4000) sẵn sàng trước khi chạy Vite FE.
// Mục đích: loại bỏ "startup race" — FE không bao giờ sẵn sàng trước BE,
// tránh các request /api đầu tiên bị 502/Network Error khi BE (tsx) còn đang compile.
import http from 'node:http'

const PORT = Number(process.env.BE_PORT) || 4000
const url = `http://localhost:${PORT}/api/health`
const startedAt = Date.now()
const TIMEOUT_MS = 60000 // chờ tối đa 60s; nếu BE vẫn chưa lên thì vẫn cho FE chạy (kèm cảnh báo)

function check() {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1500, () => { req.destroy(); resolve(false) })
  })
}

;(async () => {
  process.stdout.write(`[wait-for-be] đang đợi backend tại ${url} ...\n`)
  while (Date.now() - startedAt < TIMEOUT_MS) {
    if (await check()) {
      const sec = ((Date.now() - startedAt) / 1000).toFixed(1)
      process.stdout.write(`[wait-for-be] ✅ backend sẵn sàng (sau ${sec}s) — khởi động FE...\n`)
      process.exit(0)
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  process.stderr.write(`[wait-for-be] ⚠ backend chưa sẵn sàng sau ${TIMEOUT_MS / 1000}s — FE vẫn khởi động (hãy kiểm tra terminal [BE]).\n`)
  process.exit(0) // không chặn FE
})()