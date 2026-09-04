// ============================================================================
// Gemini REST client (function calling) — không dùng SDK, chỉ dùng fetch (Node 22).
// Tài liệu: generativelanguage.googleapis.com/v1beta/models/<model>:generateContent
// Key đọc từ process.env.GEMINI_API_KEY (nạp qua lib/env.ts).
// ============================================================================
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash'
// Đọc key lười (lúc gọi) — tránh chạy tại module-load trước khi loadEnvFile() nạp .env.
const geminiKey = () => process.env.GEMINI_API_KEY || ''
const endpoint = () =>
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${geminiKey()}`

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

/** Một lượt gọi generateContent. Trả về content của model + text + các functionCall. */
export async function generateContent(
  contents: GeminiContent[],
  systemInstruction: string,
  tools: FunctionDeclaration[],
): Promise<GenerateResult> {
  if (!geminiKey()) throw new Error('Thiếu GEMINI_API_KEY trên server.')
  const body: Record<string, any> = {
    contents,
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: { temperature: 0.2 },
  }
  if (tools.length) body.tools = [{ functionDeclarations: tools }]

  let res: Response
  try {
    res = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e: any) {
    throw new Error(`Không kết nối được Gemini: ${e?.message ?? e}`)
  }

  if (!res.ok) {
    const buf = await res.arrayBuffer().catch(() => undefined)
    let detail = ''
    try { detail = buf ? new TextDecoder().decode(buf) : '' } catch { detail = '' }
    throw new Error(`Nhà cung cấp chatbot trả lỗi ${res.status}. ${detail.slice(0, 500)}`.trim())
  }
  const data = await res.json()
  const cand = data?.candidates?.[0]
  const content: GeminiContent | null = cand?.content ?? null
  const parts: GeminiPart[] = content?.parts ?? []
  const text = parts.map((p) => p.text).filter((t): t is string => !!t).join('') || null
  const functionCalls = parts
    .filter((p) => p.functionCall)
    .map((p) => ({ name: p.functionCall!.name, args: p.functionCall!.args ?? {} }))
  return { content, text, functionCalls }
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
