import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadProjectEnv } from '../load-project-env.ts'

const SHELL_KEY = 'ACM_TEST_SHELL_OVERRIDE'
const FILE_KEY = 'ACM_TEST_FROM_FILE'

test('keystone.ts imports load-project-env before auth.ts', () => {
  const source = readFileSync(join(process.cwd(), 'keystone.ts'), 'utf8')
  const loadAt = source.search(/import\s+['"]\.\/load-project-env\.ts['"]/)
  const authAt = source.search(/import\s+\{[^}]*session[^}]*\}\s+from\s+['"]\.\/auth\.ts['"]/)
  assert.notEqual(loadAt, -1)
  assert.notEqual(authAt, -1)
  assert.ok(loadAt < authAt)
  const firstImport = source.match(/^import .+$/m)
  assert.ok(firstImport)
  assert.match(firstImport[0], /load-project-env/)
})

test('loadProjectEnv fills missing keys and does not override the shell', () => {
  mkdirSync(join(process.cwd(), 'tests/.tmp'), { recursive: true })
  const dir = mkdtempSync(join(process.cwd(), 'tests/.tmp', 'acm-env-'))
  writeFileSync(
    join(dir, '.env'),
    `${SHELL_KEY}=from-file\n${FILE_KEY}=from-file\n`
  )
  const previousShell = process.env[SHELL_KEY]
  const previousFile = process.env[FILE_KEY]
  process.env[SHELL_KEY] = 'from-shell'
  delete process.env[FILE_KEY]
  try {
    const result = loadProjectEnv(dir)
    assert.equal(result.loaded, true)
    assert.equal(process.env[SHELL_KEY], 'from-shell')
    assert.equal(process.env[FILE_KEY], 'from-file')
    assert.equal(typeof process.env[SHELL_KEY] === 'string' && process.env[SHELL_KEY] !== '', true)
    assert.equal(typeof process.env[FILE_KEY] === 'string' && process.env[FILE_KEY] !== '', true)
  } finally {
    if (previousShell === undefined) delete process.env[SHELL_KEY]
    else process.env[SHELL_KEY] = previousShell
    if (previousFile === undefined) delete process.env[FILE_KEY]
    else process.env[FILE_KEY] = previousFile
  }
})

test('loadProjectEnv reports loaded false when .env is absent', () => {
  mkdirSync(join(process.cwd(), 'tests/.tmp'), { recursive: true })
  const dir = mkdtempSync(join(process.cwd(), 'tests/.tmp', 'acm-env-missing-'))
  const result = loadProjectEnv(dir)
  assert.equal(result.loaded, false)
})
