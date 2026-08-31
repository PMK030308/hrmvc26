import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveApiBase } from './runtimeConfig'

test('production API configuration fails closed without an exact HTTPS backend URL', () => {
  assert.throws(() => resolveApiBase(undefined, true), /VITE_API_URL/i)
  assert.throws(() => resolveApiBase('https://<backend-render-cua-ban>.onrender.com/api', true), /placeholder/i)
  assert.throws(() => resolveApiBase('http://api.example.test/api', true), /HTTPS/i)
  assert.throws(() => resolveApiBase('https://api.example.test/path', true), /\/api/i)
  assert.equal(resolveApiBase('https://api.example.test/api/', true), 'https://api.example.test/api')
})

test('development keeps the local Vite proxy default', () => {
  assert.equal(resolveApiBase(undefined, false), '/api')
  assert.equal(resolveApiBase('http://localhost:4000', false), 'http://localhost:4000/api')
})
