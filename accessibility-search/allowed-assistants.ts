/**
 * Server-side allowlist for the accessibility search assistant only.
 * Does not change CMS login or other page access.
 *
 * Installed DSH versions for C1 (no real model calls):
 * - @deepseek-ai/dsh-sdk-client@0.2.1-rc.5
 * - @deepseek-ai/dsh@0.2.1-rc.5
 */
export const ACCESSIBILITY_ASSISTANT_ALLOWED_EMAILS: ReadonlySet<string> = new Set([
  'admin@example.com',
])

export function isAllowedAssistantEmail(email: unknown): boolean {
  return typeof email === 'string' && ACCESSIBILITY_ASSISTANT_ALLOWED_EMAILS.has(email)
}
