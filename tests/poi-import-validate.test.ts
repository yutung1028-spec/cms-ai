import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { canImportPois, importPoisAuthError } from '../poi-import/can-import.ts'
import {
  MAX_POI_IMPORT_BYTES,
  mapPoiCreateData,
  parsePoiImportJson,
} from '../poi-import/validate.ts'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/poi-import')

function readFixture(name: string): string {
  return readFileSync(join(fixtures, name), 'utf8')
}

test('valid mixed occupant and amenity payload', () => {
  const result = parsePoiImportJson(readFixture('valid-mixed.json'))
  assert.equal(result.ok, true)
  assert.equal(result.summary.total, 2)
  assert.equal(result.summary.occupant, 1)
  assert.equal(result.summary.amenity, 1)
  assert.equal(result.summary.valid, 2)
  assert.equal(result.summary.invalid, 0)
  assert.deepEqual(mapPoiCreateData(result.items[0].value), {
    name: 'Example Shop',
    nickname: 'Shop A',
    address: '',
    lnglat: { lng: 114.1694, lat: 22.3193 },
    disabledFacilitiesStatus: 'unknown',
    accessibilityStatus: 'unknown',
    accessibilityNotes: '',
  })
})

test('new accessibility fields import and invalid enums or timestamps are rejected', () => {
  const valid = parsePoiImportJson(readFixture('valid-accessibility.json'))
  assert.equal(valid.ok, true)
  assert.deepEqual(mapPoiCreateData(valid.items[0].value), {
    name: 'Step-free Shop',
    nickname: 'Shop B',
    address: '',
    lnglat: { lng: 114.17, lat: 22.32 },
    disabledFacilitiesStatus: 'available',
    accessibilityStatus: 'partially_accessible',
    accessibilityNotes: 'Side door is step-free; staff assistance needed.',
    accessibilityCheckedAt: '2026-11-01T05:00:00+08:00',
  })
  assert.equal(parsePoiImportJson(readFixture('invalid-status-enum.json')).ok, false)
  assert.equal(parsePoiImportJson(readFixture('invalid-status-empty.json')).ok, false)
  assert.equal(parsePoiImportJson(readFixture('invalid-checked-at.json')).ok, false)
})

test('rejects unknown type, missing name, bad coords, unknown fields, version, empty pois', () => {
  assert.equal(parsePoiImportJson(readFixture('invalid-unknown-type.json')).ok, false)
  assert.equal(parsePoiImportJson(readFixture('invalid-missing-name.json')).ok, false)
  assert.equal(parsePoiImportJson(readFixture('invalid-coords.json')).ok, false)
  assert.match(parsePoiImportJson(readFixture('invalid-unknown-field.json')).previews[0].errors.join(' '), /id/)
  assert.match(parsePoiImportJson(readFixture('invalid-version.json')).error ?? '', /version/)
  assert.equal(parsePoiImportJson(readFixture('invalid-empty-pois.json')).ok, false)
})

test('rejects invalid JSON and payloads larger than 1 MiB', () => {
  assert.equal(parsePoiImportJson('{').ok, false)
  const oversized = `{"version":1,"pois":[{"type":"occupant","name":"${'x'.repeat(MAX_POI_IMPORT_BYTES)}"}]}`
  assert.equal(parsePoiImportJson(oversized).ok, false)
})

test('does not spread unknown fields into create data', () => {
  const mapped = mapPoiCreateData({
    type: 'occupant',
    name: 'Only Mapped',
    nickname: 'N',
    lnglat: { lng: 1, lat: 2 },
    disabledFacilitiesStatus: 'unknown',
    accessibilityStatus: 'unknown',
  })
  assert.deepEqual(Object.keys(mapped).sort(), [
    'accessibilityNotes',
    'accessibilityStatus',
    'address',
    'disabledFacilitiesStatus',
    'lnglat',
    'name',
    'nickname',
  ])
})

test('anonymous and non-allowlisted sessions cannot import', () => {
  assert.equal(canImportPois(undefined), false)
  assert.equal(importPoisAuthError(undefined), 'Authentication required')
  assert.equal(
    importPoisAuthError({ itemId: 'user-1', data: { email: 'not-allowed@example.com' } }),
    'Not authorised to import POIs'
  )
  assert.equal(canImportPois({ itemId: 'user-1', data: { email: 'not-allowed@example.com' } }), false)
})
