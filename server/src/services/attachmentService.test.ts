import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { prepareAttachmentUpload } from './attachmentService.js'

const pdf = Buffer.from('%PDF-1.4')
const validInput = {
  fileName: 'proof.pdf',
  fileSize: pdf.length,
  mimeType: 'application/pdf',
  dataUrl: `data:application/pdf;base64,${pdf.toString('base64')}`,
}

test('attachment preparation derives size, checksum and uploader from validated content', () => {
  const prepared = prepareAttachmentUpload(validInput, 'user-1')
  assert.equal(prepared.fileName, 'proof.pdf')
  assert.equal(prepared.fileSize, pdf.length)
  assert.equal(prepared.mimeType, 'application/pdf')
  assert.equal(prepared.uploadedByUserId, 'user-1')
  assert.equal(prepared.checksumSha256, createHash('sha256').update(pdf).digest('hex'))
})

test('attachment preparation rejects malformed base64, metadata mismatch and MIME-extension mismatch', () => {
  assert.throws(() => prepareAttachmentUpload({ ...validInput, dataUrl: 'data:application/pdf;base64,***' }, 'user-1'), (error: any) => error.status === 400)
  assert.throws(() => prepareAttachmentUpload({ ...validInput, fileSize: pdf.length + 1 }, 'user-1'), (error: any) => error.status === 400)
  assert.throws(() => prepareAttachmentUpload({ ...validInput, fileName: 'proof.png' }, 'user-1'), (error: any) => error.status === 400)
  assert.throws(() => prepareAttachmentUpload({ ...validInput, mimeType: 'text/html', dataUrl: 'data:text/html;base64,PGgxPng8L2gxPg==' }, 'user-1'), (error: any) => error.status === 400)
})

test('attachment preparation rejects content over the configured decoded byte limit with 413', () => {
  const oversized = Buffer.alloc(1025, 1)
  assert.throws(() => prepareAttachmentUpload({
    fileName: 'proof.pdf', fileSize: oversized.length, mimeType: 'application/pdf',
    dataUrl: `data:application/pdf;base64,${oversized.toString('base64')}`,
  }, 'user-1', { maxBytes: 1024 }), (error: any) => error.status === 413)
})

test('attachment preparation validates magic bytes for images, legacy Office and OpenXML containers', () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  assert.equal(prepareAttachmentUpload({
    fileName: 'proof.png', fileSize: png.length, mimeType: 'image/png',
    dataUrl: `data:image/png;base64,${png.toString('base64')}`,
  }, 'user-1').fileSize, png.length)
  assert.throws(() => prepareAttachmentUpload({
    fileName: 'proof.png', fileSize: pdf.length, mimeType: 'image/png', dataUrl: `data:image/png;base64,${pdf.toString('base64')}`,
  }, 'user-1'), (error: any) => error.status === 400)

  const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  assert.equal(prepareAttachmentUpload({
    fileName: 'proof.doc', fileSize: ole.length, mimeType: 'application/msword',
    dataUrl: `data:application/msword;base64,${ole.toString('base64')}`,
  }, 'user-1').fileSize, ole.length)

  const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('[Content_Types].xml word/document.xml')])
  assert.equal(prepareAttachmentUpload({
    fileName: 'proof.docx', fileSize: docx.length,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    dataUrl: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${docx.toString('base64')}`,
  }, 'user-1').fileSize, docx.length)
})

test('attachment preparation accepts valid UTF-8 text but rejects binary content disguised as text', () => {
  const text = Buffer.from('attendance evidence\n')
  assert.equal(prepareAttachmentUpload({
    fileName: 'proof.txt', fileSize: text.length, mimeType: 'text/plain',
    dataUrl: `data:text/plain;base64,${text.toString('base64')}`,
  }, 'user-1').fileSize, text.length)
  const binary = Buffer.from([0, 1, 2, 3])
  assert.throws(() => prepareAttachmentUpload({
    fileName: 'proof.txt', fileSize: binary.length, mimeType: 'text/plain',
    dataUrl: `data:text/plain;base64,${binary.toString('base64')}`,
  }, 'user-1'), (error: any) => error.status === 400)
})
