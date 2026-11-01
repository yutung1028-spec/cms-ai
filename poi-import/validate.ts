import {
  ACCESSIBILITY_STATUS_SET,
  DISABLED_FACILITIES_STATUS_SET,
  type AccessibilityStatus,
  type DisabledFacilitiesStatus,
} from '../poi-accessibility-values.ts'

export const MAX_POI_IMPORT_BYTES = 1024 * 1024
export const MAX_POI_IMPORT_ITEMS = 500

const ROOT_KEYS = new Set(['version', 'pois'])
const ITEM_KEYS = new Set([
  'type',
  'name',
  'nickname',
  'lnglat',
  'disabledFacilitiesStatus',
  'accessibilityStatus',
  'accessibilityNotes',
  'accessibilityCheckedAt',
])
const LNGLAT_KEYS = new Set(['lng', 'lat'])
const ISO_8601_WITH_TIMEZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

export type PoiType = 'occupant' | 'amenity'

export type ValidLnglat = {
  lng: number
  lat: number
}

export type ValidPoi = {
  type: PoiType
  name: string
  nickname?: string
  lnglat?: ValidLnglat
  disabledFacilitiesStatus: DisabledFacilitiesStatus
  accessibilityStatus: AccessibilityStatus
  accessibilityNotes?: string
  accessibilityCheckedAt?: string
}

export type PoiImportItemPreview = {
  index: number
  type: string
  name: string
  nickname: string
  lnglat: ValidLnglat | null
  disabledFacilitiesStatus: string
  accessibilityStatus: string
  accessibilityNotes: string
  accessibilityCheckedAt: string
  errors: string[]
}

export type PoiImportSummary = {
  total: number
  occupant: number
  amenity: number
  valid: number
  invalid: number
}

export type MappedPoiCreate = {
  name: string
  nickname: string
  lnglat?: ValidLnglat
  disabledFacilitiesStatus: DisabledFacilitiesStatus
  accessibilityStatus: AccessibilityStatus
  accessibilityNotes: string
  accessibilityCheckedAt?: string
}

type ValidatedItem = {
  index: number
  value: ValidPoi
}

export type PoiImportParseResult = {
  ok: boolean
  error: string | null
  items: ValidatedItem[]
  previews: PoiImportItemPreview[]
  summary: PoiImportSummary
}

function emptySummary(): PoiImportSummary {
  return { total: 0, occupant: 0, amenity: 0, valid: 0, invalid: 0 }
}

function failDocument(error: string, extras?: Partial<PoiImportParseResult>): PoiImportParseResult {
  return {
    ok: false,
    error,
    items: [],
    previews: [],
    summary: emptySummary(),
    ...extras,
  }
}

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

function unknownKeys(value: Record<string, unknown>, allowed: Set<string>): string[] {
  return Object.keys(value).filter(key => !allowed.has(key))
}

function previewFromRaw(index: number, raw: unknown, errors: string[]): PoiImportItemPreview {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const lnglat =
    record.lnglat && typeof record.lnglat === 'object' && !Array.isArray(record.lnglat)
      ? (record.lnglat as Record<string, unknown>)
      : null

  const lng = lnglat && typeof lnglat.lng === 'number' ? lnglat.lng : Number.NaN
  const lat = lnglat && typeof lnglat.lat === 'number' ? lnglat.lat : Number.NaN

  return {
    index,
    type: typeof record.type === 'string' ? record.type : '',
    name: typeof record.name === 'string' ? record.name : '',
    nickname: typeof record.nickname === 'string' ? record.nickname : '',
    lnglat: Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null,
    disabledFacilitiesStatus:
      typeof record.disabledFacilitiesStatus === 'string' ? record.disabledFacilitiesStatus : '',
    accessibilityStatus: typeof record.accessibilityStatus === 'string' ? record.accessibilityStatus : '',
    accessibilityNotes: typeof record.accessibilityNotes === 'string' ? record.accessibilityNotes : '',
    accessibilityCheckedAt:
      typeof record.accessibilityCheckedAt === 'string' ? record.accessibilityCheckedAt : '',
    errors,
  }
}

