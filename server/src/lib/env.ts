// ============================================================================
// Loader .env tối giản — không cần dependency dotenv.
// Đọc server/.env (hoặc .env ở thư mục cha / cwd) và nạp vào process.env
// CHỈ khi key chưa được set (env thật trên Render/CI luôn thắng).
// ============================================================================
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export function loadEnvFile(): void {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [join(here, '..', '..', '.env'), join(here, '..', '.env'), join(process.cwd(), '.env')]
  for (const path of candidates) {
    if (!existsSync(path)) continue
    const text = readFileSync(path, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!m) continue
      const [, k, raw] = m
      if (process.env[k] === undefined) {
        const v = raw.replace(/^['"]|['"]$/g, '').trim()
        process.env[k] = v
      }
    }
    return
  }
}