import type { KeystoneContext } from '@keystone-6/core/types'
import { isAllowedAssistantEmail } from './allowed-assistants.ts'

type SessionLike = {
  itemId?: unknown
}

export type AssistantUser = {
  id: string
  email: string
}

function sessionItemId(session: unknown): string | null {
  if (!session || typeof session !== 'object') return null
  const itemId = (session as SessionLike).itemId
  return typeof itemId === 'string' && itemId !== '' ? itemId : null
}

export async function requireAssistantUser(
  context: Pick<KeystoneContext, 'session' | 'query'>
): Promise<{ ok: true; user: AssistantUser } | { ok: false; error: string }> {
  const itemId = sessionItemId(context.session)
  if (!itemId) return { ok: false, error: 'Authentication required' }

  const user = await context.query.User.findOne({
    where: { id: itemId },
    query: 'id email',
  })
  if (!user || typeof user.id !== 'string' || !isAllowedAssistantEmail(user.email)) {
    return { ok: false, error: 'Not authorised to use the accessibility assistant' }
  }

  return { ok: true, user: { id: user.id, email: user.email } }
}
