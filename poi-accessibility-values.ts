export const DISABLED_FACILITIES_STATUS_VALUES = ['unknown', 'available', 'unavailable'] as const
export type DisabledFacilitiesStatus = (typeof DISABLED_FACILITIES_STATUS_VALUES)[number]

export const ACCESSIBILITY_STATUS_VALUES = [
  'unknown',
  'accessible',
  'partially_accessible',
  'not_accessible',
] as const
export type AccessibilityStatus = (typeof ACCESSIBILITY_STATUS_VALUES)[number]

export const DISABLED_FACILITIES_STATUS_SET = new Set<string>(DISABLED_FACILITIES_STATUS_VALUES)
export const ACCESSIBILITY_STATUS_SET = new Set<string>(ACCESSIBILITY_STATUS_VALUES)
