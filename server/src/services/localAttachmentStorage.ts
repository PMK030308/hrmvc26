import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { AttachmentStorage, AttachmentStorageHead, AttachmentStorageObject, AttachmentStoragePutInput } from './attachmentStorage.js'
import { checksumSha256, streamToBuffer } from './attachmentStorage.js'

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String((error as any).code) : undefined
}

export class LocalAttachmentStorage implements AttachmentStorage {
  readonly provider = 'local'
  readonly root: string

  constructor(root: string) {
    if (!root || !isAbsolute(root)) throw new Error('Local attachment storage root phải là đường dẫn tuyệt đối.')
    this.root = resolve(root)
  }

  private pathFor(key: string): string {
    if (!key || isAbsolute(key) || key.includes('\\') || !/^[A-Za-z0-9/_-]+$/.test(key)) {
      throw new Error('Attachment storage key không hợp lệ.')
    }
    const segments = key.split('/')
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new Error('Attachment storage key không hợp lệ.')
    }
    const path = resolve(this.root, ...segments)
    const fromRoot = relative(this.root, path)
    if (!fromRoot || fromRoot.startsWith(`..${sep}`) || fromRoot === '..' || isAbsolute(fromRoot)) {
      throw new Error('Attachment storage key nằm ngoài configured root.')
    }
    return path
  }

  async put(input: AttachmentStoragePutInput): Promise<void> {
    const path = this.pathFor(input.key)
    if (!/^[a-f0-9]{64}$/i.test(input.checksumSha256) || checksumSha256(input.content) !== input.checksumSha256.toLowerCase()) {
      throw new Error('Attachment checksum không khớp nội dung trước khi lưu.')
    }
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const existing = await this.head(input.key)
    if (existing.exists) {
      const current = await this.open(input.key)
      const content = await streamToBuffer(current.stream, input.content.length)
      if (content.length !== input.content.length || checksumSha256(content) !== input.checksumSha256.toLowerCase()) {
        throw new Error('Attachment storage key đã tồn tại với nội dung khác.')
      }
      return
    }

    const temporary = resolve(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try { await handle.writeFile(input.content) } finally { await handle.close() }
      try {
        await rename(temporary, path)
      } catch (error) {
        if (!['EEXIST', 'EPERM'].includes(errorCode(error) ?? '')) throw error
        const current = await this.open(input.key)
        const content = await streamToBuffer(current.stream, input.content.length)
        if (content.length !== input.content.length || checksumSha256(content) !== input.checksumSha256.toLowerCase()) throw error
      }
    } finally {
      try { await unlink(temporary) } catch (error) { if (errorCode(error) !== 'ENOENT') throw error }
    }
  }

  async open(key: string): Promise<AttachmentStorageObject> {
    const path = this.pathFor(key)
    const info = await stat(path)
    if (!info.isFile()) throw new Error('Attachment storage object không phải file.')
    return { stream: createReadStream(path), size: info.size }
  }

  async head(key: string): Promise<AttachmentStorageHead> {
    const path = this.pathFor(key)
    try {
      const info = await stat(path)
      return info.isFile() ? { exists: true, size: info.size } : { exists: false }
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return { exists: false }
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    const path = this.pathFor(key)
    try { await unlink(path) } catch (error) { if (errorCode(error) !== 'ENOENT') throw error }
  }
}
