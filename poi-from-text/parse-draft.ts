import {
  ACCESSIBILITY_STATUS_SET,
  DISABLED_FACILITIES_STATUS_SET,
  type AccessibilityStatus,
  type DisabledFacilitiesStatus,
} from '../poi-accessibility-values.ts'
import { parseIso8601WithTimezone } from '../poi-import/validate.ts'
import { MAX_POI_FROM_TEXT_CHARS } from './limits.ts'
import {
  emptyPoiFromTextFields,
  type PoiFromTextDraft,
  type PoiType,
  type UnmappedLabel,
  type ValidLnglat,
} from './types.ts'

const FIELD_ALIASES: Record<string, keyof PoiFromTextDraft['fields'] | 'unmapped'> = {
  名稱: 'name',
  name: 'name',
  暱稱: 'nickname',
  nickname: 'nickname',
  地址: 'address',
  address: 'address',
  備註: 'accessibilityNotes',
  無障礙備註: 'accessibilityNotes',
  accessibilitynotes: 'accessibilityNotes',
  notes: 'accessibilityNotes',
  無障礙設施: 'disabledFacilitiesStatus',
  設施狀態: 'disabledFacilitiesStatus',
  disabledfacilitiesstatus: 'disabledFacilitiesStatus',
  無障礙可達性: 'accessibilityStatus',
  可達性: 'accessibilityStatus',
  accessibilitystatus: 'accessibilityStatus',
  最近核實時間: 'accessibilityCheckedAt',
  核實時間: 'accessibilityCheckedAt',
  accessibilitycheckedat: 'accessibilityCheckedAt',
  經緯度: 'lnglat',
  lnglat: 'lnglat',
}

const FACILITY_ALIASES: Record<string, DisabledFacilitiesStatus> = {
  unknown: 'unknown',
  未核實: 'unknown',
  available: 'available',
  有: 'available',
  unavailable: 'unavailable',
  沒有: 'unavailable',
}

const ACCESS_ALIASES: Record<string, AccessibilityStatus> = {
  unknown: 'unknown',
  未核實: 'unknown',
  accessible: 'accessible',
  '可無障礙到達／進入': 'accessible',
  '可無障礙到達/進入': 'accessible',
  partially_accessible: 'partially_accessible',
  有條件或部分可達: 'partially_accessible',
  not_accessible: 'not_accessible',
  '不可無障礙到達／進入': 'not_accessible',
  '不可無障礙到達/進入': 'not_accessible',
}

export type ParseDraftResult =
  | { ok: true; draft: PoiFromTextDraft }
  | { ok: false; error: string }

function isPoiType(value: string): value is PoiType {
  return value === 'occupant' || value === 'amenity'
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase()
}

function parseLnglatLine(value: string): ValidLnglat | null {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/)
  if (!match) return null
  const lng = Number(match[1])
  const lat = Number(match[2])
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null
  return { lng, lat }
}

export function parsePoiFromTextDraft(source: unknown, type: unknown): ParseDraftResult {
  if (typeof source !== 'string') return { ok: false, error: 'source must be a string' }
  if (!isPoiType(String(type))) return { ok: false, error: 'type must be occupant or amenity' }
  const trimmed = source.trim()
  if (trimmed === '') return { ok: false, error: 'source must not be empty' }
  if (trimmed.length > MAX_POI_FROM_TEXT_CHARS) {
    return { ok: false, error: `source must be at most ${MAX_POI_FROM_TEXT_CHARS} characters` }
  }

  const fields = emptyPoiFromTextFields()
  const unmapped: UnmappedLabel[] = []

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') continue
    const labelled = line.match(/^(.+?)[：:]\s*(.*)$/)
    if (!labelled) continue
    const label = labelled[1].trim()
    const value = labelled[2].trim()
    if (value === '') continue
    const alias = FIELD_ALIASES[normalizeLabel(label)] ?? FIELD_ALIASES[label]
    if (!alias) {
      unmapped.push({ label, value, reason: '此標籤不是現有 POI 欄位' })
      continue
    }
    if (alias === 'unmapped') {
      unmapped.push({ label, value, reason: '現有 Occupant／Amenity 沒有此欄位，未寫入草稿' })
      continue
    }
    if (alias === 'name') fields.name = value
    if (alias === 'nickname') fields.nickname = value
    if (alias === 'address') fields.address = value
    if (alias === 'accessibilityNotes') fields.accessibilityNotes = value
    if (alias === 'disabledFacilitiesStatus') {
      const mapped = FACILITY_ALIASES[value]
      if (!mapped || !DISABLED_FACILITIES_STATUS_SET.has(mapped)) {
        unmapped.push({ label, value, reason: '無法對應無障礙設施列舉值，維持未核實' })
      } else {
        fields.disabledFacilitiesStatus = mapped
      }
    }
    if (alias === 'accessibilityStatus') {
      const mapped = ACCESS_ALIASES[value]
      if (!mapped || !ACCESSIBILITY_STATUS_SET.has(mapped)) {
        unmapped.push({ label, value, reason: '無法對應可達性列舉值，維持未核實' })
      } else {
        fields.accessibilityStatus = mapped
      }
    }
    if (alias === 'accessibilityCheckedAt') {
      const parsed = parseIso8601WithTimezone(value)
      if (!parsed.ok) {
        unmapped.push({ label, value, reason: '核實時間必須是含時區的 ISO 8601，未寫入' })
      } else {
        fields.accessibilityCheckedAt = parsed.value
      }
    }
    if (alias === 'lnglat') {
      const coords = parseLnglatLine(value)
      if (!coords) {
        unmapped.push({ label, value, reason: '經緯度需為 lng, lat 數字，未寫入' })
      } else {
        fields.lnglat = coords
      }
    }
  }

  return {
    ok: true,
    draft: {
      source,
      type,
      fields,
      unmapped,
      parser: 'phase-one-demo',
    },
  }
}
