// ============================================================================
// Gemini REST client (function calling) — không dùng SDK, chỉ dùng fetch (Node 22).
// Hỗ trợ Google Gemini native và endpoint OpenAI-compatible qua GEMINI_BASE_URL.
// Key đọc từ process.env.GEMINI_API_KEY (nạp qua lib/env.ts).
// ============================================================================
const geminiKey = () => process.env.GEMINI_API_KEY || ''
const model = () => process.env.GEMINI_MODEL || 'gemini-3.6-flash'
const baseUrl = () => (process.env.GEMINI_BASE_URL || '').trim().replace(/\/+$/, '')
const googleEndpoint = () =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model()}:generateContent?key=${geminiKey()}`
const openAiEndpoint = () => `${baseUrl()}/chat/completions`

export interface GeminiPart {
  text?: string
  functionCall?: { name: string; args: Record<string, any> }
  functionResponse?: { name: string; response: Record<string, any> }
}
export interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

export interface FunctionDeclaration {
  name: string
  description: string
  parameters?: Record<string, any> // JSON Schema
}

export interface GenerateResult {
  content: GeminiContent | null
  text: string | null
  functionCalls: { name: string; args: Record<string, any> }[]
}

export function hasGeminiKey(): boolean {
  return !!geminiKey()
}

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  name?: string
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

function stringifyContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((part) => typeof part?.text === 'string' ? part.text : '').join('')
  return ''
}

function parseFunctionArguments(value: unknown): Record<string, any> {
  if (typeof value === 'object' && value !== null) return value as Record<string, any>
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

function toOpenAiMessages(contents: GeminiContent[], systemInstruction: string): OpenAiMessage[] {
  const messages: OpenAiMessage[] = [{ role: 'system', content: systemInstruction }]
  const pendingToolCallIds: string[] = []
  contents.forEach((content, contentIndex) => {
    const text = content.parts.map((part) => part.text).filter((value): value is string => !!value).join('')
    const calls = content.parts.flatMap((part, partIndex) => {
      if (!part.functionCall) return []
      const id = `call_${contentIndex}_${partIndex}`
      pendingToolCallIds.push(id)
      return [{
        id, type: 'function' as const,
        function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args ?? {}) },
      }]
    })
    const responses = content.parts.filter((part) => part.functionResponse)
    if (content.role === 'model') {
      messages.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) })
      return
    }
    if (text) messages.push({ role: 'user', content: text })
    for (const part of responses) {
      const response = part.functionResponse!
      messages.push({
        role: 'tool', name: response.name, tool_call_id: pendingToolCallIds.shift() ?? `call_${contentIndex}_unknown`,
        content: JSON.stringify(response.response ?? {}),
      })
    }
  })
  return messages
}

async function providerError(response: Response): Promise<Error> {
  const detail = await response.text().catch(() => '')
  return new Error(`Nhà cung cấp chatbot trả lỗi ${response.status}. ${detail.slice(0, 500)}`.trim())
}

async function generateOpenAiCompatible(
  contents: GeminiContent[], systemInstruction: string, tools: FunctionDeclaration[],
): Promise<GenerateResult> {
  const body: Record<string, any> = {
    model: model(), messages: toOpenAiMessages(contents, systemInstruction), temperature: 0.2,
  }
  if (tools.length) {
    body.tools = tools.map((tool) => ({
      type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters ?? { type: 'object', properties: {} } },
    }))
    body.tool_choice = 'auto'
  }
  const response = await fetch(openAiEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${geminiKey()}` },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw await providerError(response)
  const data = await response.json() as any
  const message = data?.choices?.[0]?.message
  const text = stringifyContent(message?.content) || null
  const functionCalls = (Array.isArray(message?.tool_calls) ? message.tool_calls : [])
    .filter((call: any) => call?.function?.name)
    .map((call: any) => ({ name: String(call.function.name), args: parseFunctionArguments(call.function.arguments) }))
  const parts: GeminiPart[] = [
    ...(text ? [{ text }] : []),
    ...functionCalls.map((call: { name: string; args: Record<string, any> }) => ({ functionCall: call })),
  ]
  return { content: parts.length ? { role: 'model', parts } : null, text, functionCalls }
}

async function generateGoogleNative(
  contents: GeminiContent[], systemInstruction: string, tools: FunctionDeclaration[],
): Promise<GenerateResult> {
  const body: Record<string, any> = {
    contents,
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: { temperature: 0.2 },
  }
  if (tools.length) body.tools = [{ functionDeclarations: tools }]
  const response = await fetch(googleEndpoint(), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!response.ok) throw await providerError(response)
  const data = await response.json() as any
  const candidate = data?.candidates?.[0]
  const content: GeminiContent | null = candidate?.content ?? null
  const parts: GeminiPart[] = content?.parts ?? []
  const text = parts.map((part) => part.text).filter((value): value is string => !!value).join('') || null
  const functionCalls = parts.filter((part) => part.functionCall)
    .map((part) => ({ name: part.functionCall!.name, args: part.functionCall!.args ?? {} }))
  return { content, text, functionCalls }
}

/** Một lượt gọi generateContent. Trả về content của model + text + các functionCall. */
export async function generateContent(
  contents: GeminiContent[],
  systemInstruction: string,
  tools: FunctionDeclaration[],
): Promise<GenerateResult> {
  if (!geminiKey()) throw new Error('Thiếu GEMINI_API_KEY trên server.')
  try {
    return baseUrl()
      ? await generateOpenAiCompatible(contents, systemInstruction, tools)
      : await generateGoogleNative(contents, systemInstruction, tools)
  } catch (e: any) {
    if (String(e?.message ?? '').startsWith('Nhà cung cấp chatbot trả lỗi')) throw e
    throw new Error(`Không kết nối được nhà cung cấp chatbot: ${e?.message ?? e}`)
  }
}

/**
 * Chạy hội thoại với vòng lặp function-calling.
 * - Gửi `userMessage` (kèm history) đến Gemini cùng bộ tools.
 * - Khi model gọi tool → gọi `onToolCall(name, args)` để thực thi, bồi functionResponse,
 *   rồi lặp lại (tối đa maxRounds).
 * - Khi model trả text thuần → kết thúc, trả về text cuối.
 */
export async function runChat(opts: {
  history: GeminiContent[]
  userMessage: string
  systemInstruction: string
  tools: FunctionDeclaration[]
  onToolCall: (name: string, args: Record<string, any>) => Promise<Record<string, any>>
  maxRounds?: number
}): Promise<string> {
  const { history, userMessage, systemInstruction, tools, onToolCall } = opts
  const maxRounds = opts.maxRounds ?? 6
  const contents: GeminiContent[] = [
    ...history,
    { role: 'user', parts: [{ text: userMessage }] },
  ]

  for (let i = 0; i < maxRounds; i++) {
    const { content, text, functionCalls } = await generateContent(contents, systemInstruction, tools)
    if (content) contents.push(content)

    if (!functionCalls.length) return text ?? ''

    // Thực thi từng functionCall, bọc kết quả vào functionResponse (role 'user').
    const respParts: GeminiPart[] = []
    for (const fc of functionCalls) {
      let result: Record<string, any>
      try {
        result = await onToolCall(fc.name, fc.args)
      } catch (e: any) {
        result = { error: e?.message ?? 'Lỗi thực thi tool.' }
      }
      respParts.push({ functionResponse: { name: fc.name, response: result } })
    }
    contents.push({ role: 'user', parts: respParts })
  }
  return 'Đã quá số lượt xử lý. Vui lòng gửi lại câu hỏi ngắn gọn hơn.'
}
