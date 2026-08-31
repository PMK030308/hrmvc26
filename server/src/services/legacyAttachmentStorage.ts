import { Readable } from 'node:stream'
import type { AttachmentStorage, AttachmentStorageHead, AttachmentStorageObject, AttachmentStoragePutInput } from './attachmentStorage.js'
import { decodeStoredAttachment } from './attachmentService.js'

export interface LegacyAttachmentPayload {
  dataUrl: string
  mimeType: string
  fileSize: number
  checksumSha256?: string | null
}

export class LegacyDataUrlAttachmentStorage implements AttachmentStorage {
  readonly provider = 'legacy-data-url'

  constructor(private readonly load: (key: string) => LegacyAttachmentPayload | null) {}

  async put(_input: AttachmentStoragePutInput): Promise<void> {
    throw new Error('Legacy data URL storage chỉ hỗ trợ đọc trong cửa sổ chuyển tiếp.')
  }

  async open(key: string): Promise<AttachmentStorageObject> {
    const payload = this.load(key)
    if (!payload) throw new Error('Không tìm thấy legacy attachment payload.')
    const content = decodeStoredAttachment(payload)
    if (content.length !== payload.fileSize) throw new Error('Kích thước legacy attachment không khớp metadata.')
    return { stream: Readable.from(content), size: content.length }
  }

  async head(key: string): Promise<AttachmentStorageHead> {
    const payload = this.load(key)
    return payload ? { exists: true, size: payload.fileSize } : { exists: false }
  }

  async delete(_key: string): Promise<void> {
    // Payload legacy nằm cùng DB row và được xóa bởi transaction của caller.
  }
}
