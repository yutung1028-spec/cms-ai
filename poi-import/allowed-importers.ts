/**
 * User.email values allowed to call importPois.
 * Having a session is not enough; add the exact login email, then sign in again.
 */
export const POI_IMPORT_ALLOWED_EMAILS: ReadonlySet<string> = new Set([
  'admin@example.com',
])

export function isAllowedImporterEmail(email: unknown): boolean {
  return typeof email === 'string' && POI_IMPORT_ALLOWED_EMAILS.has(email)
}
