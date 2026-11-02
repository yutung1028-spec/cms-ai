import { useState } from 'react'
import { gql, useLazyQuery, useMutation, useQuery } from '@keystone-6/core/admin-ui/apollo'
import { PageContainer } from '@keystone-6/core/admin-ui/components'
import { Button } from '@keystar/ui/button'
import { VStack } from '@keystar/ui/layout'
import { Heading, Text } from '@keystar/ui/typography'
import {
  ACCESSIBILITY_STATUS_VALUES,
  DISABLED_FACILITIES_STATUS_VALUES,
} from '../../poi-accessibility-values.ts'
import { DEFAULT_SEARCH_TAKE, MAX_SEARCH_TAKE } from '../../accessibility-search/validate-args.ts'

const SEARCH_POIS = gql`
  query SearchAccessibilityPois(
    $query: String
    $type: String
    $disabledFacilitiesStatus: String
    $accessibilityStatus: String
    $notesKeyword: String
    $checkedBefore: String
    $uncheckedOnly: Boolean
    $take: Int
  ) {
    searchAccessibilityPois(
      query: $query
      type: $type
      disabledFacilitiesStatus: $disabledFacilitiesStatus
      accessibilityStatus: $accessibilityStatus
      notesKeyword: $notesKeyword
      checkedBefore: $checkedBefore
      uncheckedOnly: $uncheckedOnly
      take: $take
    ) {
      ok
      error
      truncated
      totalCount
      returnedCount
      appliedFilters {
        query
        type
        disabledFacilitiesStatus
        accessibilityStatus
        notesKeyword
        checkedBefore
        uncheckedOnly
        take
        skip
        resultOrder
      }
      items {
        type
        id
        name
        nickname
        disabledFacilitiesStatus
        accessibilityStatus
        accessibilityNotes
        accessibilityCheckedAt
        adminPath
      }
    }
  }
`

const ASSISTANT_STATUS = gql`
  query AccessibilityAssistantStatus {
    accessibilityAssistantStatus {
      configured
      reason
    }
  }
`

const ASK_ASSISTANT = gql`
  mutation AskAccessibilityAssistant($question: String!) {
    askAccessibilityAssistant(question: $question) {
      ok
      error
      code
      blocked
      text
      notices
      sources {
        type
        id
        name
        nickname
        disabledFacilitiesStatus
        accessibilityStatus
        accessibilityNotes
        accessibilityCheckedAt
        adminPath
      }
    }
  }
`

const GET_POI = gql`
  query GetAccessibilityPoi($type: String!, $id: ID!) {
    getAccessibilityPoi(type: $type, id: $id) {
      ok
      error
      item {
        type
        id
        name
        nickname
        disabledFacilitiesStatus
        accessibilityStatus
        accessibilityNotes
        accessibilityCheckedAt
        adminPath
      }
    }
  }
`

type PoiCard = {
  type: string
  id: string
  name: string
  nickname: string
  disabledFacilitiesStatus: string
  accessibilityStatus: string
  accessibilityNotes: string
  accessibilityCheckedAt: string | null
  adminPath: string
}

type SearchResult = {
  searchAccessibilityPois: {
    ok: boolean
    error: string | null
    truncated: boolean
    totalCount: number
    returnedCount: number
    appliedFilters: {
      query: string | null
      type: string
      disabledFacilitiesStatus: string | null
      accessibilityStatus: string | null
      notesKeyword: string | null
      checkedBefore: string | null
      uncheckedOnly: boolean
      take: number
      skip: number
      resultOrder: string
    } | null
    items: PoiCard[]
  }
}

type GetResult = {
  getAccessibilityPoi: {
    ok: boolean
    error: string | null
    item: PoiCard | null
  }
}

type StatusResult = {
  accessibilityAssistantStatus: {
    configured: boolean
    reason: string | null
  }
}

type AskResult = {
  askAccessibilityAssistant: {
    ok: boolean
    error: string | null
    code: string | null
    blocked: boolean
    text: string | null
    notices: string[]
    sources: PoiCard[]
  }
}

const FACILITY_LABELS: Record<string, string> = {
  unknown: '未核實',
  available: '有',
  unavailable: '沒有',
}

