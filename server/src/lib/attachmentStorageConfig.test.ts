import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { assertAttachmentStorageRootReady, resolveAttachmentStorageConfig } from './attachmentStorageConfig.js'

test('production local storage requires an absolute persistent root and explicit backup confirmation', () => {
  const root = resolve('phase8-persistent-attachments')
  const base = { NODE_ENV: 'production', ATTACHMENT_STORAGE_PROVIDER: 'local' }
  assert.throws(() => resolveAttachmentStorageConfig(base), /ATTACHMENT_STORAGE_ROOT/)
  assert.throws(() => resolveAttachmentStorageConfig({ ...base, ATTACHMENT_STORAGE_ROOT: root }), /persistent volume/i)
  assert.throws(() => resolveAttachmentStorageConfig({
    ...base,
    ATTACHMENT_STORAGE_ROOT: root,
    ATTACHMENT_STORAGE_PERSISTENT_VOLUME: 'true',
  }), /backup/i)

  const config = resolveAttachmentStorageConfig({
    ...base,
    ATTACHMENT_STORAGE_ROOT: root,
    ATTACHMENT_STORAGE_PERSISTENT_VOLUME: 'true',
    ATTACHMENT_STORAGE_BACKUP_CONFIRMED: 'true',
  })
  assert.equal(config.provider, 'local')
  assert.equal(config.localRoot, root)
})

test('development defaults to local storage while unsupported providers fail closed', () => {
  const serverRoot = resolve('workspace', 'server')
  const config = resolveAttachmentStorageConfig({ NODE_ENV: 'development' }, serverRoot)
  assert.equal(config.provider, 'local')
  assert.equal(config.localRoot, resolve(serverRoot, 'data', 'attachments'))
  assert.throws(() => resolveAttachmentStorageConfig({ ATTACHMENT_STORAGE_PROVIDER: 'public-http' }), /provider/i)
})

test('production refuses a missing local root instead of silently creating ephemeral storage', () => {
  const parent = mkdtempSync(join(tmpdir(), 'hrm-storage-readiness-'))
  try {
    const root = join(parent, 'missing-volume')
    const config = { provider: 'local' as const, localRoot: root }
    assert.throws(() => assertAttachmentStorageRootReady(config, { NODE_ENV: 'production' }), /không tồn tại|not exist/i)
    assert.equal(assertAttachmentStorageRootReady(config, { NODE_ENV: 'development' }), undefined)
    assert.equal(assertAttachmentStorageRootReady(config, { NODE_ENV: 'production' }), undefined)
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})
