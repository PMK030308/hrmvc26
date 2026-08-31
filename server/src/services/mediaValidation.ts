import { httpError } from '../types.js'

const DEFAULT_AVATAR_MAX_BYTES = 2 * 1024 * 1024

function configuredAvatarMaxBytes(): number {
  const configured = Number(process.env.AVATAR_MAX_BYTES)
  return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_AVATAR_MAX_BYTES
}

function signatureMatches(mimeType: string, content: Buffer): boolean {
  if (mimeType === 'image/png') return content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (mimeType === 'image/jpeg') return content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff
  return content.length >= 12 && content.subarray(0, 4).toString('ascii') === 'RIFF' && content.subarray(8, 12).toString('ascii') === 'WEBP'
}

export function validateAvatarData(value: unknown, options: { maxBytes?: number } = {}): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw httpError(400, 'Ảnh đại diện không hợp lệ.')
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/)
  if (!match || match[2].length === 0 || match[2].length % 4 !== 0) throw httpError(400, 'Dữ liệu ảnh đại diện không hợp lệ.')
  const content = Buffer.from(match[2], 'base64')
  if (content.toString('base64') !== match[2] || !signatureMatches(match[1], content)) {
    throw httpError(400, 'Nội dung ảnh đại diện không khớp định dạng.')
  }
  const maxBytes = options.maxBytes ?? configuredAvatarMaxBytes()
  if (content.length > maxBytes) throw httpError(413, `Ảnh đại diện vượt quá giới hạn ${maxBytes} byte.`)
  return value
}
