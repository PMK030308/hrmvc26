export interface PasswordResetDeliveryConfig {
  provider: 'none' | 'webhook'
  webhookUrl?: string
  bearerToken?: string
  publicResetUrl?: string
}

export interface PasswordResetDeliveryMessage {
  email: string
  token: string
  expiresAt: string
}

function exactHttpsUrl(value: string | undefined, name: string): string {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`${name} is required.`)
  let url: URL
  try { url = new URL(normalized) } catch { throw new Error(`${name} must be a valid URL.`) }
  if (url.protocol !== 'https:') throw new Error(`${name} must use HTTPS.`)
  if (url.username || url.password || url.hash) throw new Error(`${name} must not contain credentials or fragments.`)
  return url.toString()
}

export function resolvePasswordResetDeliveryConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): PasswordResetDeliveryConfig {
  const production = env.NODE_ENV === 'production'
  const provider = env.PASSWORD_RESET_DELIVERY_PROVIDER?.trim().toLowerCase() || 'none'
  if (provider === 'none') {
    if (production) throw new Error('PASSWORD_RESET_DELIVERY_PROVIDER must be configured in production.')
    return { provider: 'none' }
  }
  if (provider !== 'webhook') throw new Error(`Unsupported password reset delivery provider: ${provider}`)
  const webhookUrl = exactHttpsUrl(env.PASSWORD_RESET_WEBHOOK_URL, 'PASSWORD_RESET_WEBHOOK_URL')
  const publicResetUrl = exactHttpsUrl(env.PASSWORD_RESET_PUBLIC_URL, 'PASSWORD_RESET_PUBLIC_URL')
  const bearerToken = env.PASSWORD_RESET_WEBHOOK_BEARER_TOKEN?.trim()
  if (!bearerToken || bearerToken.length < 32) {
    throw new Error('PASSWORD_RESET_WEBHOOK_BEARER_TOKEN must be at least 32 characters.')
  }
  if (production && env.PASSWORD_RESET_EXPOSE_TOKEN?.trim().toLowerCase() === 'true') {
    throw new Error('PASSWORD_RESET_EXPOSE_TOKEN must never be enabled in production.')
  }
  return { provider: 'webhook', webhookUrl, bearerToken, publicResetUrl }
}

export async function deliverPasswordReset(
  config: PasswordResetDeliveryConfig,
  message: PasswordResetDeliveryMessage,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (config.provider === 'none') return
  const resetUrl = new URL(config.publicResetUrl!)
  resetUrl.searchParams.set('token', message.token)
  const response = await fetchImpl(config.webhookUrl!, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.bearerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: message.email, resetUrl: resetUrl.toString(), expiresAt: message.expiresAt }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Password reset delivery failed with status ${response.status}.`)
}
