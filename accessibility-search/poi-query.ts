import type { KeystoneContext } from '@keystone-6/core/types'
import { requireAssistantUser } from './assistant-auth.ts'
import { APPROVED_POI_FIELD_KEYS, POI_QUERY_FIELDS } from './poi-fields.ts'
import {
  parseGetPoiArgs,
  parseSearchPoisArgs,
  type GetPoiArgs,
  type PoiListType,
  type SearchPoisArgs,
} from './validate-args.ts'

export type ApprovedPoiRecord = {
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
}

export type AppliedSearchFilters = {
  query?: string
  type: PoiListType | 'all'
  disabledFacilitiesStatus?: string
  accessibilityStatus?: string
  notesKeyword?: string
  checkedBefore?: string
  uncheckedOnly: boolean
  take: number
  skip: number
  resultOrder: 'occupant_then_amenity' | 'single_list'
}

export type SearchPoisResult =
  | {
      ok: true
      items: ApprovedPoiRecord[]
      truncated: boolean
      totalCount: number
      returnedCount: number
      appliedFilters: AppliedSearchFilters
    }
  | { ok: false; error: string }

export type GetPoiResult =
  | { ok: true; item: ApprovedPoiRecord }
  | { ok: false; error: string }

type QueryList = {
  findMany: (args: {
    where?: Record<string, unknown>
    take?: number
    skip?: number
    query: string
  }) => Promise<readonly Record<string, unknown>[]>
  findOne: (args: { where: { id: string }; query: string }) => Promise<Record<string, unknown> | null>
  count: (args?: { where?: Record<string, unknown> }) => Promise<number>
}

type AssistantContext = Pick<KeystoneContext, 'session' | 'query'>

function listApi(context: AssistantContext, type: PoiListType): QueryList {
  return type === 'occupant' ? context.query.Occupant : context.query.Amenity
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function mapCheckedAt(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (typeof value === 'string' && value !== '') return value
  return null
}

function mapApprovedPoi(type: PoiListType, raw: Record<string, unknown>): ApprovedPoiRecord {
  return {
    type,
    id: asString(raw.id),
    name: asString(raw.name),
    nickname: asString(raw.nickname),
    address: asString(raw.address),
    lnglat: raw.lnglat ?? null,
    disabledFacilitiesStatus: asString(raw.disabledFacilitiesStatus, 'unknown'),
    accessibilityStatus: asString(raw.accessibilityStatus, 'unknown'),
    accessibilityNotes: asString(raw.accessibilityNotes),
    accessibilityCheckedAt: mapCheckedAt(raw.accessibilityCheckedAt),
  }
}

function assertApprovedKeys(item: ApprovedPoiRecord) {
  const keys = Object.keys(item)
  for (const key of keys) {
    if (!(APPROVED_POI_FIELD_KEYS as readonly string[]).includes(key)) {
      throw new Error(`Unexpected POI field "${key}"`)
    }
  }
}

function buildWhere(args: SearchPoisArgs): Record<string, unknown> {
  const and: Record<string, unknown>[] = []
  if (args.query) {
    and.push({
      OR: [
        { name: { contains: args.query } },
        { nickname: { contains: args.query } },
        { address: { contains: args.query } },
      ],
    })
  }
  if (args.notesKeyword) {
    and.push({ accessibilityNotes: { contains: args.notesKeyword } })
  }
  if (args.disabledFacilitiesStatus) {
    and.push({ disabledFacilitiesStatus: { equals: args.disabledFacilitiesStatus } })
  }
  if (args.accessibilityStatus) {
    and.push({ accessibilityStatus: { equals: args.accessibilityStatus } })
  }
  if (args.uncheckedOnly) {
    and.push({ accessibilityCheckedAt: { equals: null } })
  } else if (args.checkedBefore) {
    and.push({ accessibilityCheckedAt: { lt: args.checkedBefore } })
  }
  if (and.length === 0) return {}
  if (and.length === 1) return and[0]
  return { AND: and }
}

function appliedFilters(args: SearchPoisArgs): AppliedSearchFilters {
  return {
    query: args.query,
    type: args.type ?? 'all',
    disabledFacilitiesStatus: args.disabledFacilitiesStatus,
    accessibilityStatus: args.accessibilityStatus,
    notesKeyword: args.notesKeyword,
    checkedBefore: args.checkedBefore,
    uncheckedOnly: args.uncheckedOnly,
    take: args.take,
    skip: args.skip,
    resultOrder: args.type ? 'single_list' : 'occupant_then_amenity',
  }
}

function successResult(
  args: SearchPoisArgs,
  items: ApprovedPoiRecord[],
  totalCount: number
): SearchPoisResult {
  return {
    ok: true,
    items,
    truncated: totalCount > args.skip + items.length,
    totalCount,
    returnedCount: items.length,
    appliedFilters: appliedFilters(args),
  }
}

async function searchOneList(
  context: AssistantContext,
  type: PoiListType,
  where: Record<string, unknown>,
  take: number,
  skip: number
): Promise<{ items: ApprovedPoiRecord[]; totalCount: number }> {
  const api = listApi(context, type)
  const [rows, totalCount] = await Promise.all([
    api.findMany({
      where,
      take,
      skip,
      query: POI_QUERY_FIELDS,
    }),
    api.count({ where }),
  ])
  const items = rows.map(row => {
    const item = mapApprovedPoi(type, row)
    assertApprovedKeys(item)
    return item
  })
  return { items, totalCount }
}

export async function searchPois(context: AssistantContext, rawArgs: unknown): Promise<SearchPoisResult> {
  const auth = await requireAssistantUser(context)
  if (!auth.ok) return auth

  const parsed = parseSearchPoisArgs(rawArgs)
  if (!parsed.ok) return parsed

  const args = parsed.value
  const where = buildWhere(args)
  const types: PoiListType[] = args.type ? [args.type] : ['occupant', 'amenity']

  if (types.length === 1) {
    const result = await searchOneList(context, types[0], where, args.take, args.skip)
    return successResult(args, result.items, result.totalCount)
  }

  const occupantCount = await listApi(context, 'occupant').count({ where })
  const amenityCount = await listApi(context, 'amenity').count({ where })
  const totalCount = occupantCount + amenityCount
  const items: ApprovedPoiRecord[] = []

  if (args.skip < occupantCount) {
    const occupantTake = Math.min(args.take, occupantCount - args.skip)
    const occupants = await searchOneList(context, 'occupant', where, occupantTake, args.skip)
    items.push(...occupants.items)
    const remaining = args.take - items.length
    if (remaining > 0 && amenityCount > 0) {
      const amenities = await searchOneList(context, 'amenity', where, remaining, 0)
      items.push(...amenities.items)
    }
  } else {
    const amenitySkip = args.skip - occupantCount
    const amenities = await searchOneList(context, 'amenity', where, args.take, amenitySkip)
    items.push(...amenities.items)
  }

  return successResult(args, items, totalCount)
}

export async function getPoi(context: AssistantContext, rawArgs: unknown): Promise<GetPoiResult> {
  const auth = await requireAssistantUser(context)
  if (!auth.ok) return auth

  const parsed = parseGetPoiArgs(rawArgs)
  if (!parsed.ok) return parsed

  const args: GetPoiArgs = parsed.value
  const row = await listApi(context, args.type).findOne({
    where: { id: args.id },
    query: POI_QUERY_FIELDS,
  })
  if (!row) return { ok: false, error: 'POI not found' }

  const item = mapApprovedPoi(args.type, row)
  assertApprovedKeys(item)
  return { ok: true, item }
}
