import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'
import { assertAttachmentStorageRootReady, resolveAttachmentStorageConfig } from '../lib/attachmentStorageConfig.js'
import type { AttachmentStorage } from './attachmentStorage.js'
import { LegacyDataUrlAttachmentStorage } from './legacyAttachmentStorage.js'
import { LocalAttachmentStorage } from './localAttachmentStorage.js'

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
let cachedLocal: { root: string; storage: LocalAttachmentStorage } | null = null

export function getPrimaryAttachmentStorage(env = process.env): LocalAttachmentStorage {
  const config = resolveAttachmentStorageConfig(env, serverRoot)
  assertAttachmentStorageRootReady(config, env)
  if (!cachedLocal || cachedLocal.root !== config.localRoot) {
    cachedLocal = { root: config.localRoot, storage: new LocalAttachmentStorage(config.localRoot) }
  }
  return cachedLocal.storage
}

export function storageForAttachment(database: Database.Database, row: any): { storage: AttachmentStorage; key: string } {
  if (row.storage_provider === 'local' && typeof row.storage_key === 'string' && row.storage_key) {
    return { storage: getPrimaryAttachmentStorage(), key: row.storage_key }
  }
  if (row.storage_provider != null || row.storage_key != null) throw new Error('Attachment storage metadata không hợp lệ.')
  return {
    storage: new LegacyDataUrlAttachmentStorage((id) => {
      const legacy = database.prepare(`SELECT data_url, mime_type, file_size, checksum_sha256
        FROM request_attachments WHERE id=?`).get(id) as any
      return legacy ? {
        dataUrl: legacy.data_url,
        mimeType: legacy.mime_type,
        fileSize: legacy.file_size,
        checksumSha256: legacy.checksum_sha256,
      } : null
    }),
    key: row.id,
  }
}