const ACCESS_LABELS: Record<string, string> = {
  unknown: '未核實',
  accessible: '可無障礙到達／進入',
  partially_accessible: '有條件或部分可達',
  not_accessible: '不可無障礙到達／進入',
}

function labelOf(map: Record<string, string>, value: string): string {
  return map[value] ?? value
}

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function localDateTimeToIso(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return undefined
  return parsed.toISOString()
}

function formatCheckedAt(value: string | null): string {
  return value ? value : '未記錄'
}

function filterSummary(filters: SearchResult['searchAccessibilityPois']['appliedFilters']): string {
  if (!filters) return ''
  const parts = [
    `type=${filters.type}`,
    filters.query ? `keyword=${filters.query}` : 'keyword=(空)',
    filters.disabledFacilitiesStatus
      ? `disabledFacilitiesStatus=${filters.disabledFacilitiesStatus}`
      : 'disabledFacilitiesStatus=不限',
    filters.accessibilityStatus ? `accessibilityStatus=${filters.accessibilityStatus}` : 'accessibilityStatus=不限',
    filters.notesKeyword ? `notesKeyword=${filters.notesKeyword}` : 'notesKeyword=(空)',
    filters.uncheckedOnly ? 'uncheckedOnly=true' : filters.checkedBefore ? `checkedBefore=${filters.checkedBefore}` : 'checkedBefore=不限',
    `take=${filters.take}`,
  ]
  return parts.join('；')
}

