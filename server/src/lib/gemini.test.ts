import assert from 'node:assert/strict'
import test from 'node:test'
import { generateContent, runChat } from './gemini.js'

const ORIGINAL_ENV = {
  key: process.env.GEMINI_API_KEY,
  baseUrl: process.env.GEMINI_BASE_URL,
  model: process.env.GEMINI_MODEL,
}

function restoreEnvironment(): void {
  if (ORIGINAL_ENV.key === undefined) delete process.env.GEMINI_API_KEY
  else process.env.GEMINI_API_KEY = ORIGINAL_ENV.key
  if (ORIGINAL_ENV.baseUrl === undefined) delete process.env.GEMINI_BASE_URL
  else process.env.GEMINI_BASE_URL = ORIGINAL_ENV.baseUrl
  if (ORIGINAL_ENV.model === undefined) delete process.env.GEMINI_MODEL
  else process.env.GEMINI_MODEL = ORIGINAL_ENV.model
}

test('OpenAI-compatible provider receives model, bearer key and function tools', async () => {
  process.env.GEMINI_API_KEY = 'test-key'
  process.env.GEMINI_BASE_URL = 'https://provider.example/v1/'
  process.env.GEMINI_MODEL = 'gemini-compatible-model'
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://provider.example/v1/chat/completions')
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-key')
    const body = JSON.parse(String(init?.body))
    assert.equal(body.model, 'gemini-compatible-model')
    assert.equal(body.messages[0].role, 'system')
    assert.equal(body.messages[1].content, 'Xin chào')
    assert.equal(body.tools[0].function.name, 'get_employee')
    return Response.json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{
      id: 'call-1', type: 'function', function: { name: 'get_employee', arguments: '{"employeeCode":"NV001"}' },
    }] } }] })
  }
  try {
    const result = await generateContent(
      [{ role: 'user', parts: [{ text: 'Xin chào' }] }],
      'Bạn là trợ lý HRM.',
      [{ name: 'get_employee', description: 'Lấy nhân viên', parameters: { type: 'object' } }],
    )
    assert.equal(result.functionCalls[0]?.name, 'get_employee')
    assert.deepEqual(result.functionCalls[0]?.args, { employeeCode: 'NV001' })
  } finally {
    globalThis.fetch = originalFetch
    restoreEnvironment()
  }
})

test('function responses are converted to OpenAI tool messages on the next round', async () => {
  process.env.GEMINI_API_KEY = 'test-key'
  process.env.GEMINI_BASE_URL = 'https://provider.example/v1'
  process.env.GEMINI_MODEL = 'gemini-compatible-model'
  const originalFetch = globalThis.fetch
  const requests: any[] = []
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body))
    requests.push(body)
    if (requests.length === 1) {
      return Response.json({ choices: [{ message: { role: 'assistant', tool_calls: [{
        id: 'provider-call-id', type: 'function', function: { name: 'get_employee', arguments: '{"employeeCode":"NV001"}' },
      }] } }] })
    }
    return Response.json({ choices: [{ message: { role: 'assistant', content: 'Đã tìm thấy nhân viên.' } }] })
  }
  try {
    const answer = await runChat({
      history: [], userMessage: 'Tìm NV001', systemInstruction: 'Bạn là trợ lý HRM.',
      tools: [{ name: 'get_employee', description: 'Lấy nhân viên', parameters: { type: 'object' } }],
      onToolCall: async () => ({ employeeCode: 'NV001', employeeName: 'Nguyễn An' }),
    })
    assert.equal(answer, 'Đã tìm thấy nhân viên.')
    const secondMessages = requests[1].messages
    const assistant = secondMessages.find((message: any) => message.role === 'assistant' && message.tool_calls)
    const tool = secondMessages.find((message: any) => message.role === 'tool')
    assert.ok(assistant)
    assert.ok(tool)
    assert.equal(tool.tool_call_id, assistant.tool_calls[0].id)
  } finally {
    globalThis.fetch = originalFetch
    restoreEnvironment()
  }
})
