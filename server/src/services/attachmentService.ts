import { createHash } from 'node:crypto'
import { isUtf8 } from 'node:buffer'
import { httpError } from '../types.js'

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const MIME_EXTENSIONS: Record<string, readonly string[]> = {
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'text/plain': ['txt'],
  'text/csv': ['csv'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.ms-excel': ['xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
}

export interface AttachmentUploadInput {
  fileName: unknown
  fileSize: unknown
  mimeType: unknown
  dataUrl: unknown
}

export interface PreparedAttachmentUpload {
  fileName: string
  fileSize: number
  mimeType: string
  content: Buffer
  uploadedByUserId: string
  checksumSha256: string
}

export function decodeStoredAttachment(input: { dataUrl: string; mimeType: string; checksumSha256?: string | null }): Buffer {
  const escapedMime = input.mimeType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = input.dataUrl.match(new RegExp(`^data:${escapedMime};base64,([A-Za-z0-9+/]*={0,2})$`))
  if (!match || match[1].length % 4 !== 0) throw httpError(500, 'Dữ liệu file lưu trữ không hợp lệ.')
  const content = Buffer.from(match[1], 'base64')
  if (content.toString('base64') !== match[1]) throw httpError(500, 'Dữ liệu file lưu trữ bị hỏng.')
  if (input.checksumSha256) {
    const checksum = createHash('sha256').update(content).digest('hex')
    if (checksum !== input.checksumSha256) throw httpError(500, 'Checksum file không khớp.')
  }
  return content
}

function configuredMaxBytes(): number {
  const configured = Number(process.env.ATTACHMENT_MAX_BYTES)
  return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_BYTES
}

function hasExpectedSignature(mimeType: string, content: Buffer): boolean {
  if (mimeType === 'application/pdf') return content.subarray(0, 5).toString('ascii') === '%PDF-'
  if (mimeType === 'image/png') return content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (mimeType === 'image/jpeg') return content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff
  if (mimeType === 'image/webp') return content.length >= 12 && content.subarray(0, 4).toString('ascii') === 'RIFF' && content.subarray(8, 12).toString('ascii') === 'WEBP'
  if (mimeType === 'text/plain' || mimeType === 'text/csv') return isUtf8(content) && !content.includes(0)
  if (mimeType === 'application/msword' || mimeType === 'application/vnd.ms-excel') {
    return content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
  }
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return content.length >= 4 && content.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
      && content.includes(Buffer.from('[Content_Types].xml')) && content.includes(Buffer.from('word/'))
  }
  if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return content.length >= 4 && content.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
      && content.includes(Buffer.from('[Content_Types].xml')) && content.includes(Buffer.from('xl/'))
  }
  return false
}

export function prepareAttachmentUpload(
  input: AttachmentUploadInput,
  actorUserId: string,
  options: { maxBytes?: number } = {},
): PreparedAttachmentUpload {
  const fileName = typeof input.fileName === 'string' ? input.fileName.trim() : ''
  const mimeType = typeof input.mimeType === 'string' ? input.mimeType.trim().toLowerCase() : ''
  const dataUrl = typeof input.dataUrl === 'string' ? input.dataUrl : ''
  if (!fileName || fileName.length > 255 || /[\\/\0-\x1f]/.test(fileName)) throw httpError(400, 'Tên file không hợp lệ.')
  if (!actorUserId) throw httpError(400, 'Thiếu người tải file.')
  const extensions = MIME_EXTENSIONS[mimeType]
  const extension = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase() : ''
  if (!extensions || !extensions.includes(extension)) throw httpError(400, 'Định dạng hoặc phần mở rộng file không được hỗ trợ.')

  const match = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/)
  if (!match || match[1].toLowerCase() !== mimeType || match[2].length === 0 || match[2].length % 4 !== 0) {
    throw httpError(400, 'Dữ liệu file không hợp lệ.')
  }
  const content = Buffer.from(match[2], 'base64')
  if (content.toString('base64') !== match[2]) throw httpError(400, 'Dữ liệu base64 không hợp lệ.')
  const maxBytes = options.maxBytes ?? configuredMaxBytes()
  if (content.length > maxBytes) throw httpError(413, `File vượt quá giới hạn ${maxBytes} byte.`)
  if (!Number.isSafeInteger(input.fileSize) || Number(input.fileSize) !== content.length) {
    throw httpError(400, 'Kích thước file không khớp nội dung thực tế.')
  }
  if (!hasExpectedSignature(mimeType, content)) throw httpError(400, 'Nội dung file không khớp MIME type.')

  return {
    fileName,
    fileSize: content.length,
    mimeType,
    content,
    uploadedByUserId: actorUserId,
    checksumSha256: createHash('sha256').update(content).digest('hex'),
  }
}
