import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { LocalAttachmentStorage } from './localAttachmentStorage.js'
import { attachmentStorageKey, streamToBuffer } from './attachmentStorage.js'

test('local attachment storage round-trips private content and supports idempotent delete', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hrm-attachment-storage-'))
  try {
    const storage = new LocalAttachmentStorage(root)
    const content = Buffer.from('%PDF-1.4')
    const key = attachmentStorageKey('att-1', 'a'.repeat(64))

    await storage.put({ key, content, contentType: 'application/pdf', checksumSha256: 'a'.repeat(64) })
    const object = await storage.open(key)
    assert.equal(object.size, content.length)
    assert.deepEqual(await streamToBuffer(object.stream), content)
    assert.equal((await storage.head(key)).exists, true)

    await storage.delete(key)
    await storage.delete(key)
    assert.equal((await storage.head(key)).exists, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
test('local attachment storage rejects traversal and absolute keys before filesystem access', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hrm-attachment-traversal-'))
  try {
    const storage = new LocalAttachmentStorage(root)
    for (const key of ['../outside', 'safe/../../outside', '/absolute/path', 'C:\\outside']) {
      await assert.rejects(() => storage.open(key), /storage key/i)
      await assert.rejects(() => storage.put({
        key, content: Buffer.from('x'), contentType: 'text/plain', checksumSha256: 'b'.repeat(64),
      }), /storage key/i)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
