import { useEffect, useState } from 'react'
import { PageContainer } from '@keystone-6/core/admin-ui/components'
import { Button } from '@keystar/ui/button'
import { VStack } from '@keystar/ui/layout'
import { Heading, Text } from '@keystar/ui/typography'
import {
  browserDraftStorage,
  loadDraft,
  saveDraft,
} from '../../poi-from-text/draft-state.ts'
import { MAX_POI_FROM_TEXT_CHARS } from '../../poi-from-text/limits.ts'
import { parsePoiFromTextDraft } from '../../poi-from-text/parse-draft.ts'
import type { PoiType } from '../../poi-from-text/types.ts'

export default function PoiFromTextPage() {
  const [source, setSource] = useState('')
  const [type, setType] = useState<PoiType>('occupant')
  const [error, setError] = useState<string | null>(null)
  const [hasDraft, setHasDraft] = useState(false)

  useEffect(() => {
    const existing = loadDraft(browserDraftStorage())
    if (!existing) return
    setSource(existing.source)
    setType(existing.type)
    setHasDraft(true)
  }, [])

  function onGenerate() {
    const parsed = parsePoiFromTextDraft(source, type)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    saveDraft(browserDraftStorage(), parsed.draft)
    window.location.assign('/poi-from-text-confirm')
  }

  return (
    <PageContainer header={<Heading type="h3">從文字建立 POI</Heading>} title="從文字建立 POI">
      <VStack gap="large" paddingY="large">
        <Text>
          第一階段使用非 AI 示範解析，不會呼叫模型。
          草稿只供預覽，確認建立前不會儲存至資料庫。
        </Text>
        <Text>
          示範格式為標籤列，例如「名稱：晨光咖啡館」。支援名稱、暱稱、地址、備註、無障礙設施、可達性、最近核實時間、經緯度。
          一般段落會保留為原文，沒有可靠對應的欄位維持空白或未核實。
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
          onPress={() => {
            onGenerate()
          }}
        >
          產生草稿
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