export default function AccessibilitySearchPage() {
  const [type, setType] = useState('')
  const [keyword, setKeyword] = useState('')
  const [disabledFacilitiesStatus, setDisabledFacilitiesStatus] = useState('')
  const [accessibilityStatus, setAccessibilityStatus] = useState('')
  const [notesKeyword, setNotesKeyword] = useState('')
  const [checkedBefore, setCheckedBefore] = useState('')
  const [uncheckedOnly, setUncheckedOnly] = useState(false)
  const [take, setTake] = useState(String(DEFAULT_SEARCH_TAKE))
  const [clientError, setClientError] = useState<string | null>(null)
  const [detail, setDetail] = useState<PoiCard | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [askClientError, setAskClientError] = useState<string | null>(null)

  const { data: statusData } = useQuery<StatusResult>(ASSISTANT_STATUS, { fetchPolicy: 'no-cache' })
  const [runSearch, { data, loading, error }] = useLazyQuery<SearchResult>(SEARCH_POIS, {
    fetchPolicy: 'no-cache',
  })
  const [runGet, { loading: detailLoading }] = useLazyQuery<GetResult>(GET_POI, {
    fetchPolicy: 'no-cache',
  })
  const [runAsk, { data: askData, loading: askLoading }] = useMutation<AskResult>(ASK_ASSISTANT)

  const result = data?.searchAccessibilityPois
  const aiStatus = statusData?.accessibilityAssistantStatus
  const aiConfigured = Boolean(aiStatus?.configured)
  const askResult = askData?.askAccessibilityAssistant

  async function onSearch() {
    setClientError(null)
    setDetail(null)
    setDetailError(null)
    const takeNumber = Number(take)
    if (!Number.isInteger(takeNumber) || takeNumber < 1 || takeNumber > MAX_SEARCH_TAKE) {
      setClientError(`take 必須是 1 到 ${MAX_SEARCH_TAKE} 的整數`)
      return
    }
    if (uncheckedOnly && checkedBefore.trim() !== '') {
      setClientError('「只顯示未記錄核實時間」不能與 checkedBefore 同時使用')
      return
    }
    const checkedBeforeIso = localDateTimeToIso(checkedBefore)
    if (checkedBefore.trim() !== '' && !checkedBeforeIso) {
      setClientError('checkedBefore 不是有效日期時間')
      return
    }
    await runSearch({
      variables: {
        query: emptyToUndefined(keyword),
        type: emptyToUndefined(type),
        disabledFacilitiesStatus: emptyToUndefined(disabledFacilitiesStatus),
        accessibilityStatus: emptyToUndefined(accessibilityStatus),
        notesKeyword: emptyToUndefined(notesKeyword),
        checkedBefore: checkedBeforeIso,
        uncheckedOnly,
        take: takeNumber,
      },
    })
  }

  async function onVerify(item: PoiCard) {
    setDetailError(null)
    const response = await runGet({ variables: { type: item.type, id: item.id } })
    const payload = response.data?.getAccessibilityPoi
    if (!payload?.ok || !payload.item) {
      setDetail(null)
      setDetailError(payload?.error ?? '無法讀取此筆紀錄')
      return
    }
    setDetail(payload.item)
  }

  async function onAsk() {
    setAskClientError(null)
    if (!aiConfigured) return
    if (question.trim() === '') {
      setAskClientError('請輸入問題')
      return
    }
    await runAsk({ variables: { question } })
  }

  return (
    <PageContainer header={<Heading type="h3">無障礙搜尋助手</Heading>} title="無障礙搜尋助手">
      <VStack gap="large" paddingY="large">
        

        <VStack gap="regular">
          <Text>自然語言提問</Text>
          <textarea
            value={question}
            onChange={event => setQuestion(event.target.value)}
            rows={4}
            disabled={!aiConfigured || askLoading}
          />
          <Button
            isDisabled={!aiConfigured || askLoading}
            onPress={() => {
              void onAsk()
            }}
          >
            {askLoading ? '提問中…' : '提問'}
          </Button>
          {!aiConfigured ? <Text>{aiStatus?.reason ?? 'AI 尚未設定'}</Text> : null}
          {askClientError ? <Text>{askClientError}</Text> : null}
          {askResult && !askResult.ok ? <Text>{askResult.error ?? '提問失敗'}</Text> : null}
          {askResult?.ok ? (
            <VStack gap="small">
              {askResult.blocked ? <Text>不受支持的引用已被阻擋，改為顯示實際來源卡片。</Text> : null}
              {askResult.text ? <Text>{askResult.text}</Text> : null}
              {askResult.notices
                .filter(notice => notice !== askResult.text)
                .map(notice => (
                  <Text key={notice}>{notice}</Text>
                ))}
              {askResult.sources.map(item => (
                <VStack key={`ask-${item.type}-${item.id}`} gap="small">
                  <Text>來源 {item.type} {item.id}</Text>
                  <Text>name：{item.name}</Text>
                  <Text>nickname：{item.nickname || '（無）'}</Text>
                  <Text>設施狀態：{item.disabledFacilitiesStatus}</Text>
                  <Text>可達性：{item.accessibilityStatus}</Text>
                  <Text>原始備註：{item.accessibilityNotes || '（無）'}</Text>
                  <Text>最近核實時間：{formatCheckedAt(item.accessibilityCheckedAt)}</Text>
                  <a href={item.adminPath}>開啟原始 Admin UI 紀錄</a>
                </VStack>
              ))}
            </VStack>
          ) : null}
        </VStack>

        <VStack gap="regular">
          <Text>結構化搜尋（非 AI）</Text>
          <label>
            <Text>type</Text>
            <select value={type} onChange={event => setType(event.target.value)}>
              <option value="">全部</option>
              <option value="occupant">Occupants</option>
              <option value="amenity">Amenities</option>
            </select>
          </label>
          <label>
            <Text>keyword</Text>
            <input value={keyword} onChange={event => setKeyword(event.target.value)} />
          </label>
          <label>
            <Text>disabledFacilitiesStatus</Text>
            <select
              value={disabledFacilitiesStatus}
              onChange={event => setDisabledFacilitiesStatus(event.target.value)}
            >
              <option value="">不限</option>
              {DISABLED_FACILITIES_STATUS_VALUES.map(value => (
                <option key={value} value={value}>
                  {labelOf(FACILITY_LABELS, value)} ({value})
                </option>
              ))}
            </select>
          </label>
          <label>
            <Text>accessibilityStatus</Text>
            <select
              value={accessibilityStatus}
              onChange={event => setAccessibilityStatus(event.target.value)}
            >
              <option value="">不限</option>
              {ACCESSIBILITY_STATUS_VALUES.map(value => (
                <option key={value} value={value}>
                  {labelOf(ACCESS_LABELS, value)} ({value})
                </option>
              ))}
            </select>
          </label>
          <label>
            <Text>notesKeyword</Text>
            <input value={notesKeyword} onChange={event => setNotesKeyword(event.target.value)} />
          </label>
          <label>
            <Text>checkedBefore</Text>
            <input
              type="datetime-local"
              value={checkedBefore}
              onChange={event => setCheckedBefore(event.target.value)}
              disabled={uncheckedOnly}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={uncheckedOnly}
              onChange={event => {
                setUncheckedOnly(event.target.checked)
                if (event.target.checked) setCheckedBefore('')
              }}
            />
            <Text>uncheckedOnly（只顯示未記錄核實時間）</Text>
          </label>
          <label>
            <Text>take（預設 {DEFAULT_SEARCH_TAKE}，最多 {MAX_SEARCH_TAKE}）</Text>
            <input value={take} onChange={event => setTake(event.target.value)} />
          </label>
          <Button
            prominence="high"
            isDisabled={loading}
            onPress={() => {
              void onSearch()
            }}
          >
            {loading ? '搜尋中…' : '搜尋'}
          </Button>
        </VStack>

        {clientError ? <Text>{clientError}</Text> : null}
        {error ? <Text>查詢失敗</Text> : null}
        {result && !result.ok ? <Text>{result.error ?? '查詢被拒絕'}</Text> : null}

        {result?.ok ? (
          <VStack gap="regular">
            <Text>實際篩選條件：{filterSummary(result.appliedFilters)}</Text>
            <Text>
              返回 {result.returnedCount} 筆
              {result.truncated
                ? `（已截斷，符合條件共 ${result.totalCount} 筆，這不是全部結果）`
                : `（符合條件共 ${result.totalCount} 筆）`}
            </Text>
            {result.appliedFilters?.resultOrder === 'occupant_then_amenity' ? (
              <Text>排序說明：Occupant 先、Amenity 後，不是相關性排序。</Text>
            ) : null}
            {result.items.length === 0 ? <Text>沒有結果</Text> : null}
            {result.items.map(item => (
              <VStack key={`${item.type}-${item.id}`} gap="small">
                  <Text>type：{item.type}</Text>
                  <Text>name：{item.name}</Text>
                  <Text>nickname：{item.nickname || '（無）'}</Text>
                  <Text>
                    設施狀態：{labelOf(FACILITY_LABELS, item.disabledFacilitiesStatus)} (
                    {item.disabledFacilitiesStatus})
                  </Text>
                  <Text>
                    可達性：{labelOf(ACCESS_LABELS, item.accessibilityStatus)} ({item.accessibilityStatus})
                  </Text>
                  <Text>原始備註：{item.accessibilityNotes || '（無）'}</Text>
                  <Text>最近核實時間：{formatCheckedAt(item.accessibilityCheckedAt)}</Text>
                  <Text>來源 ID：{item.id}</Text>
                  <a href={item.adminPath}>開啟原始 Admin UI 紀錄</a>
                  <Button
                    isDisabled={detailLoading}
                    onPress={() => {
                      void onVerify(item)
                    }}
                  >
                    用 get_poi 核對此筆
                  </Button>
                </VStack>
            ))}
          </VStack>
        ) : null}

        {detailError ? <Text>{detailError}</Text> : null}
        {detail ? (
          <VStack gap="small">
              <Text>get_poi 核對結果</Text>
              <Text>type：{detail.type}</Text>
              <Text>name：{detail.name}</Text>
              <Text>nickname：{detail.nickname || '（無）'}</Text>
              <Text>設施狀態：{detail.disabledFacilitiesStatus}</Text>
              <Text>可達性：{detail.accessibilityStatus}</Text>
              <Text>原始備註：{detail.accessibilityNotes || '（無）'}</Text>
              <Text>最近核實時間：{formatCheckedAt(detail.accessibilityCheckedAt)}</Text>
              <Text>來源 ID：{detail.id}</Text>
              <a href={detail.adminPath}>開啟原始 Admin UI 紀錄</a>
          </VStack>
        ) : null}
      </VStack>
    </PageContainer>
  )
}
