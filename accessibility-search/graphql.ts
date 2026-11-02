import { g } from '@keystone-6/core'
import { adminPoiItemPath } from './admin-paths.ts'
import { askAccessibilityAssistant } from './ask.ts'
import { getAssistantAiStatus } from './dsh-config.ts'
import { getPoi, searchPois, type AppliedSearchFilters, type ApprovedPoiRecord } from './poi-query.ts'
import { requireAssistantUser } from './assistant-auth.ts'

type GraphQLSearchArgs = {
  query?: string | null
  type?: string | null
  disabledFacilitiesStatus?: string | null
  accessibilityStatus?: string | null
  notesKeyword?: string | null
  checkedBefore?: string | null
  uncheckedOnly?: boolean | null
  take?: number | null
}

type GraphQLGetArgs = {
  type?: string | null
  id?: string | null
}

function compactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const compact: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (value !== null && value !== undefined) compact[key] = value
  }
  return compact
}

const AccessibilityPoiType = g.object<ApprovedPoiRecord>()({
  name: 'AccessibilityPoi',
  fields: {
    type: g.field({ type: g.nonNull(g.String) }),
    id: g.field({ type: g.nonNull(g.ID) }),
    name: g.field({ type: g.nonNull(g.String) }),
    nickname: g.field({ type: g.nonNull(g.String) }),
    address: g.field({ type: g.nonNull(g.String) }),
    lnglat: g.field({ type: g.JSON }),
    disabledFacilitiesStatus: g.field({ type: g.nonNull(g.String) }),
    accessibilityStatus: g.field({ type: g.nonNull(g.String) }),
    accessibilityNotes: g.field({ type: g.nonNull(g.String) }),
    accessibilityCheckedAt: g.field({ type: g.String }),
    adminPath: g.field({
      type: g.nonNull(g.String),
      resolve(item) {
        return adminPoiItemPath(item.type, item.id)
      },
    }),
  },
})

const AppliedSearchFiltersType = g.object<AppliedSearchFilters>()({
  name: 'AccessibilitySearchFilters',
  fields: {
    query: g.field({ type: g.String }),
    type: g.field({ type: g.nonNull(g.String) }),
    disabledFacilitiesStatus: g.field({ type: g.String }),
    accessibilityStatus: g.field({ type: g.String }),
    notesKeyword: g.field({ type: g.String }),
    checkedBefore: g.field({ type: g.String }),
    uncheckedOnly: g.field({ type: g.nonNull(g.Boolean) }),
    take: g.field({ type: g.nonNull(g.Int) }),
    skip: g.field({ type: g.nonNull(g.Int) }),
    resultOrder: g.field({ type: g.nonNull(g.String) }),
  },
})

type SearchGraphqlResult = {
  ok: boolean
  error: string | null
  truncated: boolean
  totalCount: number
  returnedCount: number
  items: ApprovedPoiRecord[]
  appliedFilters: AppliedSearchFilters | null
}

type GetGraphqlResult = {
  ok: boolean
  error: string | null
  item: ApprovedPoiRecord | null
}

const SearchAccessibilityPoisResultType = g.object<SearchGraphqlResult>()({
  name: 'SearchAccessibilityPoisResult',
  fields: {
    ok: g.field({ type: g.nonNull(g.Boolean) }),
    error: g.field({ type: g.String }),
    truncated: g.field({ type: g.nonNull(g.Boolean) }),
    totalCount: g.field({ type: g.nonNull(g.Int) }),
    returnedCount: g.field({ type: g.nonNull(g.Int) }),
    items: g.field({ type: g.nonNull(g.list(g.nonNull(AccessibilityPoiType))) }),
    appliedFilters: g.field({ type: AppliedSearchFiltersType }),
  },
})

const GetAccessibilityPoiResultType = g.object<GetGraphqlResult>()({
  name: 'GetAccessibilityPoiResult',
  fields: {
    ok: g.field({ type: g.nonNull(g.Boolean) }),
    error: g.field({ type: g.String }),
    item: g.field({ type: AccessibilityPoiType }),
  },
})

