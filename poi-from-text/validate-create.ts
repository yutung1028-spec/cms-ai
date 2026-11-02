import {
  ACCESSIBILITY_STATUS_SET,
  DISABLED_FACILITIES_STATUS_SET,
  type AccessibilityStatus,
  type DisabledFacilitiesStatus,
} from '../poi-accessibility-values.ts'
import { parseIso8601WithTimezone, type PoiType, type ValidPoi } from '../poi-import/validate.ts'

const CREATE_KEYS = new Set([
  'type',
  'name',
  'nickname',
  'address',
  'lnglat',
  'disabledFacilitiesStatus',
  'accessibilityStatus',
  'accessibilityNotes',
  'accessibilityCheckedAt',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseCreatePoiFromTextInput(
  raw: unknown
): { ok: true; value: ValidPoi } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: 'Arguments must be an object' }
  if ('id' in raw) return { ok: false, error: 'id is not allowed' }
  const extras = Object.keys(raw).filter(key => !CREATE_KEYS.has(key))
  if (extras.length) return { ok: false, error: `Unknown field "${extras[0]}"` }
  if (raw.type !== 'occupant' && raw.type !== 'amenity') {
    return { ok: false, error: 'type must be occupant or amenity' }
  }
  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    return { ok: false, error: 'name is required' }
  }
  const nickname = raw.nickname === undefined ? '' : raw.nickname
  if (typeof nickname !== 'string') return { ok: false, error: 'nickname must be a string' }
  const address = raw.address === undefined ? '' : raw.address
  if (typeof address !== 'string') return { ok: false, error: 'address must be a string' }
  const notes = raw.accessibilityNotes === undefined ? '' : raw.accessibilityNotes
  if (typeof notes !== 'string') return { ok: false, error: 'accessibilityNotes must be a string' }

  let lnglat: ValidPoi['lnglat']
  if (raw.lnglat !== undefined && raw.lnglat !== null) {
    if (!isRecord(raw.lnglat)) return { ok: false, error: 'lnglat must be an object with lng and lat' }
    const lng = raw.lnglat.lng
    const lat = raw.lnglat.lat
    if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return { ok: false, error: 'lnglat.lng must be a finite number between -180 and 180' }
    }
    if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      return { ok: false, error: 'lnglat.lat must be a finite number between -90 and 90' }
    }
    lnglat = { lng, lat }
  }

  const facilities =
    raw.disabledFacilitiesStatus === undefined ? 'unknown' : raw.disabledFacilitiesStatus
  if (typeof facilities !== 'string' || !DISABLED_FACILITIES_STATUS_SET.has(facilities)) {
    return { ok: false, error: 'disabledFacilitiesStatus is invalid' }
  }
  const access = raw.accessibilityStatus === undefined ? 'unknown' : raw.accessibilityStatus
  if (typeof access !== 'string' || !ACCESSIBILITY_STATUS_SET.has(access)) {
    return { ok: false, error: 'accessibilityStatus is invalid' }
  }

  let accessibilityCheckedAt: string | undefined
  if (raw.accessibilityCheckedAt !== undefined && raw.accessibilityCheckedAt !== '') {
    const parsed = parseIso8601WithTimezone(raw.accessibilityCheckedAt)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    accessibilityCheckedAt = parsed.value
  }

  const value: ValidPoi = {
    type: raw.type as PoiType,
    name: raw.name.trim(),
    nickname: nickname.trim(),
    address: address.trim(),
    disabledFacilitiesStatus: facilities as DisabledFacilitiesStatus,
    accessibilityStatus: access as AccessibilityStatus,
    accessibilityNotes: notes,
  }
  if (lnglat) value.lnglat = lnglat
  if (accessibilityCheckedAt) value.accessibilityCheckedAt = accessibilityCheckedAt
  return { ok: true, value }
}
