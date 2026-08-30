import assert from 'node:assert/strict'
import test from 'node:test'
import { phase6Capabilities } from './phase6Capabilities'

test('chatbot visibility derives only from the DB effective permission set', () => {
  assert.equal(phase6Capabilities(['chatbot.use']).canUseChatbot, true)
  assert.equal(phase6Capabilities([]).canUseChatbot, false)
  assert.equal(phase6Capabilities(['requests.request.create_own']).canUseChatbot, false)
})
