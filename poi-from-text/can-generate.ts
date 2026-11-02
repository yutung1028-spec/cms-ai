import type { KeystoneContext } from '@keystone-6/core/types'
import type { PoiType } from './types.ts'

type SessionLike = {
  itemId?: unknown
}

function sessionUserId(session: unknown): string | null {
  if (!session || typeof session !== 'object') return null
  const itemId = (session as SessionLike).itemId
  return typeof itemId === 'string' && itemId !== '' ? itemId : null
}

export function generateAuthError(session: unknown): string | null {
  if (!sessionUserId(session)) return 'Authentication required'
  return null
}

type AccessArgs = {
  session: unknown
  context: unknown
  listKey: string
  operation: 'create'
}

async function resolveCreateAccess(access: unknown, args: AccessArgs): Promise<boolean> {
  if (access === true) return true
  if (access === false) return false
  if (typeof access === 'function') {
    return (await access(args)) === true
  }
  if (!access || typeof access !== 'object') return false
  const operation = (access as { operation?: unknown }).operation
  if (operation === true) return true
  if (operation === false) return false
  if (typeof operation === 'function') {
    return (await operation(args)) === true
  }
  if (!operation || typeof operation !== 'object') return false
  const create = (operation as { create?: unknown }).create
  if (create === true) return true
  if (create === false) return false
  if (typeof create === 'function') {
    return (await create(args)) === true
  }
  return false
}

export async function mayCreateSelectedPoi(
  context: Pick<KeystoneContext, 'session'> & {
    __internal?: { lists?: Record<string, { access?: unknown }> }
  },
  type: PoiType
): Promise<boolean> {
  if (!sessionUserId(context.session)) return false
  const listKey = type === 'occupant' ? 'Occupant' : 'Amenity'
  const list = context.__internal?.lists?.[listKey]
  if (!list) return false
  return resolveCreateAccess(list.access, {
    session: context.session,
    context,
    listKey,
    operation: 'create',
  })
}
