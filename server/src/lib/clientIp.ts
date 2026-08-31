export function getClientIp(request: { ip?: string }): string {
  return request.ip ?? ''
}
