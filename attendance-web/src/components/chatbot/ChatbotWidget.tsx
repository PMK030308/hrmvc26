// ============================================================================
// ChatbotWidget — nút floating + panel chat (trợ lý HRM).
// Gọi backend /api/chatbot (Gemini function-calling). Hỗ trợ 2 nhóm việc:
//  - tra cứu thông tin (chấm công, đơn từ, quỹ phép, OT, nhân viên...)
//  - tạo đơn tự động (kèm thẻ xác nhận trước khi ghi vào DB).
// ============================================================================
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bot, Send, X, Sparkles, Check, Loader2 } from 'lucide-react'
import { chatbotApi, type ChatMessage, type CreateDraft } from '@/api/chatbot'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'

const SUGGESTIONS = [
  'Hôm nay tôi chấm công thế nào?',
  'Tôi còn bao nhiêu ngày phép?',
  'Tạo đơn nghỉ phép năm từ 10/08 đến 12/08, lý do việc nhà',
  'Giờ OT tháng này của tôi?',
  'Danh sách đơn của tôi đang chờ duyệt',
]

const SUMMARY_LABEL: Record<string, string> = {
  leaveTypeName: 'Loại nghỉ', startDate: 'Từ ngày', endDate: 'Đến ngày',
  requestDate: 'Ngày', lateEarlyType: 'Loại', requestedTime: 'Thời gian', minutes: 'Số phút',
  otDate: 'Ngày OT', startTime: 'Giờ bắt đầu', endTime: 'Giờ kết thúc', compensationType: 'Hình thức',
  location: 'Địa điểm', purpose: 'Mục đích',
  shiftSwapMode: 'Hình thức', partnerName: 'Đổi với',
  updateType: 'Loại', newCheckInTime: 'Giờ vào mới', newCheckOutTime: 'Giờ ra mới',
  reason: 'Lý do',
}
const SUMMARY_ORDER = Object.keys(SUMMARY_LABEL)

/** Render text nhẹ: in đậm **...** và xuống dòng. */
function FormattedText({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <>
      {lines.map((line, i) => (
        <div key={i} className="whitespace-pre-wrap break-words">
          {renderBold(line)}
        </div>
      ))}
    </>
  )
}
function renderBold(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i} className="font-semibold">{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>,
  )
}

