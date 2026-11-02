import { useEffect, useState } from 'react'
import { gql, useMutation } from '@keystone-6/core/admin-ui/apollo'
import { PageContainer } from '@keystone-6/core/admin-ui/components'
import { Button } from '@keystar/ui/button'
import { VStack } from '@keystar/ui/layout'
import { Heading, Text } from '@keystar/ui/typography'
import {
  ACCESSIBILITY_STATUS_VALUES,
  DISABLED_FACILITIES_STATUS_VALUES,
} from '../../poi-accessibility-values.ts'
import {
  browserDraftStorage,
  clearDraft,
  isCreateSubmitDisabled,
  loadDraft,
  saveDraft,
} from '../../poi-from-text/draft-state.ts'
import type { PoiFromTextDraft, PoiFromTextFields } from '../../poi-from-text/types.ts'

const CREATE_POI = gql`
  mutation CreatePoiFromTextDraft(
    $type: String!
    $name: String!
    $nickname: String
    $address: String
    $lng: Float
    $lat: Float
    $disabledFacilitiesStatus: String
    $accessibilityStatus: String
    $accessibilityNotes: String
    $accessibilityCheckedAt: String
  ) {
    createPoiFromTextDraft(
      type: $type
      name: $name
      nickname: $nickname
      address: $address
      lng: $lng
      lat: $lat
      disabledFacilitiesStatus: $disabledFacilitiesStatus
      accessibilityStatus: $accessibilityStatus
      accessibilityNotes: $accessibilityNotes
      accessibilityCheckedAt: $accessibilityCheckedAt
    ) {
      ok
      error
      type
      id
      adminPath
    }
  }
`

type CreateResult = {
  createPoiFromTextDraft: {
    ok: boolean
    error: string | null
    type: string | null
    id: string | null
    adminPath: string | null
  }
}

function formatLnglat(value: PoiFromTextFields['lnglat']): string {
  if (!value) return ''
  return `${value.lng}, ${value.lat}`
}

function parseLnglatInput(value: string): PoiFromTextFields['lnglat'] {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const match = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/)
  if (!match) return null
  return { lng: Number(match[1]), lat: Number(match[2]) }
}

