import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getPoi, searchPois } from '../accessibility-search/poi-query.ts'
import { APPROVED_POI_FIELD_KEYS } from '../accessibility-search/poi-fields.ts'

type Row = Record<string, unknown>

type MockUser = { id: string; email: string }

function contains(value: unknown, q: string): boolean {
  return typeof value === 'string' && value.includes(q)
}

function applyWhere(rows: Row[], where: Record<string, unknown> = {}): Row[] {
  if (where.AND && Array.isArray(where.AND)) {
    return where.AND.reduce((acc: Row[], part) => applyWhere(acc, part as Record<string, unknown>), rows)
  }
  if (where.OR && Array.isArray(where.OR)) {
    return rows.filter(row =>
      (where.OR as Record<string, unknown>[]).some(part => applyWhere([row], part).length === 1)
    )
  }
  if (where.name && typeof where.name === 'object' && where.name !== null && 'contains' in where.name) {
    return rows.filter(row => contains(row.name, String((where.name as { contains: string }).contains)))
  }
  if (where.nickname && typeof where.nickname === 'object' && 'contains' in (where.nickname as object)) {
    return rows.filter(row =>
      contains(row.nickname, String((where.nickname as { contains: string }).contains))
    )
  }
  if (where.address && typeof where.address === 'object' && 'contains' in (where.address as object)) {
    return rows.filter(row =>
      contains(row.address, String((where.address as { contains: string }).contains))
    )
  }
  if (where.accessibilityStatus && typeof where.accessibilityStatus === 'object') {
    return rows.filter(
      row => row.accessibilityStatus === (where.accessibilityStatus as { equals: string }).equals
    )
  }
  if (where.disabledFacilitiesStatus && typeof where.disabledFacilitiesStatus === 'object') {
    return rows.filter(
      row => row.disabledFacilitiesStatus === (where.disabledFacilitiesStatus as { equals: string }).equals
    )
  }
  if (where.accessibilityNotes && typeof where.accessibilityNotes === 'object' && 'contains' in where.accessibilityNotes) {
    return rows.filter(row =>
      contains(row.accessibilityNotes, String((where.accessibilityNotes as { contains: string }).contains))
    )
  }
  if (where.accessibilityCheckedAt && typeof where.accessibilityCheckedAt === 'object') {
    const filter = where.accessibilityCheckedAt as { equals?: unknown; lt?: string }
    if ('equals' in filter && (filter.equals === null || filter.equals === undefined)) {
      return rows.filter(row => row.accessibilityCheckedAt == null || row.accessibilityCheckedAt === '')
    }
    if (typeof filter.lt === 'string') {
      return rows.filter(row => typeof row.accessibilityCheckedAt === 'string' && row.accessibilityCheckedAt < filter.lt)
    }
  }
  return rows
}

function createContext(options: {
  session?: { itemId: string; data?: { email?: string } } | null
  users: MockUser[]
  occupants: Row[]
  amenities: Row[]
  denyOccupantRead?: boolean
  denyAmenityRead?: boolean
}) {
  let sudoCalls = 0
  const occupantsVisible = () => (options.denyOccupantRead ? [] : options.occupants)
  const amenitiesVisible = () => (options.denyAmenityRead ? [] : options.amenities)

  const listApi = (rows: () => Row[]) => ({
    async findMany(args: { where?: Record<string, unknown>; take?: number; skip?: number }) {
      const filtered = applyWhere(rows(), args.where)
      const skip = args.skip ?? 0
      const take = args.take ?? filtered.length
      return filtered.slice(skip, skip + take)
    },
    async findOne(args: { where: { id: string } }) {
      return rows().find(row => row.id === args.where.id) ?? null
    },
    async count(args?: { where?: Record<string, unknown> }) {
      return applyWhere(rows(), args?.where).length
    },
  })

  return {
    sudoCalls: () => sudoCalls,
    context: {
      session: options.session,
      sudo() {
        sudoCalls += 1
        throw new Error('sudo must not be used')
      },
      query: {
        User: {
          async findOne(args: { where: { id: string } }) {
            const user = options.users.find(item => item.id === args.where.id)
            return user ? { id: user.id, email: user.email } : null
          },
        },
        Occupant: listApi(occupantsVisible),
        Amenity: listApi(amenitiesVisible),
      },
    },
  }
}