function DraftCard({ draft, onConfirm, onSkip, loading }: {
  draft: CreateDraft; onConfirm: () => void; onSkip: () => void; loading: boolean
}) {
  const entries = SUMMARY_ORDER
    .filter((k) => draft.summary[k] != null && draft.summary[k] !== '')
    .map((k) => [SUMMARY_LABEL[k], String(draft.summary[k])]) as [string, string][]
  return (
    <div className="mt-2 rounded-xl border border-brand-200 bg-brand-50/60 p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-brand-700">
        <Sparkles className="h-3.5 w-3.5" /> Xác nhận tạo đơn
      </div>
      <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-xs sm:grid-cols-2">
        {entries.map(([k, v]) => (
          <div key={k} className="flex gap-1">
            <dt className="text-slate-500">{k}:</dt>
            <dd className="font-medium text-slate-800">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={onConfirm} disabled={loading} icon={loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}>
          {loading ? 'Đang tạo...' : 'Tạo đơn'}
        </Button>
        <Button size="sm" variant="secondary" onClick={onSkip} disabled={loading}>Bỏ qua</Button>
      </div>
    </div>
  )
}

export function ChatbotWidget() {
  const user = useAuthStore((s) => s.user)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatbotApi.status().then((r) => setEnabled(r.enabled)).catch(() => setEnabled(false))
  }, [])
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, busy, open])

  if (!user) return null

  async function send(text: string) {
    const content = text.trim()
    if (!content || busy || enabled !== true) return
    const history = messages.map((m) => ({ role: m.role, content: m.content }))
    const next: ChatMessage = { role: 'user', content }
    setMessages((m) => [...m, next])
    setInput('')
    setBusy(true)
    try {
      const r = await chatbotApi.send(content, history)
      setMessages((m) => [...m, { role: 'assistant', content: r.reply, draft: r.draft ?? null }])
    } catch (e: any) {
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${e?.message ?? 'Lỗi kết nối chatbot.'}` }])
    } finally {
      setBusy(false)
    }
  }

  async function confirmDraft(draft: CreateDraft, msgIndex: number) {
    setCreating(true)
    try {
      const r = await chatbotApi.create(draft)
      setMessages((m) => m.map((msg, i) => i === msgIndex ? { ...msg, draft: null } : msg))
      setMessages((m) => [...m, { role: 'assistant', content: r.reply }])
    } catch (e: any) {
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ Không tạo được đơn: ${e?.message ?? 'lỗi.'}` }])
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      {/* Nút floating */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'fixed bottom-20 right-4 z-50 grid h-14 w-14 place-items-center rounded-full text-white shadow-lg transition lg:bottom-6 lg:right-6',
          enabled === false ? 'bg-slate-500 hover:bg-slate-600' : 'bg-brand-600 hover:bg-brand-700',
          open && 'rotate-90',
        )}
        aria-label="Trợ lý HRM"
      >
        {open ? <X className="h-6 w-6" /> : <Bot className="h-6 w-6" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            className="fixed bottom-36 right-4 z-50 flex h-[70vh] max-h-[620px] w-[calc(100vw-2rem)] max-w-[400px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 lg:bottom-24 lg:right-6"
          >
            {/* Header */}
            <div className="flex items-center gap-2.5 border-b border-slate-100 bg-gradient-to-r from-brand-600 to-brand-500 px-4 py-3 text-white">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-white/20"><Bot className="h-5 w-5" /></div>
              <div className="flex-1">
                <p className="text-sm font-semibold">HRM Assistant</p>
                <p className="text-[10px] text-white/80">{enabled === false ? 'Chưa cấu hình dịch vụ AI' : enabled === null ? 'Đang kiểm tra kết nối...' : 'Tra cứu & tạo đơn tự động'}</p>
              </div>
              <button onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/20"><X className="h-4 w-4" /></button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-3">
              {enabled === false ? (
                <div className="rounded-2xl rounded-tl-sm bg-white p-4 text-sm text-slate-700 ring-1 ring-slate-200">
                  <p className="font-semibold text-slate-800">Chatbot chưa được kích hoạt</p>
                  <p className="mt-1.5 text-xs leading-5 text-slate-500">Server chưa có <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">GEMINI_API_KEY</code>. Hãy thêm key vào file <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">server/.env</code> rồi khởi động lại backend.</p>
                </div>
              ) : enabled === null ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Đang kiểm tra chatbot...</div>
              ) : messages.length === 0 && (
                <div className="space-y-3">
                  <div className="rounded-2xl rounded-tl-sm bg-white p-3 text-sm text-slate-700 ring-1 ring-slate-200">
                    Chào <span className="font-semibold">{user.roles.includes('Admin') || user.roles.includes('HR') ? 'quản lý' : 'bạn'}</span>! 👋 Mình có thể giúp <b>tra cứu thông tin</b> (chấm công, đơn từ, quỹ phép, OT...) và <b>tạo đơn tự động</b>. Thử gợi ý bên dưới nhé:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} onClick={() => send(s)}
                        className="rounded-full bg-white px-2.5 py-1.5 text-[11px] text-slate-600 ring-1 ring-slate-200 transition hover:bg-brand-50 hover:text-brand-700 hover:ring-brand-200">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className={cn(
                    'max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm',
                    m.role === 'user'
                      ? 'rounded-tr-sm bg-brand-600 text-white'
                      : 'rounded-tl-sm bg-white text-slate-700 ring-1 ring-slate-200',
                  )}>
                    <FormattedText text={m.content} />
                    {m.draft && (
                      <DraftCard
                        draft={m.draft}
                        loading={creating}
                        onConfirm={() => confirmDraft(m.draft!, i)}
                        onSkip={() => setMessages((mm) => mm.map((x, j) => j === i ? { ...x, draft: null } : x))}
                      />
                    )}
                  </div>
                </div>
              ))}

              {busy && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm bg-white px-3 py-2.5 ring-1 ring-slate-200">
                    {[0, 1, 2].map((d) => (
                      <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${d * 120}ms` }} />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            {enabled === true && <div className="border-t border-slate-100 bg-white p-2.5">
              <form
                onSubmit={(e) => { e.preventDefault(); send(input) }}
                className="flex items-end gap-2"
              >
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
                  rows={1}
                  placeholder="Nhập câu hỏi hoặc yêu cầu tạo đơn..."
                  className="max-h-24 flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                />
                <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label="Gửi">
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </div>}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
