// ============================================================================
// HRM Chấm công — Express server entry point.
// ============================================================================
import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import { loadEnvFile } from './lib/env.js'
loadEnvFile()
import { initSchema, db } from './db.js'
import { HttpError } from './types.js'
import { seed } from './seed.js'
import { authRouter } from './routes/auth.js'
import { orgRouter } from './routes/org.js'
import { shiftsRouter } from './routes/shifts.js'
import { attendanceRouter } from './routes/attendance.js'
import { faceRouter } from './routes/face.js'
import { requestsRouter, approvalsRouter } from './routes/requests.js'
import { timesheetRouter, payrollRouter } from './routes/timesheet.js'
import { notificationsRouter } from './routes/notifications.js'
import { dashboardRouter } from './routes/dashboard.js'
import { configRouter } from './routes/config.js'
import { auditRouter } from './routes/audit.js'
import { delegationRouter } from './routes/delegation.js'
import { chatbotRouter } from './routes/chatbot.js'
import { ensureDefaultRolePermissions } from './services/permissionService.js'
import { runMigrations } from './services/migrationService.js'
import { isCorsOriginAllowed, resolveSecurityConfig } from './lib/securityConfig.js'
import { getPrimaryAttachmentStorage } from './services/attachmentStorageRuntime.js'
import { assertProductionReadiness } from './lib/productionReadiness.js'
import { startRetentionScheduler } from './services/retentionScheduler.js'

const app = express()
const PORT = Number(process.env.PORT) || 4000
assertProductionReadiness(process.env)
const securityConfig = resolveSecurityConfig(process.env)
getPrimaryAttachmentStorage()

app.set('trust proxy', securityConfig.trustProxy)
app.use(cors({
  exposedHeaders: ['Content-Disposition', 'X-Request-Verification-Code'],
  origin(origin, callback) {
    if (isCorsOriginAllowed(securityConfig, origin)) return callback(null, true)
    callback(new HttpError(403, 'Origin không được phép.'))
  },
}))
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '8mb' }))
app.use(morgan('dev'))

// Mount routes
app.use('/api/auth', authRouter)
app.use('/api/org', orgRouter)
app.use('/api/shifts', shiftsRouter)
app.use('/api/attendance', attendanceRouter)
app.use('/api/face', faceRouter)
app.use('/api/requests', requestsRouter)
app.use('/api/approvals', approvalsRouter)
app.use('/api/timesheet', timesheetRouter)
app.use('/api/payroll', payrollRouter)
app.use('/api/notifications', notificationsRouter)
app.use('/api/dashboard', dashboardRouter)
app.use('/api/config', configRouter)
app.use('/api/audit', auditRouter)
app.use('/api/delegation', delegationRouter)
app.use('/api/chatbot', chatbotRouter)

app.get('/api/health/live', (_req, res) => res.json({ ok: true }))
app.get('/api/health', (_req, res) => {
  try {
    db.prepare('SELECT 1').get()
    const migration = db.prepare('SELECT MAX(version) version FROM schema_migrations').get() as any
    res.json({ ok: true, database: 'ok', schemaVersion: Number(migration?.version ?? 0), ts: new Date().toISOString() })
  } catch {
    res.status(503).json({ ok: false, database: 'error', ts: new Date().toISOString() })
  }
})

// Error handler统一 — envelope { status, message, code?, fieldErrors? }
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ status: err.status, message: err.message, code: err.code, fieldErrors: err.fieldErrors })
  } else if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ status: 400, message: 'JSON không hợp lệ.' })
  } else if (err?.type === 'entity.too.large') {
    res.status(413).json({ status: 413, message: 'Nội dung yêu cầu vượt quá giới hạn cho phép.' })
  } else {
    console.error('[UNHANDLED]', err)
    res.status(500).json({ status: 500, message: err?.message ?? 'Lỗi máy chủ.' })
  }
})

initSchema()
runMigrations(db)
ensureDefaultRolePermissions()
// Seed tự động nếu DB trống (lần khởi động đầu). Trong production, chỉ seed khi
// HRM_ALLOW_INSECURE_PRODUCTION=true (demo) — tránh seed tài khoản demo vào DB production thật.
if ((db.prepare('SELECT COUNT(*) c FROM employees').get() as any).c === 0 && process.env.NODE_ENV === 'production' && process.env.HRM_ALLOW_INSECURE_PRODUCTION?.trim().toLowerCase() !== 'true') {
  throw new Error('Database production đang trống; từ chối tự động seed tài khoản demo. Set HRM_ALLOW_INSECURE_PRODUCTION=true nếu đây là deploy demo.')
}
if ((db.prepare('SELECT COUNT(*) c FROM employees').get() as any).c === 0) {
  console.log('  ℹ️  DB trống — tự động seed dữ liệu mẫu...')
  seed()
}
startRetentionScheduler(db, process.env)

app.listen(PORT, () => {
  console.log(`\n  ✅ HRM backend chạy tại http://localhost:${PORT}/api`)
  if (process.env.NODE_ENV !== 'production') console.log(`     Đăng nhập demo: admin@technova.vn / 123456\n`)
})
