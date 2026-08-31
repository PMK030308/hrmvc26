import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveAttachmentStorageConfig } from './attachmentStorageConfig.js'

test('production local storage requires an absolute persistent root and explicit backup confirmation', () => {
  const base = { NODE_ENV: 'production', ATTACHMENT_STORAGE_PROVIDER: 'local' }
  assert.throws(() => resolveAttachmentStorageConfig(base), /ATTACHMENT_STORAGE_ROOT/)
  assert.throws(() => resolveAttachmentStorageConfig({ ...base, ATTACHMENT_STORAGE_ROOT: '/srv/hrm/attachments' }), /persistent volume/i)
  assert.throws(() => resolveAttachmentStorageConfig({
    ...base,
    ATTACHMENT_STORAGE_ROOT: '/srv/hrm/attachments',
    ATTACHMENT_STORAGE_PERSISTENT_VOLUME: 'true',
  }), /backup/i)

  const config = resolveAttachmentStorageConfig({
    ...base,
    ATTACHMENT_STORAGE_ROOT: '/srv/hrm/attachments',
    ATTACHMENT_STORAGE_PERSISTENT_VOLUME: 'true',
    ATTACHMENT_STORAGE_BACKUP_CONFIRMED: 'true',
  })
  assert.equal(config.provider, 'local')
  assert.equal(config.localRoot, '/srv/hrm/attachments')
})

test('development defaults to local storage while unsupported providers fail closed', () => {
  const config = resolveAttachmentStorageConfig({ NODE_ENV: 'development' }, '/workspace/server')
  assert.equal(config.provider, 'local')
  assert.equal(config.localRoot, '/workspace/server/data/attachments')
  assert.throws(() => resolveAttachmentStorageConfig({ ATTACHMENT_STORAGE_PROVIDER: 'public-http' }), /provider/i)
})