function validateEnumStatus(
  field: string,
  value: unknown,
  allowed: Set<string>
): { ok: true; value: string } | { ok: false; errors: string[] } {
  if (value === undefined) return { ok: true, value: 'unknown' }
  if (typeof value !== 'string' || value === '') {
    return { ok: false, errors: [`${field} must be one of: ${[...allowed].join(', ')}`] }
  }
  if (!allowed.has(value)) {
    return { ok: false, errors: [`${field} must be one of: ${[...allowed].join(', ')}`] }
  }
  return { ok: true, value }
}

export function parseIso8601WithTimezone(value: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== 'string' || value === '') {
    return { ok: false, error: 'accessibilityCheckedAt must be an ISO 8601 datetime with a timezone' }
  }
  if (!ISO_8601_WITH_TIMEZONE.test(value) || !Number.isFinite(Date.parse(value))) {
    return { ok: false, error: 'accessibilityCheckedAt must be an ISO 8601 datetime with a timezone' }
  }
  return { ok: true, value }
}

function validateLnglat(value: unknown): { ok: true; value: ValidLnglat } | { ok: false; errors: string[] } {
  if (value === undefined) {
    return { ok: true, value: undefined as unknown as ValidLnglat }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['lnglat must be an object with lng and lat'] }
  }

  const record = value as Record<string, unknown>
  const extras = unknownKeys(record, LNGLAT_KEYS)
  const errors: string[] = extras.map(key => `Unknown lnglat field "${key}"`)

  const lng = record.lng
  const lat = record.lat
  if (typeof lng !== 'number' || !Number.isFinite(lng)) {
    errors.push('lnglat.lng must be a finite number')
  } else if (lng < -180 || lng > 180) {
    errors.push('lnglat.lng must be between -180 and 180')
  }
  if (typeof lat !== 'number' || !Number.isFinite(lat)) {
    errors.push('lnglat.lat must be a finite number')
  } else if (lat < -90 || lat > 90) {
    errors.push('lnglat.lat must be between -90 and 90')
  }

  if (errors.length) return { ok: false, errors }
  return { ok: true, value: { lng: lng as number, lat: lat as number } }
}

function validateItem(index: number, raw: unknown): { preview: PoiImportItemPreview; value?: ValidPoi } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      preview: {
        index,
        type: '',
        name: '',
        nickname: '',
        lnglat: null,
        disabledFacilitiesStatus: '',
        accessibilityStatus: '',
        accessibilityNotes: '',
        accessibilityCheckedAt: '',
        errors: ['Item must be a non-null object'],
      },
    }
  }

  const record = raw as Record<string, unknown>
  const errors = unknownKeys(record, ITEM_KEYS).map(key => `Unknown field "${key}"`)

  const type = record.type
  if (type !== 'occupant' && type !== 'amenity') {
    errors.push('type must be "occupant" or "amenity"')
  }

  if (typeof record.name !== 'string') {
    errors.push('name must be a string')
  } else if (record.name.trim() === '') {
    errors.push('name must be a non-empty string')
  }

  if (record.nickname !== undefined && typeof record.nickname !== 'string') {
    errors.push('nickname must be a string when provided')
  }

  let lnglat: ValidLnglat | undefined
  if (record.lnglat !== undefined) {
    const result = validateLnglat(record.lnglat)
    if (!result.ok) errors.push(...result.errors)
    else lnglat = result.value
  }

  const facilities = validateEnumStatus(
    'disabledFacilitiesStatus',
    record.disabledFacilitiesStatus,
    DISABLED_FACILITIES_STATUS_SET
  )
  if (!facilities.ok) errors.push(...facilities.errors)

  const access = validateEnumStatus('accessibilityStatus', record.accessibilityStatus, ACCESSIBILITY_STATUS_SET)
  if (!access.ok) errors.push(...access.errors)

  if (record.accessibilityNotes !== undefined && typeof record.accessibilityNotes !== 'string') {
    errors.push('accessibilityNotes must be a string when provided')
  }

  let accessibilityCheckedAt: string | undefined
  if (record.accessibilityCheckedAt !== undefined) {
    const checked = parseIso8601WithTimezone(record.accessibilityCheckedAt)
    if (!checked.ok) errors.push(checked.error)
    else accessibilityCheckedAt = checked.value
  }

  const preview = previewFromRaw(index, raw, errors)
  if (errors.length) return { preview }

  const value: ValidPoi = {
    type,
    name: (record.name as string).trim(),
    disabledFacilitiesStatus: facilities.ok
      ? (facilities.value as DisabledFacilitiesStatus)
      : 'unknown',
    accessibilityStatus: access.ok ? (access.value as AccessibilityStatus) : 'unknown',
  }
  if (typeof record.nickname === 'string') value.nickname = record.nickname
  if (lnglat) value.lnglat = lnglat
  if (typeof record.accessibilityNotes === 'string') value.accessibilityNotes = record.accessibilityNotes
  if (accessibilityCheckedAt) value.accessibilityCheckedAt = accessibilityCheckedAt
  return { preview, value }
}