const admin = { id: 'user-admin', email: 'admin@example.com' }
const other = { id: 'user-other', email: 'other@example.com' }

const occupantShop: Row = {
  id: 'occ-1',
  name: 'Example Shop',
  nickname: 'Shop A',
  lnglat: { lng: 114.16, lat: 22.31 },
  disabledFacilitiesStatus: 'available',
  accessibilityStatus: 'accessible',
  accessibilityNotes: 'Step-free entrance',
  accessibilityCheckedAt: '2026-11-01T05:00:00.000Z',
  secret: 'must-not-leak',
}

const occupantCafe: Row = {
  id: 'occ-2',
  name: 'Example Cafe',
  nickname: '',
  lnglat: null,
  disabledFacilitiesStatus: 'unknown',
  accessibilityStatus: 'unknown',
  accessibilityNotes: '',
}

const amenityToilet: Row = {
  id: 'ame-1',
  name: 'Accessible Toilet',
  nickname: '',
  lnglat: { lng: 114.17, lat: 22.32 },
  disabledFacilitiesStatus: 'available',
  accessibilityStatus: 'partially_accessible',
  accessibilityNotes: 'Staff assistance',
  accessibilityCheckedAt: null,
}

test('unauthenticated search and get are rejected', async () => {
  const { context, sudoCalls } = createContext({
    session: null,
    users: [admin],
    occupants: [occupantShop],
    amenities: [amenityToilet],
  })
  const search = await searchPois(context, {})
  const got = await getPoi(context, { type: 'occupant', id: 'occ-1' })
  assert.equal(search.ok, false)
  if (!search.ok) assert.equal(search.error, 'Authentication required')
  assert.equal(got.ok, false)
  if (!got.ok) assert.equal(got.error, 'Authentication required')
  assert.equal(sudoCalls(), 0)
})

test('non-allowlisted account is rejected even with a session', async () => {
  const { context } = createContext({
    session: { itemId: other.id },
    users: [admin, other],
    occupants: [occupantShop],
    amenities: [],
  })
  const result = await searchPois(context, { query: 'Example' })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error, 'Not authorised to use the accessibility assistant')
})

test('frontend-supplied email or userId is ignored', async () => {
  const spoofedIdentity = createContext({
    session: { itemId: other.id, data: { email: admin.email } },
    users: [admin, other],
    occupants: [occupantShop],
    amenities: [],
  })
  const spoofedSession = await searchPois(spoofedIdentity.context, {
    query: 'Example',
    email: 'admin@example.com',
    userId: admin.id,
    role: 'admin',
  })
  assert.equal(spoofedSession.ok, false)
  if (!spoofedSession.ok) {
    assert.equal(spoofedSession.error, 'Not authorised to use the accessibility assistant')
  }

  const allowlisted = createContext({
    session: { itemId: admin.id },
    users: [admin],
    occupants: [occupantShop],
    amenities: [],
  })
  const extraFields = await searchPois(allowlisted.context, {
    query: 'Example',
    email: 'admin@example.com',
    userId: admin.id,
    role: 'admin',
  })
  assert.equal(extraFields.ok, false)
  if (!extraFields.ok) assert.match(extraFields.error, /Unknown field/)
})

test('allowlisted user still cannot read POIs denied by list access', async () => {
  const { context, sudoCalls } = createContext({
    session: { itemId: admin.id },
    users: [admin],
    occupants: [occupantShop],
    amenities: [amenityToilet],
    denyOccupantRead: true,
  })
  const search = await searchPois(context, { type: 'occupant' })
  const got = await getPoi(context, { type: 'occupant', id: 'occ-1' })
  assert.equal(search.ok, true)
  if (search.ok) {
    assert.equal(search.items.length, 0)
    assert.equal(search.totalCount, 0)
  }
  assert.equal(got.ok, false)
  if (!got.ok) assert.equal(got.error, 'POI not found')
  assert.equal(sudoCalls(), 0)
})

