// ============================================================================
// LLM client (function calling) — tương thích OpenAI (/chat/completions).
// Mặc định trỏ tới endpoint OpenAI-compatible của Google Gemini, nhưng có thể
// đổi sang relay/proxy bất kỳ qua GEMINI_BASE_URL (vd: https://cheapkeyai.shop/v1).
// Biến môi trường:
//   GEMINI_API_KEY  — bearer token (bắt buộc)
//   GEMINI_BASE_URL — base URL của endpoint OpenAI-compatible (tuỳ chọn)
//   GEMINI_MODEL    — tên model (tuỳ chọn)
// ============================================================================

// Endpoint mặc định: OpenAI-compat của Google Gemini (dùng được với Google API key).
const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai'
const base = () => (process.env.GEMINI_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '')
const model = () => process.env.GEMINI_MODEL || 'gemini-3.6-flash'
const key = () => process.env.GEMINI_API_KEY || ''

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
  return !!key()
}

/** Chuyển FunctionDeclaration[] → định dạng tools của OpenAI. */
function toOpenAITools(tools: FunctionDeclaration[]): any[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters ?? { type: 'object', properties: {} },
    },
  }))
}

/** Chuyển GeminiContent[] (chỉ chứa text — từ history client) → OpenAI messages. */
function toOpenAIMessages(history: GeminiContent[], systemInstruction: string): any[] {
  const msgs: any[] = [{ role: 'system', content: systemInstruction }]
  for (const c of history) {
    const text = (c.parts ?? []).map((p) => p.text).filter((t): t is string => !!t).join('')
    msgs.push({ role: c.role === 'model' ? 'assistant' : 'user', content: text })
  }
  return msgs
}

interface ChatCompletionResult {
  content: string | null
  toolCalls: { id: string; name: string; args: Record<string, any> }[]
}

/** Một lượt gọi /chat/completions. */
async function chatCompletion(messages: any[], tools: any[]): Promise<ChatCompletionResult> {
  if (!key()) throw new Error('Thiếu GEMINI_API_KEY trên server.')
  const body: Record<string, any> = { model: model(), messages, temperature: 0.2 }
  if (tools.length) body.tools = tools

  let res: Response
  try {
    res = await fetch(`${base()}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` },
      body: JSON.stringify(body),
    })
  } catch (e: any) {
    throw new Error(`Không kết nối được dịch vụ chatbot: ${e?.message ?? e}`)
  }

  if (!res.ok) {
    const buf = await res.arrayBuffer().catch(() => undefined)
    let detail = ''
    try { detail = buf ? new TextDecoder().decode(buf) : '' } catch { detail = '' }
    throw new Error(`Nhà cung cấp chatbot trả lỗi ${res.status}. ${detail.slice(0, 500)}`.trim())
  }
  const data = await res.json()
  const msg = data?.choices?.[0]?.message ?? {}
  const toolCalls = (msg.tool_calls ?? []).map((tc: any) => {
    let args: Record<string, any> = {}
    try { args = JSON.parse(tc?.function?.arguments || '{}') } catch { args = {} }
    return { id: tc?.id ?? `call_${Math.random().toString(36).slice(2)}`, name: tc?.function?.name, args }
  })
  return { content: msg.content ?? null, toolCalls }
}

/** Một lượt generate (giữ signature cũ; dùng /chat/completions). */
export async function generateContent(
  contents: GeminiContent[],
  systemInstruction: string,
  tools: FunctionDeclaration[],
): Promise<GenerateResult> {
  const messages = toOpenAIMessages(contents, systemInstruction)
  const { content, toolCalls } = await chatCompletion(messages, toOpenAITools(tools))
  const parts: GeminiPart[] = []
  if (content) parts.push({ text: content })
  for (const tc of toolCalls) parts.push({ functionCall: { name: tc.name, args: tc.args } })
  const geminiContent: GeminiContent | null = parts.length ? { role: 'model', parts } : null
  return {
    content: geminiContent,
    text: content,
    functionCalls: toolCalls.map((tc) => ({ name: tc.name, args: tc.args })),
  }
}

/**
 * Chạy hội thoại với vòng lặp function-calling (OpenAI tool_calls).
 * - Gửi userMessage (kèm history) đến LLM cùng bộ tools.
 * - Khi model gọi tool → thực thi, bồi kết quả dạng message 'tool', rồi lặp (tối đa maxRounds).
 * - Khi model trả text thuần → kết thúc.
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
  const messages = toOpenAIMessages(history, systemInstruction)
  messages.push({ role: 'user', content: userMessage })
  const openaiTools = toOpenAITools(tools)

  for (let i = 0; i < maxRounds; i++) {
    const { content, toolCalls } = await chatCompletion(messages, openaiTools)
    if (!toolCalls.length) return content ?? ''
    // Lưu assistant message kèm tool_calls (đúng định dạng OpenAI để tiếp tục vòng).
    messages.push({
      role: 'assistant',
      content: content ?? null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id, type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.args) },
      })),
    })
    // Thực thi từng tool, bồi kết quả dạng message 'tool'.
    for (const tc of toolCalls) {
      let result: Record<string, any>
      try {
        result = await onToolCall(tc.name, tc.args)
      } catch (e: any) {
        result = { error: e?.message ?? 'Lỗi thực thi tool.' }
      }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) })
    }
  }
  return 'Đã quá số lượt xử lý. Vui lòng gửi lại câu hỏi ngắn gọn hơn.'
}
