import { adminPoiItemPath } from './admin-paths.ts'
import type { ToolCallRecord } from './bound-tools.ts'
import type { ApprovedPoiRecord } from './poi-query.ts'
import type { CitationRef } from './mock-agent.ts'
import type { PoiListType } from './validate-args.ts'

export type SourceCard = {
  type: PoiListType
  id: string
  name: string
  nickname: string
  address: string
  lnglat: unknown
  disabledFacilitiesStatus: string
  accessibilityStatus: string
  accessibilityNotes: string
  accessibilityCheckedAt: string | null
  checkedAtDisplay: string
  adminPath: string
}

export type GroundedAnswer = {
  ok: true
  text: string | null
  blocked: boolean
  notices: string[]
  sources: SourceCard[]
}

export const NO_TOOL_CALLS_TEXT = '模型沒有查詢資料庫。'
export const NO_MATCHING_RECORDS_TEXT = '沒有符合條件的紀錄。'
export const EMPTY_MODEL_TEXT = '模型沒有提供可用文字。'
export const TOOL_NOT_EXECUTED_TEXT = '模型已提出查詢，但執行未完成。'
export const TOOL_FAILED_TEXT = '工具查詢失敗。'
export const QUERY_UNCONFIRMED_TEXT = '無法確認模型是否提出工具呼叫。'
export const TOOLS_NOT_EXPOSED_TEXT = '此次模型請求沒有提供查詢工具。'
export const MODEL_QUOTA_TEXT =
  '模型服務回報額度／餘額不足，本次未能完成自然語言查詢。\n請檢查此服務所用 API 帳號的額度及餘額。\n你仍可使用結構化搜尋。'
export const MODEL_RUN_FAILED_TEXT = '模型服務未能完成本次自然語言查詢。'

export type QueryObservation = {
  eventsAvailable: boolean
  proposedPoiToolCalls: boolean
  toolResultErrors: number
  requestExposedPoiTools: boolean | null
  turnObserved: boolean
  turnCompleted: boolean
  quotaExceeded: boolean
  modelTurnFailed: boolean
}

export function mockQueryObservation(toolCalls: readonly ToolCallRecord[]): QueryObservation {
  return {
    eventsAvailable: true,
    proposedPoiToolCalls: toolCalls.some(isPoiToolCall),
    toolResultErrors: 0,
    requestExposedPoiTools: true,
    turnObserved: true,
    turnCompleted: true,
    quotaExceeded: false,
    modelTurnFailed: false,
  }
}

function isPoiType(value: string): value is PoiListType {
  return value === 'occupant' || value === 'amenity'
}

export function toSourceCard(item: ApprovedPoiRecord): SourceCard {
  return {
    type: item.type,
    id: item.id,
    name: item.name,
    nickname: item.nickname,
    address: item.address,
    lnglat: item.lnglat,
    disabledFacilitiesStatus: item.disabledFacilitiesStatus,
    accessibilityStatus: item.accessibilityStatus,
    accessibilityNotes: item.accessibilityNotes,
    accessibilityCheckedAt: item.accessibilityCheckedAt,
    checkedAtDisplay: item.accessibilityCheckedAt ? item.accessibilityCheckedAt : '未記錄',
    adminPath: adminPoiItemPath(item.type, item.id),
  }
}

function isPoiToolCall(call: ToolCallRecord): boolean {
  return call.name === 'search_pois' || call.name === 'get_poi'
}

function relatedCalls(toolCalls: readonly ToolCallRecord[] | undefined): ToolCallRecord[] {
  return (toolCalls ?? []).filter(isPoiToolCall)
}

function hasSuccessfulItems(call: ToolCallRecord): boolean {
  if (call.name === 'search_pois') return call.result.ok && call.result.items.length > 0
  return call.result.ok
}

function isCompletedZero(call: ToolCallRecord): boolean {
  if (call.name === 'search_pois') return call.result.ok && call.result.items.length === 0
  return !call.result.ok && call.result.error === 'POI not found'
}

function isFailedQuery(call: ToolCallRecord): boolean {
  if (call.name === 'search_pois') return !call.result.ok
  return !call.result.ok && call.result.error !== 'POI not found'
}