export function validatePoiImportDocument(data: unknown): PoiImportParseResult {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return failDocument('Root value must be a JSON object')
  }

  const record = data as Record<string, unknown>
  const extras = unknownKeys(record, ROOT_KEYS)
  if (extras.length) {
    return failDocument(`Unknown field "${extras[0]}"`)
  }

  if (record.version !== 1) {
    return failDocument('version must be 1')
  }

  if (!Array.isArray(record.pois)) {
    return failDocument('pois must be a non-empty array')
  }
  if (record.pois.length === 0) {
    return failDocument('pois must be a non-empty array')
  }
  if (record.pois.length > MAX_POI_IMPORT_ITEMS) {
    return failDocument(`pois must contain at most ${MAX_POI_IMPORT_ITEMS} items`)
  }

  const previews: PoiImportItemPreview[] = []
  const items: ValidatedItem[] = []
  const summary = emptySummary()
  summary.total = record.pois.length

  record.pois.forEach((raw, index) => {
    const result = validateItem(index, raw)
    previews.push(result.preview)
    if (result.value) {
      items.push({ index, value: result.value })
      summary.valid += 1
      if (result.value.type === 'occupant') summary.occupant += 1
      else summary.amenity += 1
    } else {
      summary.invalid += 1
      if (result.preview.type === 'occupant') summary.occupant += 1
      if (result.preview.type === 'amenity') summary.amenity += 1
    }
  })

  if (summary.invalid > 0) {
    return {
      ok: false,
      error: 'One or more POIs failed validation',
      items: [],
      previews,
      summary,
    }
  }

  return {
    ok: true,
    error: null,
    items,
    previews,
    summary,
  }
}

export function parsePoiImportJson(text: string): PoiImportParseResult {
  if (typeof text !== 'string') {
    return failDocument('Payload must be a JSON string')
  }
  if (utf8ByteLength(text) > MAX_POI_IMPORT_BYTES) {
    return failDocument(`Payload must be at most ${MAX_POI_IMPORT_BYTES} bytes`)
  }

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return failDocument('Payload is not valid JSON')
  }

  return validatePoiImportDocument(data)
}

export function mapPoiCreateData(poi: ValidPoi): MappedPoiCreate {
  const data: MappedPoiCreate = {
    name: poi.name,
    nickname: poi.nickname ?? '',
    disabledFacilitiesStatus: poi.disabledFacilitiesStatus,
    accessibilityStatus: poi.accessibilityStatus,
    accessibilityNotes: poi.accessibilityNotes ?? '',
  }
  if (poi.lnglat) data.lnglat = { lng: poi.lnglat.lng, lat: poi.lnglat.lat }
  if (poi.accessibilityCheckedAt) data.accessibilityCheckedAt = poi.accessibilityCheckedAt
  return data
}