test('invalid parameters, unknown type, and over-limit take are rejected', async () => {
  const { context } = createContext({
    session: { itemId: admin.id },
    users: [admin],
    occupants: [occupantShop],
    amenities: [],
  })
  const unknownType = await searchPois(context, { type: 'user' })
  const overTake = await searchPois(context, { take: 21 })
  const graphql = await searchPois(context, { query: '{ occupant { password } }', sql: 'select 1' })
  const badGet = await getPoi(context, { type: 'occupant' })
  assert.equal(unknownType.ok, false)
  assert.equal(overTake.ok, false)
  assert.equal(graphql.ok, false)
  assert.equal(badGet.ok, false)
})

test('allowlisted user can search Occupant and Amenity', async () => {
  const { context, sudoCalls } = createContext({
    session: { itemId: admin.id },
    users: [admin],
    occupants: [occupantShop, occupantCafe],
    amenities: [amenityToilet],
  })
  const occupants = await searchPois(context, { type: 'occupant', query: 'Example' })
  const amenities = await searchPois(context, { type: 'amenity', query: 'Toilet' })
  const both = await searchPois(context, { query: 'Example' })
  assert.equal(occupants.ok, true)
  if (occupants.ok) {
    assert.equal(occupants.items.length, 2)
    assert.equal(occupants.items[0].type, 'occupant')
    assert.deepEqual(Object.keys(occupants.items[0]).sort(), [...APPROVED_POI_FIELD_KEYS].sort())
    assert.equal('secret' in occupants.items[0], false)
  }
  assert.equal(amenities.ok, true)
  if (amenities.ok) {
    assert.equal(amenities.items.length, 1)
    assert.equal(amenities.items[0].id, 'ame-1')
    assert.equal(amenities.items[0].accessibilityCheckedAt, null)
  }
  assert.equal(both.ok, true)
  if (both.ok) assert.equal(both.items.every(item => item.type === 'occupant'), true)
  const one = await getPoi(context, { type: 'amenity', id: 'ame-1' })
  assert.equal(one.ok, true)
  if (one.ok) assert.equal(one.item.accessibilityNotes, 'Staff assistance')
  assert.equal(sudoCalls(), 0)
})

test('empty results and missing verification date', async () => {
  const { context } = createContext({
    session: { itemId: admin.id },
    users: [admin],
    occupants: [occupantCafe],
    amenities: [],
  })
  const empty = await searchPois(context, { query: 'No Such Place' })
  const cafe = await getPoi(context, { type: 'occupant', id: 'occ-2' })
  assert.equal(empty.ok, true)
  if (empty.ok) {
    assert.equal(empty.items.length, 0)
    assert.equal(empty.truncated, false)
  }
  assert.equal(cafe.ok, true)
  if (cafe.ok) assert.equal(cafe.item.accessibilityCheckedAt, null)
})

test('results are truncated at take and never use sudo', async () => {
  const occupants = Array.from({ length: 5 }, (_, index) => ({
    id: `occ-${index}`,
    name: `Place ${index}`,
    nickname: '',
    lnglat: null,
    disabledFacilitiesStatus: 'unknown',
    accessibilityStatus: 'unknown',
    accessibilityNotes: '',
  }))
  const { context, sudoCalls } = createContext({
    session: { itemId: admin.id },
    users: [admin],
    occupants,
    amenities: [],
  })
  const result = await searchPois(context, { type: 'occupant', take: 2 })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.items.length, 2)
    assert.equal(result.totalCount, 5)
    assert.equal(result.truncated, true)
  }
  assert.equal(sudoCalls(), 0)
})
