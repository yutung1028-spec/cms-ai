import {
  ACCESSIBILITY_STATUS_SET,
  DISABLED_FACILITIES_STATUS_SET,
  type AccessibilityStatus,
  type DisabledFacilitiesStatus,
} from '../poi-accessibility-values.ts'
import { parseIso8601WithTimezone } from '../poi-import/validate.ts'
import { MODEL_PARSE_FAILED_TEXT } from './errors.ts'
import { MAX_POI_FROM_TEXT_CHARS } from './limits.ts'
import { emptyPoiFromTextFields, type PoiFromTextFields, type ValidLnglat } from './types.ts'

const ALLOWED_KEYS = new Set([
  'name',
  'nickname',
  'address',
  'lnglat',
  'disabledFacilitiesStatus',
  'accessibilityStatus',
  'accessibilityNotes',
  'accessibilityCheckedAt',
])

const MAX_NAME_CHARS = 200
const MAX_NICKNAME_CHARS = 200
const MAX_ADDRESS_CHARS = 500

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i)
  const body = (fenced ? fenced[1] : trimmed).trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function parseString(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') return null
  if (value.length > max) return null
  return value.trim()
}

function parseLnglat(value: unknown): ValidLnglat | null | undefined {
  if (value === undefined || value === null) return null
  if (!isRecord(value)) return undefined
  const extras = Object.keys(value).filter(key => key !== 'lng' && key !== 'lat')
  if (extras.length) return undefined
  const lng = value.lng
  const lat = value.lat
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) return undefined
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return undefined
  return { lng, lat }
}

export function parseModelDraftFields(
  rawText: unknown
): { ok: true; fields: PoiFromTextFields } | { ok: false; error: string } {
  if (typeof rawText !== 'string') return { ok: false, error: MODEL_PARSE_FAILED_TEXT }
  const record = parseJsonObject(rawText)
  if (!record) return { ok: false, error: MODEL_PARSE_FAILED_TEXT }
  if ('id' in record || 'type' in record) return { ok: false, error: MODEL_PARSE_FAILED_TEXT }
  const extras = Object.keys(record).filter(key => !ALLOWED_KEYS.has(key))
  if (extras.length) return { ok: false, error: MODEL_PARSE_FAILED_TEXT }

  const name = parseString(record.name, MAX_NAME_CHARS)
  const nickname = parseString(record.nickname, MAX_NICKNAME_CHARS)
  const address = parseString(record.address, MAX_ADDRESS_CHARS)
  const notes = parseString(record.accessibilityNotes, MAX_POI_FROM_TEXT_CHARS)
  if (name === null || nickname === null || address === null || notes === null) {
    return { ok: false, error: MODEL_PARSE_FAILED_TEXT }
  }

  const lnglat = parseLnglat(record.lnglat)
  if (lnglat === undefined) return { ok: false, error: MODEL_PARSE_FAILED_TEXT }

  const facilities =
    record.disabledFacilitiesStatus === undefined || record.disabledFacilitiesStatus === null
      ? 'unknown'
      : record.disabledFacilitiesStatus
  if (typeof facilities !== 'string' || !DISABLED_FACILITIES_STATUS_SET.has(facilities)) {
    return { ok: false, error: MODEL_PARSE_FAILED_TEXT }
  }

  const access =
    record.accessibilityStatus === undefined || record.accessibilityStatus === null
      ? 'unknown'
      : record.accessibilityStatus
  if (typeof access !== 'string' || !ACCESSIBILITY_STATUS_SET.has(access)) {
    return { ok: false, error: MODEL_PARSE_FAILED_TEXT }
  }

  let accessibilityCheckedAt = ''
  if (record.accessibilityCheckedAt !== undefined && record.accessibilityCheckedAt !== null && record.accessibilityCheckedAt !== '') {
    const parsed = parseIso8601WithTimezone(record.accessibilityCheckedAt)
    if (!parsed.ok) return { ok: false, error: MODEL_PARSE_FAILED_TEXT }
    accessibilityCheckedAt = parsed.value
  }

  const fields = emptyPoiFromTextFields()
  fields.name = name
  fields.nickname = nickname
  fields.address = address
  fields.lnglat = lnglat
  fields.disabledFacilitiesStatus = facilities as DisabledFacilitiesStatus
  fields.accessibilityStatus = access as AccessibilityStatus
  fields.accessibilityNotes = notes
  fields.accessibilityCheckedAt = accessibilityCheckedAt
  return { ok: true, fields }
}
