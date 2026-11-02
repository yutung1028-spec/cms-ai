import { getPoi, searchPois, type ApprovedPoiRecord, type GetPoiResult, type SearchPoisResult } from './poi-query.ts'

export const ASSISTANT_TOOL_NAMES = ['search_pois', 'get_poi'] as const
export type AssistantToolName = (typeof ASSISTANT_TOOL_NAMES)[number]

export type ToolCallRecord = {
  name: AssistantToolName
  args: unknown
  result: SearchPoisResult | GetPoiResult
}

type QueryContext = Parameters<typeof searchPois>[0]

export function bindAssistantTools(context: QueryContext) {
  return {
    async search_pois(args: unknown): Promise<SearchPoisResult> {
      return searchPois(context, args)
    },
    async get_poi(args: unknown): Promise<GetPoiResult> {
      return getPoi(context, args)
    },
  }
}

export function collectEvidence(calls: readonly ToolCallRecord[]): ApprovedPoiRecord[] {
  const byKey = new Map<string, ApprovedPoiRecord>()
  for (const call of calls) {
    if (call.name === 'search_pois' && call.result.ok) {
      for (const item of call.result.items) byKey.set(`${item.type}:${item.id}`, item)
    }
    if (call.name === 'get_poi' && call.result.ok) {
      const item = call.result.item
      byKey.set(`${item.type}:${item.id}`, item)
    }
  }
  return [...byKey.values()]
}

export function anySearchTruncated(calls: readonly ToolCallRecord[]): boolean {
  return calls.some(call => call.name === 'search_pois' && call.result.ok && call.result.truncated)
}
