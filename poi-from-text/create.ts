import type { KeystoneContext } from '@keystone-6/core/types'
import { adminPoiItemPath } from '../accessibility-search/admin-paths.ts'
import { mapPoiCreateData } from '../poi-import/validate.ts'
import { parseCreatePoiFromTextInput } from './validate-create.ts'

export type CreatePoiFromTextResult =
  | { ok: true; error: null; type: 'occupant' | 'amenity'; id: string; adminPath: string }
  | { ok: false; error: string; type: null; id: null; adminPath: null }

function fail(error: string): CreatePoiFromTextResult {
  return { ok: false, error, type: null, id: null, adminPath: null }
}

function sessionUserId(session: unknown): string | null {
  if (!session || typeof session !== 'object') return null
  const itemId = (session as { itemId?: unknown }).itemId
  return typeof itemId === 'string' && itemId !== '' ? itemId : null
}

export async function createPoiFromTextDraft(
  context: Pick<KeystoneContext, 'session' | 'query'>,
  raw: unknown
): Promise<CreatePoiFromTextResult> {
  if (!sessionUserId(context.session)) return fail('Authentication required')

  const parsed = parseCreatePoiFromTextInput(raw)
  if (!parsed.ok) return fail(parsed.error)

  const data = mapPoiCreateData(parsed.value)
  try {
    const created =
      parsed.value.type === 'occupant'
        ? await context.query.Occupant.createOne({ data, query: 'id' })
        : await context.query.Amenity.createOne({ data, query: 'id' })
    if (!created?.id) return fail('Create failed')
    const id = String(created.id)
    return {
      ok: true,
      error: null,
      type: parsed.value.type,
      id,
      adminPath: adminPoiItemPath(parsed.value.type, id),
    }
  } catch {
    return fail('Not authorised to create this POI')
  }
}
