import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { unlinkSync } from 'node:fs'
import { list } from '@keystone-6/core'
import { allowAll } from '@keystone-6/core/access'
import { json, text } from '@keystone-6/core/fields'
import { poiAccessibilityFields } from '../poi-accessibility.ts'
import {
  createIsolatedContext,
  createIsolatedDbFile,
  ASK_MUTATION,
  GET_QUERY,
  SEARCH_QUERY,
} from './helpers/isolated-keystone.ts'
import { lists } from '../schema.ts'

type SearchPayload = {
  searchAccessibilityPois: {
    ok: boolean
    error: string | null
    truncated: boolean
    totalCount: number
    returnedCount: number
    items: {
      type: string
      id: string
      name: string
      nickname: string
      disabledFacilitiesStatus: string
      accessibilityStatus: string
      accessibilityNotes: string
      accessibilityCheckedAt: string | null
      adminPath: string
    }[]
  }
}

type GetPayload = {
  getAccessibilityPoi: {
    ok: boolean
    error: string | null
    item: { id: string; name: string; accessibilityCheckedAt: string | null; adminPath: string } | null
  }
}

const filename = createIsolatedDbFile('accessibility-search')
const context = createIsolatedContext(filename)
const adminSession = { itemId: 'user-admin', listKey: 'User', data: { email: 'admin@example.com' } }
const otherSession = { itemId: 'user-other', listKey: 'User', data: { email: 'other@example.com' } }

before(async () => {
  await context.prisma.user.createMany({
    data: [
      { id: 'user-admin', name: 'admin', email: 'admin@example.com', password: 'test-hash' },
      { id: 'user-other', name: 'other', email: 'other@example.com', password: 'test-hash' },
    ],
  })
  await context.prisma.occupant.createMany({
    data: [
      {
        id: 'occ-shop',
        name: 'Example Shop',
        nickname: 'Shop A',
        disabledFacilitiesStatus: 'available',
        accessibilityStatus: 'accessible',
        accessibilityNotes: 'Step-free entrance',
        accessibilityCheckedAt: new Date('2026-01-15T00:00:00.000Z'),
      },
      {
        id: 'occ-cafe',
        name: 'example cafe',
        nickname: '',
        disabledFacilitiesStatus: 'unknown',
        accessibilityStatus: 'unknown',
        accessibilityNotes: '',
        accessibilityCheckedAt: null,
      },
    ],
  })
  await context.prisma.amenity.create({
    data: {
      id: 'ame-toilet',
      name: 'Accessible Toilet',
      nickname: '',
      disabledFacilitiesStatus: 'available',
      accessibilityStatus: 'partially_accessible',
      accessibilityNotes: 'Staff assistance required',
      accessibilityCheckedAt: new Date('2025-06-01T00:00:00.000Z'),
    },
  })
})

after(() => {
  try {
    unlinkSync(filename)
  } catch {
    // ignore leftover temp db
  }
})

async function search(session: typeof adminSession | null, variables: Record<string, unknown> = {}) {
  const ctx = session ? context.withSession(session) : context
  return ctx.graphql.run({ query: SEARCH_QUERY, variables }) as Promise<SearchPayload>
}

async function getPoi(session: typeof adminSession | null, variables: { type: string; id: string }) {
  const ctx = session ? context.withSession(session) : context
  return ctx.graphql.run({ query: GET_QUERY, variables }) as Promise<GetPayload>
}

test('unauthenticated GraphQL search and get are rejected', async () => {
  const searched = await search(null, { query: 'Example' })
  const got = await getPoi(null, { type: 'occupant', id: 'occ-shop' })
  assert.equal(searched.searchAccessibilityPois.ok, false)
  assert.equal(searched.searchAccessibilityPois.error, 'Authentication required')
  assert.equal(got.getAccessibilityPoi.ok, false)
  assert.equal(got.getAccessibilityPoi.error, 'Authentication required')
})

test('logged-in non-allowlisted account is rejected', async () => {
  const searched = await search(otherSession, { query: 'Example' })
  assert.equal(searched.searchAccessibilityPois.ok, false)
  assert.equal(searched.searchAccessibilityPois.error, 'Not authorised to use the accessibility assistant')
})

test('admin@example.com can search real Occupant and Amenity rows', async () => {
  const occupants = await search(adminSession, { type: 'occupant', query: 'Example' })
  const amenities = await search(adminSession, { type: 'amenity', query: 'Toilet' })
  assert.equal(occupants.searchAccessibilityPois.ok, true)
  assert.ok(occupants.searchAccessibilityPois.items.some(item => item.id === 'occ-shop'))
  assert.equal(amenities.searchAccessibilityPois.ok, true)
  assert.equal(amenities.searchAccessibilityPois.items[0]?.id, 'ame-toilet')
  assert.equal(amenities.searchAccessibilityPois.items[0]?.adminPath, '/amenities/ame-toilet')
})

