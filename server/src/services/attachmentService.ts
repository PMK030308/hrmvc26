import { createHash } from 'node:crypto'
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
  dataUrl: string
  uploadedByUserId: string
  checksumSha256: string
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
  return true
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
    dataUrl,
    uploadedByUserId: actorUserId,
    checksumSha256: createHash('sha256').update(content).digest('hex'),
  }
}