function uniqueNotices(text: string, notices: string[]): string[] {
  return notices.filter(notice => notice !== text)
}

function rejectFacts(text: string, notices: string[], sources: SourceCard[]): GroundedAnswer {
  return { ok: true, text, blocked: false, notices: uniqueNotices(text, notices), sources }
}

export function groundAnswer(input: {
  text: string
  citations: CitationRef[]
  evidence: ApprovedPoiRecord[]
  truncated: boolean
  toolCalls?: readonly ToolCallRecord[]
  observation?: QueryObservation
}): GroundedAnswer {
  const evidenceByKey = new Map(input.evidence.map(item => [`${item.type}:${item.id}`, item]))
  const notices: string[] = []
  const supported: ApprovedPoiRecord[] = []
  let unsupported = false

  for (const citation of input.citations) {
    if (!isPoiType(citation.type)) {
      unsupported = true
      continue
    }
    const item = evidenceByKey.get(`${citation.type}:${citation.id}`)
    if (!item) {
      unsupported = true
      continue
    }
    supported.push(item)
  }

  const sources = (unsupported ? input.evidence : supported.length ? supported : input.evidence).map(toSourceCard)
  const trimmed = input.text.trim()
  const related = relatedCalls(input.toolCalls)
  const hadSuccessItems = related.some(hasSuccessfulItems)
  const hadZero = related.some(isCompletedZero)
  const observation = input.observation
  const hadFailed =
    related.some(isFailedQuery) || (observation?.toolResultErrors ?? 0) > 0

  if (input.truncated) {
    notices.push('搜尋結果已截斷，這不是全部符合條件的紀錄。')
  }
  if (sources.some(item => item.disabledFacilitiesStatus === 'unknown' || item.accessibilityStatus === 'unknown')) {
    notices.push('狀態為 unknown 的欄位表示資料未記錄，不能改寫成 available 或 unavailable。')
  }
  if (sources.some(item => item.accessibilityStatus === 'partially_accessible')) {
    notices.push('有條件或部分可達不能說成完全可達。')
  }
  if (sources.some(item => !item.accessibilityCheckedAt)) {
    notices.push('沒有核實時間的紀錄顯示為「未記錄」。')
  }

  if (observation?.quotaExceeded) {
    return rejectFacts(MODEL_QUOTA_TEXT, notices, [])
  }
  if (observation?.modelTurnFailed) {
    return rejectFacts(MODEL_RUN_FAILED_TEXT, notices, [])
  }

  if (!hadSuccessItems) {
    if (hadFailed) return rejectFacts(TOOL_FAILED_TEXT, notices, [])
    if (hadZero) return rejectFacts(NO_MATCHING_RECORDS_TEXT, notices, sources)
    if (observation?.requestExposedPoiTools === false) {
      return rejectFacts(TOOLS_NOT_EXPOSED_TEXT, notices, [])
    }
    if (observation?.proposedPoiToolCalls || (observation?.toolResultErrors ?? 0) > 0) {
      return rejectFacts(TOOL_NOT_EXECUTED_TEXT, notices, [])
    }
    if (observation?.eventsAvailable && observation.turnCompleted) {
      return rejectFacts(NO_TOOL_CALLS_TEXT, notices, [])
    }
    return rejectFacts(QUERY_UNCONFIRMED_TEXT, notices, [])
  }

  if (unsupported) {
    notices.unshift('模型引用了工具結果中不存在的來源，已改為只顯示實際來源卡片。')
    return { ok: true, text: null, blocked: true, notices: uniqueNotices('', notices), sources }
  }

  if (input.evidence.length === 0) {
    return rejectFacts(NO_MATCHING_RECORDS_TEXT, notices, sources)
  }

  if (trimmed === '') {
    return { ok: true, text: EMPTY_MODEL_TEXT, blocked: false, notices: uniqueNotices(EMPTY_MODEL_TEXT, notices), sources }
  }

  return { ok: true, text: input.text, blocked: false, notices: uniqueNotices(input.text, notices), sources }
}
