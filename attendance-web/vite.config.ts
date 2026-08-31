import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { resolveApiBase } from './src/lib/runtimeConfig.js'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  if (mode === 'production') resolveApiBase(env.VITE_API_URL, true)
  return {
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  // Tắt warning "chunk size > 500 kB" (face-api/recharts khá lớn) — chỉ là cảnh báo, không lỗi.
  build: {
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    proxy: {
      // Proxy mọi request /api → backend Express (mặc định :4000)
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  }
})
