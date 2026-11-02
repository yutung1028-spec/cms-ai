import { g } from '@keystone-6/core'
import { createPoiFromTextDraft } from './create.ts'
import { generatePoiFromTextDraft } from './generate.ts'
import type { PoiFromTextFields } from './types.ts'

const CreatePoiFromTextResultType = g.object<{
  ok: boolean
  error: string | null
  type: string | null
  id: string | null
  adminPath: string | null
}>()({
  name: 'CreatePoiFromTextResult',
  fields: {
    ok: g.field({ type: g.nonNull(g.Boolean) }),
    error: g.field({ type: g.String }),
    type: g.field({ type: g.String }),
    id: g.field({ type: g.ID }),
    adminPath: g.field({ type: g.String }),
  },
})

type GenerateFieldsGraphql = {
  name: string
  nickname: string
  address: string
  lng: number | null
  lat: number | null
  disabledFacilitiesStatus: string
  accessibilityStatus: string
  accessibilityNotes: string
  accessibilityCheckedAt: string
}

const GeneratePoiFromTextFieldsType = g.object<GenerateFieldsGraphql>()({
  name: 'GeneratePoiFromTextFields',
  fields: {
    name: g.field({ type: g.nonNull(g.String) }),
    nickname: g.field({ type: g.nonNull(g.String) }),
    address: g.field({ type: g.nonNull(g.String) }),
    lng: g.field({ type: g.Float }),
    lat: g.field({ type: g.Float }),
    disabledFacilitiesStatus: g.field({ type: g.nonNull(g.String) }),
    accessibilityStatus: g.field({ type: g.nonNull(g.String) }),
    accessibilityNotes: g.field({ type: g.nonNull(g.String) }),
    accessibilityCheckedAt: g.field({ type: g.nonNull(g.String) }),
  },
})

type GenerateGraphqlResult = {
  ok: boolean
  error: string | null
  code: string | null
  source: string | null
  type: string | null
  fields: GenerateFieldsGraphql | null
}

function graphqlFields(fields: PoiFromTextFields): GenerateFieldsGraphql {
  return {
    name: fields.name,
    nickname: fields.nickname,
    address: fields.address,
    lng: fields.lnglat?.lng ?? null,
    lat: fields.lnglat?.lat ?? null,
    disabledFacilitiesStatus: fields.disabledFacilitiesStatus,
    accessibilityStatus: fields.accessibilityStatus,
    accessibilityNotes: fields.accessibilityNotes,
    accessibilityCheckedAt: fields.accessibilityCheckedAt,
  }
}

const GeneratePoiFromTextResultType = g.object<GenerateGraphqlResult>()({
  name: 'GeneratePoiFromTextResult',
  fields: {
    ok: g.field({ type: g.nonNull(g.Boolean) }),
    error: g.field({ type: g.String }),
    code: g.field({ type: g.String }),
    source: g.field({ type: g.String }),
    type: g.field({ type: g.String }),
    fields: g.field({ type: GeneratePoiFromTextFieldsType }),
  },
})

export const extendPoiFromTextSchema = g.extend({
  mutation: {
    generatePoiFromTextDraft: g.field({
      type: g.nonNull(GeneratePoiFromTextResultType),
      args: {
        source: g.arg({ type: g.nonNull(g.String) }),
        type: g.arg({ type: g.nonNull(g.String) }),
      },
      async resolve(_root, args, context) {
        const result = await generatePoiFromTextDraft(context, args.source, args.type)
        if (!result.ok) {
          return {
            ok: false,
            error: result.error,
            code: result.code,
            source: result.source,
            type: result.type,
            fields: null,
          }
        }
        return {
          ok: true,
          error: null,
          code: null,
          source: result.source,
          type: result.type,
          fields: graphqlFields(result.fields),
        }
      },
    }),
    createPoiFromTextDraft: g.field({
      type: g.nonNull(CreatePoiFromTextResultType),
      args: {
        type: g.arg({ type: g.nonNull(g.String) }),
        name: g.arg({ type: g.nonNull(g.String) }),
        nickname: g.arg({ type: g.String }),
        address: g.arg({ type: g.String }),
        lng: g.arg({ type: g.Float }),
        lat: g.arg({ type: g.Float }),
        disabledFacilitiesStatus: g.arg({ type: g.String }),
        accessibilityStatus: g.arg({ type: g.String }),
        accessibilityNotes: g.arg({ type: g.String }),
        accessibilityCheckedAt: g.arg({ type: g.String }),
      },
      resolve(_root, args, context) {
        const lnglat =
          args.lng === null || args.lng === undefined || args.lat === null || args.lat === undefined
            ? undefined
            : { lng: args.lng, lat: args.lat }
        return createPoiFromTextDraft(context, {
          type: args.type,
          name: args.name,
          nickname: args.nickname ?? undefined,
          address: args.address ?? undefined,
          lnglat,
          disabledFacilitiesStatus: args.disabledFacilitiesStatus ?? undefined,
          accessibilityStatus: args.accessibilityStatus ?? undefined,
          accessibilityNotes: args.accessibilityNotes ?? undefined,
          accessibilityCheckedAt: args.accessibilityCheckedAt ?? undefined,
        })
      },
    }),
  },
})
