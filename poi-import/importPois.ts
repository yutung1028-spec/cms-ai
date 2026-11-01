import type { KeystoneContext } from '@keystone-6/core/types'
import { importPoisAuthError } from './can-import.ts'
import { mapPoiCreateData, parsePoiImportJson } from './validate.ts'

export type PoiImportCreatedItem = {
  index: number
  type: string
  id: string
}

export type PoiImportResult = {
  ok: boolean
  error: string | null
  createdOccupantCount: number
  createdAmenityCount: number
  items: PoiImportCreatedItem[]
}

function fail(error: string): PoiImportResult {
  return {
    ok: false,
    error,
    createdOccupantCount: 0,
    createdAmenityCount: 0,
    items: [],
  }
}

export async function importPois(context: KeystoneContext, payload: string): Promise<PoiImportResult> {
  const authError = importPoisAuthError(context.session)
  if (authError) return fail(authError)

  const parsed = parsePoiImportJson(payload)
  if (!parsed.ok) {
    return fail(parsed.error ?? 'Validation failed')
  }

  try {
    const created = await context.transaction(async tx => {
      const items: PoiImportCreatedItem[] = []
      for (const row of parsed.items) {
        const data = mapPoiCreateData(row.value)
        if (row.value.type === 'occupant') {
          const item = await tx.db.Occupant.createOne({ data })
          items.push({ index: row.index, type: 'occupant', id: String(item.id) })
        } else {
          const item = await tx.db.Amenity.createOne({ data })
          items.push({ index: row.index, type: 'amenity', id: String(item.id) })
        }
      }
      return items
    })

    return {
      ok: true,
      error: null,
      createdOccupantCount: created.filter(item => item.type === 'occupant').length,
      createdAmenityCount: created.filter(item => item.type === 'amenity').length,
      items: created,
    }
  } catch (error) {
    console.error('importPois failed:', error)
    return fail('Import failed')
  }
}
