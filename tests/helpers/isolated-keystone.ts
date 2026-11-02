import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { config } from '@keystone-6/core'
import { getContext } from '@keystone-6/core/context'
import type { KeystoneConfig } from '@keystone-6/core/types'
import * as PrismaModule from '../../generated/prisma/client.ts'
import { extendPoiImportSchema } from '../../poi-import/graphql.ts'
import { extendAccessibilitySearchSchema } from '../../accessibility-search/graphql.ts'
import { extendPoiFromTextSchema } from '../../poi-from-text/graphql.ts'
import { lists } from '../../schema.ts'

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS "Occupant" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL DEFAULT '',
  "nickname" TEXT NOT NULL DEFAULT '',
  "address" TEXT NOT NULL DEFAULT '',
  "lnglat" TEXT,
  "disabledFacilitiesStatus" TEXT NOT NULL DEFAULT 'unknown',
  "accessibilityStatus" TEXT NOT NULL DEFAULT 'unknown',
  "accessibilityNotes" TEXT NOT NULL DEFAULT '',
  "accessibilityCheckedAt" DATETIME
);
CREATE TABLE IF NOT EXISTS "Amenity" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL DEFAULT '',
  "nickname" TEXT NOT NULL DEFAULT '',
  "address" TEXT NOT NULL DEFAULT '',
  "lnglat" TEXT,
  "disabledFacilitiesStatus" TEXT NOT NULL DEFAULT 'unknown',
  "accessibilityStatus" TEXT NOT NULL DEFAULT 'unknown',
  "accessibilityNotes" TEXT NOT NULL DEFAULT '',
  "accessibilityCheckedAt" DATETIME
);
CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL DEFAULT '',
  "email" TEXT NOT NULL DEFAULT '',
  "password" TEXT NOT NULL,
  "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
CREATE TABLE IF NOT EXISTS "Post" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL DEFAULT '',
  "status" TEXT DEFAULT 'draft',
  "content" TEXT NOT NULL,
  "author" TEXT,
  FOREIGN KEY ("author") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Post_author_idx" ON "Post"("author");
CREATE TABLE IF NOT EXISTS "Tag" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS "_Post_tags" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL,
  FOREIGN KEY ("A") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "_Post_tags_AB_unique" ON "_Post_tags"("A", "B");
CREATE INDEX IF NOT EXISTS "_Post_tags_B_index" ON "_Post_tags"("B");
`

export function createIsolatedDbFile(name: string): string {
  const dir = join(process.cwd(), 'tests/.tmp')
  mkdirSync(dir, { recursive: true })
  const filename = join(dir, `${name}-${process.pid}-${Date.now()}.sqlite`)
  const database = new Database(filename)
  database.exec(SCHEMA_SQL)
  database.close()
  return filename
}

export function createTestConfig(filename: string, listOverrides?: KeystoneConfig['lists']) {
  return config({
    db: {
      provider: 'sqlite',
      prismaClientOptions: () => ({
        adapter: new PrismaBetterSqlite3({ url: `file:${filename}` }),
      }),
    },
    graphql: {
      extendGraphqlSchema: schema =>
        extendPoiFromTextSchema(extendAccessibilitySearchSchema(extendPoiImportSchema(schema))),
    },
    lists: listOverrides ?? lists,
  })
}

export function createIsolatedContext(filename: string, listOverrides?: KeystoneConfig['lists']) {
  return getContext(createTestConfig(filename, listOverrides), PrismaModule)
}

export const SEARCH_QUERY = `
  query SearchAccessibilityPois(
    $query: String
    $type: String
    $disabledFacilitiesStatus: String
    $accessibilityStatus: String
    $notesKeyword: String
    $checkedBefore: String
    $uncheckedOnly: Boolean
    $take: Int
  ) {
    searchAccessibilityPois(
      query: $query
      type: $type
      disabledFacilitiesStatus: $disabledFacilitiesStatus
      accessibilityStatus: $accessibilityStatus
      notesKeyword: $notesKeyword
      checkedBefore: $checkedBefore
      uncheckedOnly: $uncheckedOnly
      take: $take
    ) {
      ok
      error
      truncated
      totalCount
      returnedCount
      appliedFilters {
        query
        type
        disabledFacilitiesStatus
        accessibilityStatus
        notesKeyword
        checkedBefore
        uncheckedOnly
        take
        resultOrder
      }
      items {
        type
        id
        name
        nickname
        address
        disabledFacilitiesStatus
        accessibilityStatus
        accessibilityNotes
        accessibilityCheckedAt
        adminPath
      }
    }
  }
`

export const ASK_MUTATION = `
  mutation AskAccessibilityAssistant($question: String!) {
    askAccessibilityAssistant(question: $question) {
      ok
      error
      code
    }
  }
`

export const GET_QUERY = `
  query GetAccessibilityPoi($type: String!, $id: ID!) {
    getAccessibilityPoi(type: $type, id: $id) {
      ok
      error
      item {
        type
        id
        name
        accessibilityCheckedAt
        adminPath
      }
    }
  }
`
