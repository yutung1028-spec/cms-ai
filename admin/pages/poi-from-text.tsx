import { useEffect, useState } from 'react'
import { gql, useMutation } from '@keystone-6/core/admin-ui/apollo'
import { PageContainer } from '@keystone-6/core/admin-ui/components'
import { Button } from '@keystar/ui/button'
import { VStack } from '@keystar/ui/layout'
import { Heading, Text } from '@keystar/ui/typography'
import {
  browserDraftStorage,
  loadDraft,
  saveDraft,
} from '../../poi-from-text/draft-state.ts'
import { MODEL_RUN_FAILED_TEXT } from '../../poi-from-text/errors.ts'
import { MAX_POI_FROM_TEXT_CHARS } from '../../poi-from-text/limits.ts'
import type { PoiType } from '../../poi-from-text/types.ts'

const GENERATE_POI = gql`
  mutation GeneratePoiFromTextDraft($source: String!, $type: String!) {
    generatePoiFromTextDraft(source: $source, type: $type) {
      ok
      error
      code
      source
      type
      fields {
        name
        nickname
        address
        lng
        lat
        disabledFacilitiesStatus
        accessibilityStatus
        accessibilityNotes
        accessibilityCheckedAt
      }
    }
  }
`

type GenerateResult = {
  generatePoiFromTextDraft: {
    ok: boolean
    error: string | null
    code: string | null
    source: string | null
    type: string | null
    fields: {
      name: string
      nickname: string
      address: string
      lng: number | null
      lat: number | null
      disabledFacilitiesStatus: 'unknown' | 'available' | 'unavailable'
      accessibilityStatus: 'unknown' | 'accessible' | 'partially_accessible' | 'not_accessible'
      accessibilityNotes: string
      accessibilityCheckedAt: string
    } | null
  }
}

export default function PoiFromTextPage() {
  const [source, setSource] = useState('')
  const [type, setType] = useState<PoiType>('occupant')
  const [error, setError] = useState<string | null>(null)
  const [hasDraft, setHasDraft] = useState(false)
  const [generateDraft, { loading }] = useMutation<GenerateResult>(GENERATE_POI)

  useEffect(() => {
    const existing = loadDraft(browserDraftStorage())
    if (!existing) return
    setSource(existing.source)
    setType(existing.type)
    setHasDraft(true)
  }, [])

  async function onGenerate() {
    if (loading) return
    setError(null)
    try {
      const response = await generateDraft({
        variables: { source, type },
      })
      const result = response.data?.generatePoiFromTextDraft
      if (!result?.ok || !result.fields) {
        setError(result?.error ?? MODEL_RUN_FAILED_TEXT)
        return
      }
      saveDraft(browserDraftStorage(), {
        source,
        type,
        parser: 'dsh-extract',
        unmapped: [],
        fields: {
          name: result.fields.name,
          nickname: result.fields.nickname,
          address: result.fields.address,
          lnglat:
            result.fields.lng === null || result.fields.lat === null
              ? null
              : { lng: result.fields.lng, lat: result.fields.lat },
          disabledFacilitiesStatus: result.fields.disabledFacilitiesStatus,
          accessibilityStatus: result.fields.accessibilityStatus,
          accessibilityNotes: result.fields.accessibilityNotes,
          accessibilityCheckedAt: result.fields.accessibilityCheckedAt,
        },
      })
      window.location.assign('/poi-from-text-confirm')
    } catch {
      setError(MODEL_RUN_FAILED_TEXT)
    }
  }

  return (
    <PageContainer header={<Heading type="h3">從文字建立 POI</Heading>} title="從文字建立 POI">
      <VStack gap="large" paddingY="large">
        <Text>
          輸入一般段落後，由 AI 產生欄位建議。草稿只供預覽，確認建立前不會儲存至資料庫。
        </Text>
        <Text>
          模型只根據你提供的文字抽取，不會搜尋或核實真實世界資訊。缺少的欄位可在確認頁補填。
        </Text>
        <Text>記錄類型</Text>
        <select
          value={type}
          onChange={event => setType(event.target.value === 'amenity' ? 'amenity' : 'occupant')}
        >
          <option value="occupant">Occupant</option>
          <option value="amenity">Amenity</option>
        </select>
        <Text>來源段落（最多 {MAX_POI_FROM_TEXT_CHARS} 字）</Text>
        <textarea
          value={source}
          rows={10}
          onChange={event => {
            setSource(event.target.value)
            setError(null)
          }}
        />
        {error ? <Text>{error}</Text> : null}
        <Button
          prominence="high"
          isDisabled={loading}
          onPress={() => {
            void onGenerate()
          }}
        >
          {loading ? '產生中…' : 'AI 產生草稿'}
        </Button>
        {hasDraft ? (
          <Button
            onPress={() => {
              window.location.assign('/poi-from-text-confirm')
            }}
          >
            返回確認頁
          </Button>
        ) : null}
      </VStack>
    </PageContainer>
  )
}
