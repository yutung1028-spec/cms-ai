import { g } from '@keystone-6/core'
import { createPoiFromTextDraft } from './create.ts'

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

export const extendPoiFromTextSchema = g.extend({
  mutation: {
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
