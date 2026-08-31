import assert from 'node:assert/strict'
import test from 'node:test'
import { validateAvatarData } from './mediaValidation.js'

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])
const pngUrl = `data:image/png;base64,${png.toString('base64')}`

test('avatar validation accepts null and a signature-matching bounded image', () => {
  assert.equal(validateAvatarData(null), null)
  assert.equal(validateAvatarData(pngUrl, { maxBytes: png.length }), pngUrl)
})

test('avatar validation rejects SVG/HTML, malformed base64, signature mismatch and oversized images', () => {
  assert.throws(() => validateAvatarData('data:image/svg+xml;base64,PHN2Zz4=', { maxBytes: 100 }), (error: any) => error.status === 400)
  assert.throws(() => validateAvatarData('data:image/png;base64,***', { maxBytes: 100 }), (error: any) => error.status === 400)
  assert.throws(() => validateAvatarData('data:image/png;base64,AAAA', { maxBytes: 100 }), (error: any) => error.status === 400)
  assert.throws(() => validateAvatarData(pngUrl, { maxBytes: png.length - 1 }), (error: any) => error.status === 413)
})
