export function resolveApiBase(raw: string | undefined, production: boolean): string {
  const value = raw?.trim()
  if (!value) {
    if (production) throw new Error('VITE_API_URL is required for a production build.')
    return '/api'
  }
  if (/[<>]/.test(value)) throw new Error('VITE_API_URL still contains a placeholder value.')
  const clean = value.replace(/\/+$/, '')
  if (!production) return clean.endsWith('/api') ? clean : `${clean}/api`
  let parsed: URL
  try { parsed = new URL(clean) } catch { throw new Error('VITE_API_URL must be a valid URL.') }
  if (parsed.protocol !== 'https:') throw new Error('VITE_API_URL must use HTTPS in production.')
  if (parsed.pathname !== '/api' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error('VITE_API_URL must be an exact HTTPS backend URL ending in /api.')
  }
  return parsed.toString().replace(/\/$/, '')
}
