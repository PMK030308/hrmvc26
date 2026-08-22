// Copy model weights của @vladmandic/face-api từ node_modules vào public/models
// để face-api.js load qua loadFromUri('/models'). Chạy 1 lần sau khi npm install:
//   npm run face-models
// Dùng copyFileSync từng file (cpSync recursive bị crash trên path chứa ký tự tiếng Việt với node 22).
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const cwd = process.cwd()
const src = resolve(cwd, 'node_modules/@vladmandic/face-api/model')
const dest = resolve(cwd, 'public/models')

if (!existsSync(src)) {
  console.error(`\u274C Kh\u00F4ng t\u00ECm th\u1EA5y th\u01B0 m\u1EE5c model t\u1EA1i:\n   ${src}\n   H\u00E3y ch\u1EA1y 'npm install' tr\u01B0\u1EDBc (g\u00F3i @vladmandic/face-api ship model trong node_modules).`)
  process.exit(1)
}

mkdirSync(dest, { recursive: true })
const files = readdirSync(src).filter((f) => f.endsWith('.bin') || f.endsWith('.json'))
for (const f of files) copyFileSync(resolve(src, f), resolve(dest, f))
console.log(`\u2705 \u0110\u00E3 copy ${files.length} file model v\u00E0o public/models/:`)
files.forEach((f) => console.log(`   - ${f}`))