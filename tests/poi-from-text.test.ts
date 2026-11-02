import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { unlinkSync } from 'node:fs'
import { list } from '@keystone-6/core'
import { allowAll } from '@keystone-6/core/access'
import { json, text } from '@keystone-6/core/fields'
import { poiAccessibilityFields } from '../poi-accessibility.ts'
import { createIsolatedContext, createIsolatedDbFile } from './helpers/isolated-keystone.ts'
import { lists } from '../schema.ts'
import { MAX_POI_FROM_TEXT_CHARS } from '../poi-from-text/limits.ts'
import { parsePoiFromTextDraft } from '../poi-from-text/parse-draft.ts'
import {
  clearDraft,
  isCreateSubmitDisabled,
  loadDraft,
  saveDraft,
  type DraftStorage,
} from '../poi-from-text/draft-state.ts'
import { parseCreatePoiFromTextInput } from '../poi-from-text/validate-create.ts'
import { createPoiFromTextDraft } from '../poi-from-text/create.ts'
import { emptyPoiFromTextFields } from '../poi-from-text/types.ts'

const LABELLED = `名稱：晨光咖啡館
地址：幸福路 10 號
備註：入口沒有梯級，店內設有無障礙洗手間。`

const PARAGRAPH = '幸福路附近有一間咖啡店，入口沒有梯級，店內設有無障礙洗手間。'

class MemoryStorage implements DraftStorage {
  #items = new Map<string, string>()
  getItem(key: string) {
    return this.#items.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.#items.set(key, value)
  }
  removeItem(key: string) {
    this.#items.delete(key)
  }
}

const CREATE_MUTATION = `
  mutation CreatePoiFromTextDraft(
    $type: String!
    $name: String!
    $nickname: String
    $address: String
    $lng: Float
    $lat: Float
    $disabledFacilitiesStatus: String
    $accessibilityStatus: String
    $accessibilityNotes: String
    $accessibilityCheckedAt: String
  ) {
    createPoiFromTextDraft(
      type: $type
      name: $name
      nickname: $nickname
      address: $address
      lng: $lng
      lat: $lat
      disabledFacilitiesStatus: $disabledFacilitiesStatus
      accessibilityStatus: $accessibilityStatus
      accessibilityNotes: $accessibilityNotes
      accessibilityCheckedAt: $accessibilityCheckedAt
    ) {
      ok
      error
      type
      id
      adminPath
    }
  }
`

test('empty or oversized input cannot generate a draft', () => {
  assert.equal(parsePoiFromTextDraft('   ', 'occupant').ok, false)
  assert.equal(parsePoiFromTextDraft('', 'occupant').ok, false)
  assert.equal(parsePoiFromTextDraft('x'.repeat(MAX_POI_FROM_TEXT_CHARS + 1), 'occupant').ok, false)
})

test('labelled sample input produces deterministic field suggestions', () => {
  const parsed = parsePoiFromTextDraft(LABELLED, 'occupant')
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.draft.parser, 'phase-one-demo')
  assert.equal(parsed.draft.fields.name, '晨光咖啡館')
  assert.equal(parsed.draft.fields.address, '幸福路 10 號')
  assert.equal(parsed.draft.fields.accessibilityNotes, '入口沒有梯級，店內設有無障礙洗手間。')
  assert.equal(parsed.draft.fields.disabledFacilitiesStatus, 'unknown')
  assert.equal(parsed.draft.fields.accessibilityStatus, 'unknown')
  assert.equal(parsed.draft.fields.accessibilityCheckedAt, '')
  assert.equal(parsed.draft.unmapped.some(item => item.label === '地址'), false)
})

test('ordinary paragraph is preserved without invented field values', () => {
  const parsed = parsePoiFromTextDraft(PARAGRAPH, 'amenity')
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.draft.source, PARAGRAPH)
  assert.equal(parsed.draft.type, 'amenity')
  assert.deepEqual(parsed.draft.fields, emptyPoiFromTextFields())
})

test('missing accessibility information is not converted to unavailable and no timestamp is invented', () => {
  const parsed = parsePoiFromTextDraft(LABELLED, 'occupant')
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.notEqual(parsed.draft.fields.disabledFacilitiesStatus, 'unavailable')
  assert.notEqual(parsed.draft.fields.accessibilityStatus, 'not_accessible')
  assert.equal(parsed.draft.fields.accessibilityCheckedAt, '')
})

test('draft storage round-trip, missing state, return/edit/cancel stay client-side', () => {
  const storage = new MemoryStorage()
  assert.equal(loadDraft(storage), null)
  const parsed = parsePoiFromTextDraft(LABELLED, 'occupant')
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  saveDraft(storage, parsed.draft)
  const loaded = loadDraft(storage)
  assert.equal(loaded?.fields.name, '晨光咖啡館')
  loaded.fields.name = '修改後名稱'
  saveDraft(storage, loaded)
  assert.equal(loadDraft(storage)?.fields.name, '修改後名稱')
  clearDraft(storage)
  assert.equal(loadDraft(storage), null)
})