export default function PoiFromTextConfirmPage() {
  const [draft, setDraft] = useState<PoiFromTextDraft | null>(null)
  const [ready, setReady] = useState(false)
  const [lnglatText, setLnglatText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [createdPath, setCreatedPath] = useState<string | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [createPoi, { loading }] = useMutation<CreateResult>(CREATE_POI)

  useEffect(() => {
    const loaded = loadDraft(browserDraftStorage())
    setDraft(loaded)
    setLnglatText(loaded ? formatLnglat(loaded.fields.lnglat) : '')
    setReady(true)
  }, [])

  function updateFields(patch: Partial<PoiFromTextFields>) {
    if (!draft) return
    const next = { ...draft, fields: { ...draft.fields, ...patch } }
    setDraft(next)
    saveDraft(browserDraftStorage(), next)
  }

  async function onCreate() {
    if (!draft || isCreateSubmitDisabled(loading, draft.fields.name)) return
    setError(null)
    try {
      const response = await createPoi({
        variables: {
          type: draft.type,
          name: draft.fields.name,
          nickname: draft.fields.nickname,
          address: draft.fields.address,
          lng: draft.fields.lnglat?.lng ?? null,
          lat: draft.fields.lnglat?.lat ?? null,
          disabledFacilitiesStatus: draft.fields.disabledFacilitiesStatus,
          accessibilityStatus: draft.fields.accessibilityStatus,
          accessibilityNotes: draft.fields.accessibilityNotes,
          accessibilityCheckedAt: draft.fields.accessibilityCheckedAt || null,
        },
      })
      const result = response.data?.createPoiFromTextDraft
      if (!result?.ok || !result.adminPath || !result.id) {
        setError(result?.error ?? '建立失敗')
        return
      }
      clearDraft(browserDraftStorage())
      setCreatedPath(result.adminPath)
      setCreatedId(result.id)
    } catch {
      setError('建立失敗')
    }
  }

  if (!ready) {
    return (
      <PageContainer header={<Heading type="h3">確認草稿</Heading>} title="確認草稿">
        <Text>載入中…</Text>
      </PageContainer>
    )
  }

  if (!draft) {
    return (
      <PageContainer header={<Heading type="h3">確認草稿</Heading>} title="確認草稿">
        <VStack gap="regular" paddingY="large">
          <Text>找不到暫存草稿。重新整理或直接開啟此頁後需要重新產生草稿。</Text>
          <Button
            onPress={() => {
              window.location.assign('/poi-from-text')
            }}
          >
            返回輸入頁
          </Button>
        </VStack>
      </PageContainer>
    )
  }

  if (createdPath && createdId) {
    return (
      <PageContainer header={<Heading type="h3">已建立 POI</Heading>} title="已建立 POI">
        <VStack gap="regular" paddingY="large">
          <Text>已建立紀錄 {createdId}。</Text>
          <a href={createdPath}>開啟原始 Admin UI 紀錄</a>
        </VStack>
      </PageContainer>
    )
  }

  const submitDisabled = isCreateSubmitDisabled(loading, draft.fields.name)

  return (
    <PageContainer header={<Heading type="h3">確認草稿</Heading>} title="確認草稿">
      <VStack gap="large" paddingY="large">
        <Text>
          {draft.parser === 'dsh-extract'
            ? '尚未儲存。以下內容由 AI 根據你提供的文字產生，可能有錯漏，請核對後再確認建立。'
            : '尚未儲存。以下欄位來自第一階段非 AI 示範解析，不是模型結果。'}
        </Text>
        <Text>記錄類型：{draft.type === 'occupant' ? 'Occupant' : 'Amenity'}</Text>
        <Text>來源原文（唯讀）</Text>
        <textarea value={draft.source} rows={6} readOnly />
        {draft.unmapped.length ? (
          <VStack gap="small">
            <Text>未寫入的標籤</Text>
            {draft.unmapped.map(item => (
              <Text key={`${item.label}-${item.reason}`}>
                {item.label}：{item.reason}
              </Text>
            ))}
          </VStack>
        ) : null}
        <Text>名稱</Text>
        <input
          value={draft.fields.name}
          onChange={event => updateFields({ name: event.target.value })}
        />
        <Text>暱稱</Text>
        <input
          value={draft.fields.nickname}
          onChange={event => updateFields({ nickname: event.target.value })}
        />
        <Text>地址</Text>
        <input
          value={draft.fields.address}
          onChange={event => updateFields({ address: event.target.value })}
        />
        <Text>經緯度（lng, lat，可留空）</Text>
        <input
          value={lnglatText}
          onChange={event => {
            const text = event.target.value
            setLnglatText(text)
            updateFields({ lnglat: parseLnglatInput(text) })
          }}
        />
        <Text>無障礙設施</Text>
        <select
          value={draft.fields.disabledFacilitiesStatus}
          onChange={event =>
            updateFields({
              disabledFacilitiesStatus: event.target.value as PoiFromTextFields['disabledFacilitiesStatus'],
            })
          }
        >
          {DISABLED_FACILITIES_STATUS_VALUES.map(value => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <Text>無障礙可達性</Text>
        <select
          value={draft.fields.accessibilityStatus}
          onChange={event =>
            updateFields({
              accessibilityStatus: event.target.value as PoiFromTextFields['accessibilityStatus'],
            })
          }
        >
          {ACCESSIBILITY_STATUS_VALUES.map(value => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <Text>無障礙備註</Text>
        <textarea
          rows={4}
          value={draft.fields.accessibilityNotes}
          onChange={event => updateFields({ accessibilityNotes: event.target.value })}
        />
        <Text>最近核實時間（含時區的 ISO 8601，可留空）</Text>
        <input
          value={draft.fields.accessibilityCheckedAt}
          onChange={event => updateFields({ accessibilityCheckedAt: event.target.value })}
        />
        {error ? <Text>{error}</Text> : null}
        <Button
          onPress={() => {
            saveDraft(browserDraftStorage(), draft)
            window.location.assign('/poi-from-text')
          }}
        >
          返回修改
        </Button>
        <Button
          onPress={() => {
            clearDraft(browserDraftStorage())
            window.location.assign('/poi-from-text')
          }}
        >
          取消
        </Button>
        <Button
          prominence="high"
          isDisabled={submitDisabled}
          onPress={() => {
            void onCreate()
          }}
        >
          {loading ? '建立中…' : '確認並建立'}
        </Button>
      </VStack>
    </PageContainer>
  )
}
