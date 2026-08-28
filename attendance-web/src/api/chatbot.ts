// Chatbot API — gọi backend /api/chatbot (backend dùng Gemini, key nằm trên server).
import { api } from './http'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  draft?: CreateDraft | null
}

export interface CreateDraft {
  requestType: string
  fields: Record<string, any>
  summary: Record<string, any>
}

export interface ChatResponse {
  reply: string
  draft?: CreateDraft | null
}

export interface CreateResponse {
  ok: boolean
  request?: any
  reply: string
}

export const chatbotApi = {
  send: (message: string, history: { role: string; content: string }[]) =>
    api.post<ChatResponse>('/chatbot', { message, history }),
  create: (draft: CreateDraft) =>
    api.post<CreateResponse>('/chatbot/create', { requestType: draft.requestType, fields: draft.fields }),
  status: () => api.get<{ enabled: boolean }>('/chatbot/status'),
}