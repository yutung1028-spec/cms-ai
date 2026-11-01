import { group } from '@keystone-6/core'
import { select, text, timestamp } from '@keystone-6/core/fields'

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

const ACCESSIBILITY_GROUP_DESCRIPTION =
  '輪椅／行動不便人士的人工紀錄：是否有設施、以及是否可到達或進入。兩項獨立，互不推斷。這不是對所有殘疾類別的判定，也不是法規符合性或認證。未核實請保持「未核實」。若可達性為有條件或部分可達、或不可達，建議填寫無障礙備註。'

export function poiAccessibilityFields() {
  return group({
    label: '無障礙資訊',
    description: ACCESSIBILITY_GROUP_DESCRIPTION,
    fields: {
      disabledFacilitiesStatus: select({
        type: 'enum',
        options: [
          { label: '未核實', value: 'unknown' },
          { label: '有', value: 'available' },
          { label: '沒有', value: 'unavailable' },
        ],
        defaultValue: 'unknown',
        validation: { isRequired: true },
        ui: {
          label: '無障礙設施',
          description: '此地點是否有無障礙設施。有設施不代表一定可無障礙到達；沒有特別設施也不代表一定不可到達。未核實請選擇「未核實」，不要改成「沒有」。',
          displayMode: 'select',
        },
      }),
      accessibilityStatus: select({
        type: 'enum',
        options: [
          { label: '未核實', value: 'unknown' },
          { label: '可無障礙到達／進入', value: 'accessible' },
          { label: '有條件或部分可達', value: 'partially_accessible' },
          { label: '不可無障礙到達／進入', value: 'not_accessible' },
        ],
        defaultValue: 'unknown',
        validation: { isRequired: true },
        ui: {
          label: '無障礙可達性',
          description:
            '輪椅／行動不便人士能否到達或進入。這不是全面殘疾分類，也不是認證。選「有條件或部分可達」或「不可無障礙到達／進入」時，建議在無障礙備註說明限制（第一版不強制）。未核實請選擇「未核實」。',
          displayMode: 'select',
        },
      }),
      accessibilityNotes: text({
        ui: {
          label: '無障礙備註',
          displayMode: 'textarea',
          description: '例如側門才有無梯級入口、需要職員協助、部分區域有梯級、設施暫停使用，或其他限制與核實來源。',
        },
      }),
      accessibilityCheckedAt: timestamp({
        ui: {
          label: '最近核實時間',
          description: '上次核實無障礙資料的時間。修改名稱等其他欄位時不會自動更新。',
        },
      }),
    },
  })
}