test('getAccessibilityPoi reads a real Occupant', async () => {
  const got = await getPoi(adminSession, { type: 'occupant', id: 'occ-shop' })
  assert.equal(got.getAccessibilityPoi.ok, true)
  assert.equal(got.getAccessibilityPoi.item?.name, 'Example Shop')
  assert.equal(got.getAccessibilityPoi.item?.adminPath, '/occupants/occ-shop')
})

test('enum, checkedBefore, and uncheckedOnly filters against SQLite', async () => {
  const byEnum = await search(adminSession, {
    type: 'occupant',
    accessibilityStatus: 'accessible',
  })
  const before = await search(adminSession, {
    checkedBefore: '2026-01-01T00:00:00.000Z',
  })
  const unchecked = await search(adminSession, { type: 'occupant', uncheckedOnly: true })
  const notes = await search(adminSession, { notesKeyword: 'Staff assistance' })
  assert.equal(byEnum.searchAccessibilityPois.items.map(item => item.id).join(','), 'occ-shop')
  assert.equal(before.searchAccessibilityPois.items.map(item => item.id).join(','), 'ame-toilet')
  assert.equal(unchecked.searchAccessibilityPois.items.map(item => item.id).join(','), 'occ-cafe')
  assert.equal(notes.searchAccessibilityPois.items.map(item => item.id).join(','), 'ame-toilet')
  assert.equal(unchecked.searchAccessibilityPois.items[0]?.accessibilityCheckedAt, null)
})

test('illegal take and unknown type are rejected by the GraphQL entry', async () => {
  const overTake = await search(adminSession, { take: 21 })
  const unknownType = await search(adminSession, { type: 'user' })
  assert.equal(overTake.searchAccessibilityPois.ok, false)
  assert.match(overTake.searchAccessibilityPois.error ?? '', /take/)
  assert.equal(unknownType.searchAccessibilityPois.ok, false)
  assert.match(unknownType.searchAccessibilityPois.error ?? '', /type/)
})

test('SQLite contains English case behaviour', async () => {
  const upper = await search(adminSession, { type: 'occupant', query: 'EXAMPLE' })
  const mixed = await search(adminSession, { type: 'occupant', query: 'example' })
  const upperIds = upper.searchAccessibilityPois.items.map(item => item.id).sort()
  const mixedIds = mixed.searchAccessibilityPois.items.map(item => item.id).sort()
  assert.deepEqual(upperIds, mixedIds)
  assert.deepEqual(upperIds, ['occ-cafe', 'occ-shop'])
})

test('unconfigured AI ask is rejected while structured search still works', async () => {
  const asked = (await context.withSession(adminSession).graphql.run({
    query: ASK_MUTATION,
    variables: { question: '哪裡有無障礙廁所？' },
  })) as { askAccessibilityAssistant: { ok: boolean; error: string | null; code: string | null } }
  const searched = await search(adminSession, { type: 'occupant', query: 'Example' })
  assert.equal(asked.askAccessibilityAssistant.ok, false)
  assert.equal(asked.askAccessibilityAssistant.error, 'AI 尚未設定')
  assert.equal(searched.searchAccessibilityPois.ok, true)
})

test('isolated list ACL still filters Occupant without changing production schema', async () => {
  const aclFile = createIsolatedDbFile('accessibility-search-acl')
  const restrictedLists = {
    ...lists,
    Occupant: list({
      access: {
        operation: {
          query: () => false,
          create: allowAll,
          update: allowAll,
          delete: allowAll,
        },
      },
      fields: {
        name: text({ validation: { isRequired: true } }),
        nickname: text(),
        lnglat: json(),
        ...poiAccessibilityFields(),
      },
    }),
  }
  const aclContext = createIsolatedContext(aclFile, restrictedLists)
  await aclContext.prisma.user.create({
    data: { id: 'user-admin', name: 'admin', email: 'admin@example.com', password: 'test-hash' },
  })
  await aclContext.prisma.occupant.create({
    data: { id: 'occ-hidden', name: 'Hidden Shop', nickname: '', accessibilityNotes: '' },
  })
  const result = (await aclContext.withSession(adminSession).graphql.run({
    query: SEARCH_QUERY,
    variables: { type: 'occupant' },
  })) as SearchPayload
  assert.equal(result.searchAccessibilityPois.ok, true)
  assert.equal(result.searchAccessibilityPois.items.length, 0)
  try {
    unlinkSync(aclFile)
  } catch {
    // ignore leftover temp db
  }
})
