import {
  ACCESSIBILITY_STATUS_SET,
  DISABLED_FACILITIES_STATUS_SET,
} from '../poi-accessibility-values.ts'

export const MAX_SEARCH_TAKE = 20
export const DEFAULT_SEARCH_TAKE = 10
export const MAX_SEARCH_SKIP = 10_000
export const MAX_QUERY_LENGTH = 200

export type PoiListType = 'occupant' | 'amenity'

const SEARCH_KEYS = new Set([
  'query',
  'type',
  'disabledFacilitiesStatus',
  'accessibilityStatus',
  'notesKeyword',
  'checkedBefore',
  'uncheckedOnly',
  'take',
  'skip',
])
const GET_KEYS = new Set(['type', 'id'])

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/

export type SearchPoisArgs = {
  query?: string
  type?: PoiListType
  disabledFacilitiesStatus?: string
  accessibilityStatus?: string
  notesKeyword?: string
  checkedBefore?: string
  uncheckedOnly: boolean
  take: number
  skip: number
}

export type GetPoiArgs = {
  type: PoiListType
  id: string
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

function unknownKeys(record: Record<string, unknown>, allowed: Set<string>): string[] {
  return Object.keys(record).filter(key => !allowed.has(key))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseOptionalEnum(field: string, value: unknown, allowed: Set<string>): ParseResult<string | undefined> {
  if (value === undefined) return { ok: true, value: undefined }
  if (typeof value !== 'string' || value === '' || !allowed.has(value)) {
    return { ok: false, error: `${field} must be one of: ${[...allowed].join(', ')}` }
  }
  return { ok: true, value }
}

function parseOptionalType(value: unknown): ParseResult<PoiListType | undefined> {
  if (value === undefined) return { ok: true, value: undefined }
  if (value !== 'occupant' && value !== 'amenity') {
    return { ok: false, error: 'type must be "occupant" or "amenity"' }
  }
  return { ok: true, value }
}

function parseOptionalTrimmedString(field: string, value: unknown, maxLength: number): ParseResult<string | undefined> {
  if (value === undefined) return { ok: true, value: undefined }
  if (typeof value !== 'string') return { ok: false, error: `${field} must be a string` }
  const trimmed = value.trim()
  if (trimmed.length > maxLength) {
    return { ok: false, error: `${field} must be at most ${maxLength} characters` }
  }
  return { ok: true, value: trimmed === '' ? undefined : trimmed }
}

function parseCheckedBefore(value: unknown): ParseResult<string | undefined> {
  if (value === undefined) return { ok: true, value: undefined }
  if (typeof value !== 'string' || value.trim() === '') {
    return { ok: false, error: 'checkedBefore must be an ISO date or date-time' }
  }
  const raw = value.trim()
  const dateOnly = DATE_ONLY.exec(raw)
  if (dateOnly) {
    const iso = `${raw}T00:00:00.000Z`
    const parsed = Date.parse(iso)
    if (Number.isNaN(parsed)) return { ok: false, error: 'checkedBefore is not a valid date' }
    return { ok: true, value: iso }
  }
  if (!ISO_DATE_TIME.test(raw)) {
    return { ok: false, error: 'checkedBefore must be an ISO date or date-time' }
  }
  const parsed = Date.parse(raw)
  if (Number.isNaN(parsed)) return { ok: false, error: 'checkedBefore is not a valid date' }
  return { ok: true, value: new Date(parsed).toISOString() }
}

function parseOptionalBoolean(field: string, value: unknown): ParseResult<boolean> {
  if (value === undefined) return { ok: true, value: false }
  if (typeof value !== 'boolean') return { ok: false, error: `${field} must be a boolean` }
  return { ok: true, value }
}

function parseInteger(field: string, value: unknown, fallback: number, min: number, max: number): ParseResult<number> {
  if (value === undefined) return { ok: true, value: fallback }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return { ok: false, error: `${field} must be an integer` }
  }
  if (value < min || value > max) {
    return { ok: false, error: `${field} must be between ${min} and ${max}` }
  }
  return { ok: true, value }
}

export function parseSearchPoisArgs(raw: unknown): ParseResult<SearchPoisArgs> {
  if (!isRecord(raw)) return { ok: false, error: 'Arguments must be an object' }
  const extras = unknownKeys(raw, SEARCH_KEYS)
  if (extras.length) return { ok: false, error: `Unknown field "${extras[0]}"` }

  const query = parseOptionalTrimmedString('query', raw.query, MAX_QUERY_LENGTH)
  if (!query.ok) return query
  const notesKeyword = parseOptionalTrimmedString('notesKeyword', raw.notesKeyword, MAX_QUERY_LENGTH)
  if (!notesKeyword.ok) return notesKeyword
  const checkedBefore = parseCheckedBefore(raw.checkedBefore)
  if (!checkedBefore.ok) return checkedBefore
  const uncheckedOnly = parseOptionalBoolean('uncheckedOnly', raw.uncheckedOnly)
  if (!uncheckedOnly.ok) return uncheckedOnly
  if (uncheckedOnly.value && checkedBefore.value) {
    return { ok: false, error: 'uncheckedOnly cannot be combined with checkedBefore' }
  }

  const type = parseOptionalType(raw.type)
  if (!type.ok) return type
  const facilities = parseOptionalEnum(
    'disabledFacilitiesStatus',
    raw.disabledFacilitiesStatus,
    DISABLED_FACILITIES_STATUS_SET
  )
  if (!facilities.ok) return facilities
  const access = parseOptionalEnum('accessibilityStatus', raw.accessibilityStatus, ACCESSIBILITY_STATUS_SET)
  if (!access.ok) return access
  const take = parseInteger('take', raw.take, DEFAULT_SEARCH_TAKE, 1, MAX_SEARCH_TAKE)
  if (!take.ok) return take
  const skip = parseInteger('skip', raw.skip, 0, 0, MAX_SEARCH_SKIP)
  if (!skip.ok) return skip

  return {
    ok: true,
    value: {
      query: query.value,
      type: type.value,
      disabledFacilitiesStatus: facilities.value,
      accessibilityStatus: access.value,
      notesKeyword: notesKeyword.value,
      checkedBefore: checkedBefore.value,
      uncheckedOnly: uncheckedOnly.value,
      take: take.value,
      skip: skip.value,
    },
  }
}

export function parseGetPoiArgs(raw: unknown): ParseResult<GetPoiArgs> {
  if (!isRecord(raw)) return { ok: false, error: 'Arguments must be an object' }
  const extras = unknownKeys(raw, GET_KEYS)
  if (extras.length) return { ok: false, error: `Unknown field "${extras[0]}"` }
  if (raw.type !== 'occupant' && raw.type !== 'amenity') {
    return { ok: false, error: 'type must be "occupant" or "amenity"' }
  }
  if (typeof raw.id !== 'string' || raw.id.trim() === '') {
    return { ok: false, error: 'id must be a non-empty string' }
  }
  return { ok: true, value: { type: raw.type, id: raw.id.trim() } }
}
