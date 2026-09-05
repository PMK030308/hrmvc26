import { accessSync, constants, mkdirSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

export interface AttachmentStorageConfig {
  provider: 'local'
  localRoot: string
}

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function resolveAttachmentStorageConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  serverRoot = process.cwd(),
): AttachmentStorageConfig {
  const provider = (env.ATTACHMENT_STORAGE_PROVIDER?.trim().toLowerCase() || 'local')
  if (provider !== 'local') throw new Error(`Attachment storage provider không được hỗ trợ: ${provider}.`)

  const production = env.NODE_ENV === 'production'
  const lenient = env.HRM_ALLOW_INSECURE_PRODUCTION?.trim().toLowerCase() === 'true'
  const configuredRoot = env.ATTACHMENT_STORAGE_ROOT?.trim()
  if (configuredRoot && !isAbsolute(configuredRoot)) throw new Error('ATTACHMENT_STORAGE_ROOT phải là đường dẫn tuyệt đối.')
  if (production && !lenient && !configuredRoot) throw new Error('ATTACHMENT_STORAGE_ROOT phải được cấu hình trong production.')
  if (production && lenient && !configuredRoot) console.warn('[SECURITY] Cảnh báo: ATTACHMENT_STORAGE_ROOT chưa cấu hình — dùng default ephemeral. File đính kèm sẽ MẤT khi redeploy.')
  if (production && !lenient && !enabled(env.ATTACHMENT_STORAGE_PERSISTENT_VOLUME)) {
    throw new Error('Production local attachment storage cần persistent volume đáng tin cậy.')
  }
  if (production && lenient && !enabled(env.ATTACHMENT_STORAGE_PERSISTENT_VOLUME)) console.warn('[SECURITY] Cảnh báo: ATTACHMENT_STORAGE_PERSISTENT_VOLUME chưa true (ephemeral).')
  if (production && !lenient && !enabled(env.ATTACHMENT_STORAGE_BACKUP_CONFIRMED)) {
    throw new Error('Production local attachment storage cần xác nhận backup đáng tin cậy.')
  }
  if (production && lenient && !enabled(env.ATTACHMENT_STORAGE_BACKUP_CONFIRMED)) console.warn('[SECURITY] Cảnh báo: ATTACHMENT_STORAGE_BACKUP_CONFIRMED chưa true.')

  return {
    provider: 'local',
    localRoot: configuredRoot ? resolve(configuredRoot) : resolve(serverRoot, 'data', 'attachments'),
  }
}

export function assertAttachmentStorageRootReady(
  config: AttachmentStorageConfig,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): void {
  const lenient = env.HRM_ALLOW_INSECURE_PRODUCTION?.trim().toLowerCase() === 'true'
  if (env.NODE_ENV !== 'production' || lenient) {
    mkdirSync(config.localRoot, { recursive: true, mode: 0o700 })
    if (env.NODE_ENV === 'production' && lenient) console.warn(`[SECURITY] Cảnh báo: thư mục attachment '${config.localRoot}' được tự tạo (ephemeral).`)
    return
  }
  let info
  try {
    info = statSync(config.localRoot)
  } catch {
    throw new Error('ATTACHMENT_STORAGE_ROOT không tồn tại; dừng rollout thay vì tạo storage production tạm thời.')
  }
  if (!info.isDirectory()) throw new Error('ATTACHMENT_STORAGE_ROOT phải là thư mục.')
  try {
    accessSync(config.localRoot, constants.R_OK | constants.W_OK)
  } catch {
    throw new Error('ATTACHMENT_STORAGE_ROOT phải có quyền đọc và ghi.')
  }
}
