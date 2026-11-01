import { g } from '@keystone-6/core'
import { importPois } from './importPois.ts'
import type { PoiImportCreatedItem, PoiImportResult } from './importPois.ts'

const PoiImportCreatedItemType = g.object<PoiImportCreatedItem>()({
  name: 'PoiImportCreatedItem',
  fields: {
    index: g.field({ type: g.nonNull(g.Int) }),
    type: g.field({ type: g.nonNull(g.String) }),
    id: g.field({ type: g.nonNull(g.ID) }),
  },
})

const PoiImportResultType = g.object<PoiImportResult>()({
  name: 'PoiImportResult',
  fields: {
    ok: g.field({ type: g.nonNull(g.Boolean) }),
    error: g.field({ type: g.String }),
    createdOccupantCount: g.field({ type: g.nonNull(g.Int) }),
    createdAmenityCount: g.field({ type: g.nonNull(g.Int) }),
    items: g.field({ type: g.nonNull(g.list(g.nonNull(PoiImportCreatedItemType))) }),
  },
})

export const extendPoiImportSchema = g.extend({
  mutation: {
    importPois: g.field({
      type: g.nonNull(PoiImportResultType),
      args: {
        payload: g.arg({ type: g.nonNull(g.String) }),
      },
      resolve(_root, { payload }, context) {
        return importPois(context, payload)
      },
    }),
  },
})