function toSearchGraphql(result: Awaited<ReturnType<typeof searchPois>>): SearchGraphqlResult {
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      truncated: false,
      totalCount: 0,
      returnedCount: 0,
      items: [],
      appliedFilters: null,
    }
  }
  return {
    ok: true,
    error: null,
    truncated: result.truncated,
    totalCount: result.totalCount,
    returnedCount: result.returnedCount,
    items: result.items,
    appliedFilters: result.appliedFilters,
  }
}

function toGetGraphql(result: Awaited<ReturnType<typeof getPoi>>): GetGraphqlResult {
  if (!result.ok) return { ok: false, error: result.error, item: null }
  return { ok: true, error: null, item: result.item }
}

type StatusGraphql = {
  configured: boolean
  reason: string | null
}

type AskGraphql = {
  ok: boolean
  error: string | null
  code: string | null
  blocked: boolean
  text: string | null
  notices: string[]
  sources: ApprovedPoiRecord[]
}

const AccessibilityAssistantStatusType = g.object<StatusGraphql>()({
  name: 'AccessibilityAssistantStatus',
  fields: {
    configured: g.field({ type: g.nonNull(g.Boolean) }),
    reason: g.field({ type: g.String }),
  },
})

const AskAccessibilityAssistantResultType = g.object<AskGraphql>()({
  name: 'AskAccessibilityAssistantResult',
  fields: {
    ok: g.field({ type: g.nonNull(g.Boolean) }),
    error: g.field({ type: g.String }),
    code: g.field({ type: g.String }),
    blocked: g.field({ type: g.nonNull(g.Boolean) }),
    text: g.field({ type: g.String }),
    notices: g.field({ type: g.nonNull(g.list(g.nonNull(g.String))) }),
    sources: g.field({ type: g.nonNull(g.list(g.nonNull(AccessibilityPoiType))) }),
  },
})

export const extendAccessibilitySearchSchema = g.extend({
  mutation: {
    askAccessibilityAssistant: g.field({
      type: g.nonNull(AskAccessibilityAssistantResultType),
      args: {
        question: g.arg({ type: g.nonNull(g.String) }),
      },
      async resolve(_root, { question }, context) {
        const result = await askAccessibilityAssistant(context, question)
        if (!result.ok) {
          return {
            ok: false,
            error: result.error,
            code: result.code,
            blocked: false,
            text: null,
            notices: [],
            sources: [],
          }
        }
        return {
          ok: true,
          error: null,
          code: null,
          blocked: result.blocked,
          text: result.text,
          notices: result.notices,
          sources: result.sources,
        }
      },
    }),
  },
  query: {
    searchAccessibilityPois: g.field({
      type: g.nonNull(SearchAccessibilityPoisResultType),
      args: {
        query: g.arg({ type: g.String }),
        type: g.arg({ type: g.String }),
        disabledFacilitiesStatus: g.arg({ type: g.String }),
        accessibilityStatus: g.arg({ type: g.String }),
        notesKeyword: g.arg({ type: g.String }),
        checkedBefore: g.arg({ type: g.String }),
        uncheckedOnly: g.arg({ type: g.Boolean }),
        take: g.arg({ type: g.Int }),
      },
      resolve(_root, args: GraphQLSearchArgs, context) {
        return searchPois(context, compactArgs(args as Record<string, unknown>)).then(toSearchGraphql)
      },
    }),
    getAccessibilityPoi: g.field({
      type: g.nonNull(GetAccessibilityPoiResultType),
      args: {
        type: g.arg({ type: g.nonNull(g.String) }),
        id: g.arg({ type: g.nonNull(g.ID) }),
      },
      resolve(_root, args: GraphQLGetArgs, context) {
        return getPoi(context, compactArgs({ type: args.type, id: args.id })).then(toGetGraphql)
      },
    }),
    accessibilityAssistantStatus: g.field({
      type: g.nonNull(AccessibilityAssistantStatusType),
      async resolve(_root, _args, context) {
        const auth = await requireAssistantUser(context)
        if (!auth.ok) {
          return { configured: false, reason: auth.error }
        }
        const status = getAssistantAiStatus()
        if (!status.configured) return { configured: false, reason: status.reason }
        return { configured: true, reason: null }
      },
    }),
  },
})
