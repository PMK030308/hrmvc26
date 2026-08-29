import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveTheme } from './theme.js'

test('system theme follows a dark Windows preference', () => {
  assert.equal(resolveTheme('system', true), 'dark')
})

test('system theme follows a light Windows preference', () => {
  assert.equal(resolveTheme('system', false), 'light')
})

test('manual theme overrides the Windows preference', () => {
  assert.equal(resolveTheme('light', true), 'light')
  assert.equal(resolveTheme('dark', false), 'dark')
})
