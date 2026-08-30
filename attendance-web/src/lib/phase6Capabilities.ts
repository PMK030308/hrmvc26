export function phase6Capabilities(effectivePermissions: readonly string[]) {
  const permissions = new Set(effectivePermissions)
  return { canUseChatbot: permissions.has('chatbot.use') }
}