test('create submit is disabled while pending or when name is empty', () => {
  assert.equal(isCreateSubmitDisabled(true, '晨光咖啡館'), true)
  assert.equal(isCreateSubmitDisabled(false, '   '), true)
  assert.equal(isCreateSubmitDisabled(false, '晨光咖啡館'), false)
})

test('backend create validation rejects id and empty name', () => {
  assert.equal(parseCreatePoiFromTextInput({ type: 'occupant', name: 'A', id: 'x' }).ok, false)
  assert.equal(parseCreatePoiFromTextInput({ type: 'occupant', name: '   ' }).ok, false)
})

const filename = createIsolatedDbFile('poi-from-text')
const context = createIsolatedContext(filename)
const adminSession = { itemId: 'user-admin', listKey: 'User', data: { email: 'admin@example.com' } }

before(async () => {
  await context.prisma.user.create({
    data: { id: 'user-admin', name: 'admin', email: 'admin@example.com', password: 'test-hash' },
  })
})

after(() => {
  try {
    unlinkSync(filename)
  } catch {
    // ignore leftover temp db
  }
})

test('parse and confirmation navigation perform no database writes', async () => {
  const beforeCount = await context.prisma.occupant.count()
  parsePoiFromTextDraft(LABELLED, 'occupant')
  const storage = new MemoryStorage()
  const parsed = parsePoiFromTextDraft(LABELLED, 'occupant')
  if (parsed.ok) saveDraft(storage, parsed.draft)
  const loaded = loadDraft(storage)
  if (loaded) {
    loaded.fields.nickname = 'edited'
    saveDraft(storage, loaded)
  }
  clearDraft(storage)
  assert.equal(await context.prisma.occupant.count(), beforeCount)
})

test('final confirmation creates the record using the authenticated create path', async () => {
  const beforeCount = await context.prisma.occupant.count()
  const result = await createPoiFromTextDraft(context.withSession(adminSession), {
    type: 'occupant',
    name: '晨光咖啡館',
    nickname: '',
    address: '幸福路 10 號',
    accessibilityNotes: '入口沒有梯級，店內設有無障礙洗手間。',
    disabledFacilitiesStatus: 'unknown',
    accessibilityStatus: 'unknown',
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(await context.prisma.occupant.count(), beforeCount + 1)
  const created = await context.prisma.occupant.findUnique({ where: { id: result.id } })
  assert.equal(created?.name, '晨光咖啡館')
  assert.equal(created?.address, '幸福路 10 號')
  assert.equal(created?.disabledFacilitiesStatus, 'unknown')
  assert.equal(created?.accessibilityCheckedAt, null)
  assert.equal(result.adminPath, `/occupants/${result.id}`)
})

test('unauthenticated creation is rejected', async () => {
  const beforeCount = await context.prisma.occupant.count()
  const result = await createPoiFromTextDraft(context, {
    type: 'occupant',
    name: 'Should Not Exist',
  })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.error, 'Authentication required')
  assert.equal(await context.prisma.occupant.count(), beforeCount)
})

test('failed creation preserves the client draft and writes nothing', async () => {
  const storage = new MemoryStorage()
  const parsed = parsePoiFromTextDraft(LABELLED, 'occupant')
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  saveDraft(storage, parsed.draft)
  const beforeCount = await context.prisma.occupant.count()
  const failed = await createPoiFromTextDraft(context.withSession(adminSession), {
    type: 'occupant',
    name: 'Broken Time',
    accessibilityCheckedAt: 'not-a-date',
  })
  assert.equal(failed.ok, false)
  assert.equal(await context.prisma.occupant.count(), beforeCount)
  assert.equal(loadDraft(storage)?.fields.name, '晨光咖啡館')
})

test('list create ACL rejects unauthorised creation', async () => {
  const aclFile = createIsolatedDbFile('poi-from-text-acl')
  const restrictedLists = {
    ...lists,
    Occupant: list({
      access: {
        operation: {
          query: allowAll,
          create: () => false,
          update: allowAll,
          delete: allowAll,
        },
      },
      fields: {
        name: text({ validation: { isRequired: true } }),
        nickname: text(),
        address: text(),
        lnglat: json(),
        ...poiAccessibilityFields(),
      },
    }),
  }
  const aclContext = createIsolatedContext(aclFile, restrictedLists)
  await aclContext.prisma.user.create({
    data: { id: 'user-admin', name: 'admin', email: 'admin@example.com', password: 'test-hash' },
  })
  const result = (await aclContext.withSession(adminSession).graphql.run({
    query: CREATE_MUTATION,
    variables: { type: 'occupant', name: 'Denied' },
  })) as { createPoiFromTextDraft: { ok: boolean; error: string | null; id: string | null } }
  assert.equal(result.createPoiFromTextDraft.ok, false)
  assert.equal(result.createPoiFromTextDraft.id, null)
  assert.equal(await aclContext.prisma.occupant.count(), 0)
  try {
    unlinkSync(aclFile)
  } catch {
    // ignore leftover temp db
  }
})
