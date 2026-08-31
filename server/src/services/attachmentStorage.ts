import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'

export interface AttachmentStoragePutInput {
  key: string
  content: Buffer
  contentType: string
  checksumSha256: string
}

export interface AttachmentStorageObject {
  stream: Readable
  size: number
}

export interface AttachmentStorageHead {
  exists: boolean
  size?: number
}

export interface AttachmentStorage {
  readonly provider: string
  put(input: AttachmentStoragePutInput): Promise<void>
  open(key: string): Promise<AttachmentStorageObject>
  head(key: string): Promise<AttachmentStorageHead>
  delete(key: string): Promise<void>
}

export function attachmentStorageKey(attachmentId: string, checksumSha256: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(attachmentId)) throw new Error('Attachment id không hợp lệ để tạo storage key.')
  const checksum = checksumSha256.toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(checksum)) throw new Error('Attachment checksum không hợp lệ để tạo storage key.')
  return `request-attachments/${attachmentId}/${checksum}`
}

export async function streamToBuffer(stream: Readable, maxBytes = Number.MAX_SAFE_INTEGER): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new Error('Stored attachment vượt quá kích thước mong đợi.')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks, size)
}

export function checksumSha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}
