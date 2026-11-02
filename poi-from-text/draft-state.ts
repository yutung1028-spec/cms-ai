import { POI_FROM_TEXT_DRAFT_STORAGE_KEY } from './limits.ts'
import type { PoiFromTextDraft, PoiType } from './types.ts'

export type DraftStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPoiType(value: unknown): value is PoiType {
  return value === 'occupant' || value === 'amenity'
}

export function parseStoredDraft(raw: unknown): PoiFromTextDraft | null {
  if (!isRecord(raw)) return null
  if (raw.parser !== 'phase-one-demo' && raw.parser !== 'dsh-extract') return null
  if (typeof raw.source !== 'string' || !isPoiType(raw.type)) return null
  if (!isRecord(raw.fields)) return null
  const fields = raw.fields
  const lnglat =
    fields.lnglat === null
      ? null
      : isRecord(fields.lnglat) &&
          typeof fields.lnglat.lng === 'number' &&
          typeof fields.lnglat.lat === 'number'
        ? { lng: fields.lnglat.lng, lat: fields.lnglat.lat }
        : null
  if (fields.lnglat !== null && lnglat === null) return null
  if (typeof fields.name !== 'string') return null
  if (typeof fields.nickname !== 'string') return null
  if (typeof fields.address !== 'string') return null
  if (fields.disabledFacilitiesStatus !== 'unknown' && fields.disabledFacilitiesStatus !== 'available' && fields.disabledFacilitiesStatus !== 'unavailable') {
    return null
  }
  if (
    fields.accessibilityStatus !== 'unknown' &&
    fields.accessibilityStatus !== 'accessible' &&
    fields.accessibilityStatus !== 'partially_accessible' &&
    fields.accessibilityStatus !== 'not_accessible'
  ) {
    return null
  }
  if (typeof fields.accessibilityNotes !== 'string') return null
  if (typeof fields.accessibilityCheckedAt !== 'string') return null
  const unmapped = Array.isArray(raw.unmapped)
    ? raw.unmapped.flatMap(item => {
        if (!isRecord(item) || typeof item.label !== 'string' || typeof item.value !== 'string' || typeof item.reason !== 'string') {
          return []
        }
        return [{ label: item.label, value: item.value, reason: item.reason }]
      })
    : []
  return {
    source: raw.source,
    type: raw.type,
    parser: raw.parser,
    unmapped,
    fields: {
      name: fields.name,
      nickname: fields.nickname,
      address: fields.address,
      lnglat,
      disabledFacilitiesStatus: fields.disabledFacilitiesStatus,
      accessibilityStatus: fields.accessibilityStatus,
      accessibilityNotes: fields.accessibilityNotes,
      accessibilityCheckedAt: fields.accessibilityCheckedAt,
    },
  }
}

export function loadDraft(storage: DraftStorage | null | undefined): PoiFromTextDraft | null {
  if (!storage) return null
  try {
    const text = storage.getItem(POI_FROM_TEXT_DRAFT_STORAGE_KEY)
    if (!text) return null
    return parseStoredDraft(JSON.parse(text))
  } catch {
    return null
  }
}

export function saveDraft(storage: DraftStorage | null | undefined, draft: PoiFromTextDraft): void {
  if (!storage) return
  storage.setItem(POI_FROM_TEXT_DRAFT_STORAGE_KEY, JSON.stringify(draft))
}

export function clearDraft(storage: DraftStorage | null | undefined): void {
  if (!storage) return
  storage.removeItem(POI_FROM_TEXT_DRAFT_STORAGE_KEY)
}

export function browserDraftStorage(): DraftStorage | null {
  if (typeof sessionStorage === 'undefined') return null
  return sessionStorage
}

export function isCreateSubmitDisabled(pending: boolean, name: string): boolean {
  return pending || name.trim() === ''
}
