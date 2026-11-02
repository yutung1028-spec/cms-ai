import type { AccessibilityStatus, DisabledFacilitiesStatus } from '../poi-accessibility-values.ts'
import type { PoiType, ValidLnglat } from '../poi-import/validate.ts'

export type { PoiType, ValidLnglat }

export type PoiFromTextFields = {
  name: string
  nickname: string
  address: string
  lnglat: ValidLnglat | null
  disabledFacilitiesStatus: DisabledFacilitiesStatus
  accessibilityStatus: AccessibilityStatus
  accessibilityNotes: string
  accessibilityCheckedAt: string
}

export type UnmappedLabel = {
  label: string
  value: string
  reason: string
}

export type PoiFromTextDraft = {
  source: string
  type: PoiType
  fields: PoiFromTextFields
  unmapped: UnmappedLabel[]
  parser: 'phase-one-demo'
}

export function emptyPoiFromTextFields(): PoiFromTextFields {
  return {
    name: '',
    nickname: '',
    address: '',
    lnglat: null,
    disabledFacilitiesStatus: 'unknown',
    accessibilityStatus: 'unknown',
    accessibilityNotes: '',
    accessibilityCheckedAt: '',
  }
}
