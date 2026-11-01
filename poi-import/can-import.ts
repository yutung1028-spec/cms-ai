import { isAllowedImporterEmail } from './allowed-importers.ts'

type SessionLike = {
  itemId?: unknown
  data?: {
    email?: unknown
  }
}

export function canImportPois(session: unknown): boolean {
  if (!session || typeof session !== 'object') return false
  const value = session as SessionLike
  if (typeof value.itemId !== 'string' || value.itemId === '') return false
  return isAllowedImporterEmail(value.data?.email)
}

export function importPoisAuthError(session: unknown): string | null {
  if (!session || typeof session !== 'object') return 'Authentication required'
  const value = session as SessionLike
  if (typeof value.itemId !== 'string' || value.itemId === '') return 'Authentication required'
  if (!isAllowedImporterEmail(value.data?.email)) return 'Not authorised to import POIs'
  return null
}
