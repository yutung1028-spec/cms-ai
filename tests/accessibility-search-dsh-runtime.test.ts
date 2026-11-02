import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { callParentTool } from '../accessibility-search/dsh-runtime/ipc-client.js'
import { runtimePatchPath, buildDeepSeekHarnessOptions, buildScrubbedDshEnv } from '../accessibility-search/dsh-config.ts'
import { inspectAgentScopedToolNames, inspectRuntimeToolNames } from '../accessibility-search/dsh-runtime-inspect.ts'
import { DSH_API_MODEL, DSH_MODEL_ID, DSH_PROVIDER_ID } from '../accessibility-search/dsh-models.ts'
import { startParentHeldToolBridge } from '../accessibility-search/dsh-tool-bridge.ts'
import { IPC_ADDRESS_ENV, IPC_SECRET_ENV } from '../accessibility-search/tool-ipc.ts'

const admin = { id: 'user-admin', email: 'admin@example.com' }
const occupant = {
  id: 'occ-1',
  name: 'Example Shop',
  nickname: '',
  lnglat: null,
  disabledFacilitiesStatus: 'unknown',
  accessibilityStatus: 'unknown',
  accessibilityNotes: '',
  accessibilityCheckedAt: null,
}

function createContext(users: { id: string; email: string }[], occupants: Record<string, unknown>[]) {
  return {
    session: { itemId: users[0]?.id },
    query: {
      User: {
        async findOne(args: { where: { id: string } }) {
          const user = users.find(item => item.id === args.where.id)
          return user ? { id: user.id, email: user.email } : null
        },
      },
      Occupant: {
        async findMany() {
          return occupants
        },
        async findOne(args: { where: { id: string } }) {
          return occupants.find(row => row.id === args.where.id) ?? null
        },
        async count() {
          return occupants.length
        },
      },
      Amenity: {
        async findMany() {
          return []
        },
        async findOne() {
          return null
        },
        async count() {
          return 0
        },
      },
    },
  }
}

function useBridgeEnv(extraEnv: { ACCESSIBILITY_TOOL_IPC: string; ACCESSIBILITY_TOOL_IPC_SECRET: string }) {
  process.env[IPC_ADDRESS_ENV] = extraEnv.ACCESSIBILITY_TOOL_IPC
  process.env[IPC_SECRET_ENV] = extraEnv.ACCESSIBILITY_TOOL_IPC_SECRET
}

function clearBridgeEnv() {
  delete process.env[IPC_ADDRESS_ENV]
  delete process.env[IPC_SECRET_ENV]
}

function dumpConfig(dshHome: string): Promise<string> {
  mkdirSync(dshHome, { recursive: true })
  return new Promise((resolve, reject) => {
    const child = spawn(
      'npx',
      ['--no-install', 'dsh', '--profile', 'sdk', '--patch', runtimePatchPath(), '--dump-config'],
      {
        env: { ...process.env, DSH_HOME: dshHome },
        cwd: process.cwd(),
      }
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += String(chunk)
    })
    child.stderr.on('data', chunk => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`dump-config exited ${code}: ${stderr}`))
        return
      }
      resolve(stdout)
    })
  })
}

test('ACCESSIBILITY_DSH_HOME is copied to DSH_HOME in the child env', () => {
  const home = '/Users/augustinewong/.dsh-accessibility-cms'
  const env = buildScrubbedDshEnv({ dshHome: home })
  assert.equal(env.DSH_HOME, home)
  assert.equal(env.SESSION_SECRET, undefined)
  const options = buildDeepSeekHarnessOptions({
    profile: 'sdk',
    dshHome: home,
    provider: DSH_PROVIDER_ID,
    model: DSH_MODEL_ID,
    maxTokens: 4096,
    requestTimeoutMs: 60_000,
    initializeTimeoutMs: 10_000,
    patches: [runtimePatchPath()],
  })
  assert.equal(options.dshHome, home)
  assert.equal(options.env?.DSH_HOME, home)
  assert.deepEqual(options.patches, [runtimePatchPath()])
})

test('parent IPC uses the bound session context and ignores model identity fields', async () => {
  const occupantB = { ...occupant, id: 'occ-2', name: 'Other Shop' }
  const contextA = createContext([admin], [occupant])
  const contextB = createContext([admin], [occupantB])
  const abortA = new AbortController()
  const abortB = new AbortController()
  const ipcA = await startParentHeldToolBridge(contextA, abortA.signal)
  const ipcB = await startParentHeldToolBridge(contextB, abortB.signal)
  try {
    useBridgeEnv(ipcA.extraEnv)
    const forged = (await callParentTool(
      'search_pois',
      { query: 'Example', email: 'admin@example.com', userId: admin.id },
      abortA.signal
    )) as { ok: boolean; error?: string }
    assert.equal(forged.ok, false)
    assert.match(forged.error ?? '', /Unknown field/)
    useBridgeEnv(ipcA.extraEnv)
    const resultA = (await callParentTool('search_pois', { query: 'Example' }, abortA.signal)) as {
      ok: boolean
      items?: { id: string }[]
    }
    useBridgeEnv(ipcB.extraEnv)
    const resultB = (await callParentTool('search_pois', { query: 'Other' }, abortB.signal)) as {
      ok: boolean
      items?: { id: string }[]
    }
    assert.equal(resultA.ok, true)
    assert.equal(resultA.items?.[0]?.id, 'occ-1')
    assert.equal(resultB.ok, true)
    assert.equal(resultB.items?.[0]?.id, 'occ-2')
  } finally {
    abortA.abort()
    abortB.abort()
    await ipcA.close()
    await ipcB.close()
    clearBridgeEnv()
  }
})

test('missing or wrong IPC secret cannot run a Keystone query', async () => {
  let queried = 0
  const context = createContext([admin], [occupant])
  context.query.Occupant.findMany = async () => {
    queried += 1
    return [occupant]
  }
  const abort = new AbortController()
  const ipc = await startParentHeldToolBridge(context, abort.signal)
  process.env[IPC_ADDRESS_ENV] = ipc.extraEnv.ACCESSIBILITY_TOOL_IPC
  delete process.env[IPC_SECRET_ENV]
  await assert.rejects(
    () => callParentTool('search_pois', { query: 'Example' }, abort.signal),
    /Unauthorized/
  )
  await assert.rejects(
    () =>
      callParentTool('search_pois', { query: 'Example' }, abort.signal, {
        secret: 'wrong-secret',
        address: ipc.socketPath,
      }),
    /Unauthorized/
  )
  assert.equal(queried, 0)
  abort.abort()
  await ipc.close()
  clearBridgeEnv()
})

test('swapped bridge secrets are rejected and keep request identity isolated', async () => {
  const occupantB = { ...occupant, id: 'occ-2', name: 'Other Shop' }
  const abortA = new AbortController()
  const abortB = new AbortController()
  const ipcA = await startParentHeldToolBridge(createContext([admin], [occupant]), abortA.signal)
  const ipcB = await startParentHeldToolBridge(createContext([admin], [occupantB]), abortB.signal)
  await assert.rejects(
    () =>
      callParentTool('search_pois', { query: 'Example' }, abortA.signal, {
        address: ipcA.socketPath,
        secret: ipcB.secret,
      }),
    /Unauthorized/
  )
  await assert.rejects(
    () =>
      callParentTool('search_pois', { query: 'Other' }, abortB.signal, {
        address: ipcB.socketPath,
        secret: ipcA.secret,
      }),
    /Unauthorized/
  )
  const resultA = (await callParentTool('search_pois', { query: 'Example' }, abortA.signal, {
    address: ipcA.socketPath,
    secret: ipcA.secret,
  })) as { ok: boolean; items?: { id: string }[] }
  assert.equal(resultA.ok, true)
  assert.equal(resultA.items?.[0]?.id, 'occ-1')
  abortA.abort()
  abortB.abort()
  await ipcA.close()
  await ipcB.close()
})

test('closed bridge rejects the old secret', async () => {
  const abort = new AbortController()
  const ipc = await startParentHeldToolBridge(createContext([admin], [occupant]), abort.signal)
  await ipc.close()
  await assert.rejects(
    () =>
      callParentTool('search_pois', { query: 'Example' }, abort.signal, {
        address: ipc.socketPath,
        secret: ipc.secret,
      }),
    /ECONNREFUSED|Unauthorized|timed out/
  )
})

test('loopback IPC is reachable from this process, not only a DSH child', async () => {
  const abort = new AbortController()
  const ipc = await startParentHeldToolBridge(createContext([admin], [occupant]), abort.signal)
  useBridgeEnv(ipc.extraEnv)
  const result = (await callParentTool('search_pois', { query: 'Example' }, abort.signal)) as {
    ok: boolean
  }
  assert.equal(result.ok, true)
  assert.equal(ipc.recordedCalls.length, 1)
  assert.equal(ipc.recordedCalls[0]?.name, 'search_pois')
  assert.equal(ipc.recordedCalls[0]?.result.ok, true)
  abort.abort()
  await ipc.close()
  clearBridgeEnv()
})

test('IPC timeout cancels the parent socket', async () => {
  const context = createContext([admin], [occupant])
  const abort = new AbortController()
  const ipc = await startParentHeldToolBridge(context, abort.signal)
  useBridgeEnv(ipc.extraEnv)
  abort.abort()
  await assert.rejects(
    () => callParentTool('search_pois', { query: 'Example' }, abort.signal),
    /timed out|ECONNREFUSED|ENOENT/
  )
  await ipc.close()
  clearBridgeEnv()
})

test('in-flight IPC query is cancelled when the parent request aborts', async () => {
  let released = false
  const hanging = createContext([admin], [occupant])
  hanging.query.Occupant.findMany = () =>
    new Promise(resolve => {
      const timer = setInterval(() => {
        if (released) {
          clearInterval(timer)
          resolve([occupant])
        }
      }, 20)
    })
  const abort = new AbortController()
  const ipc = await startParentHeldToolBridge(hanging, abort.signal)
  useBridgeEnv(ipc.extraEnv)
  const pending = callParentTool('search_pois', { query: 'Example' }, abort.signal)
  await new Promise(resolve => setTimeout(resolve, 40))
  abort.abort()
  await assert.rejects(() => pending, /timed out|ECONNREFUSED|write after end/)
  released = true
  await ipc.close()
  clearBridgeEnv()
})

test('late Keystone results are dropped after abort and do not enter a later request', async () => {
  let resolveFind: ((rows: Record<string, unknown>[]) => void) | undefined
  const hanging = createContext([admin], [occupant])
  hanging.query.Occupant.findMany = () =>
    new Promise(resolve => {
      resolveFind = resolve
    })
  const abortA = new AbortController()
  const ipcA = await startParentHeldToolBridge(hanging, abortA.signal)
  useBridgeEnv(ipcA.extraEnv)
  const pending = callParentTool('search_pois', { query: 'Example' }, abortA.signal)
  await new Promise(resolve => setTimeout(resolve, 40))
  abortA.abort()
  await assert.rejects(() => pending, /timed out|ECONNREFUSED|write after end/)
  await ipcA.close()

  const occupantB = { ...occupant, id: 'occ-2', name: 'Other Shop' }
  const abortB = new AbortController()
  const ipcB = await startParentHeldToolBridge(createContext([admin], [occupantB]), abortB.signal)
  useBridgeEnv(ipcB.extraEnv)
  resolveFind?.([occupant])
  await new Promise(resolve => setTimeout(resolve, 40))
  const resultB = (await callParentTool('search_pois', { query: 'Other' }, abortB.signal)) as {
    ok: boolean
    items?: { id: string }[]
  }
  assert.equal(resultB.ok, true)
  assert.equal(resultB.items?.[0]?.id, 'occ-2')
  abortB.abort()
  await ipcB.close()
  clearBridgeEnv()
})

test(
  'dump-config overlay disables shell, files, web, and plugin manager',
  { timeout: 120_000 },
  async () => {
    mkdirSync(join(process.cwd(), 'tests/.tmp'), { recursive: true })
    const dshHome = mkdtempSync(join(process.cwd(), 'tests/.tmp', 'acm-dsh-dump-'))
    const dump = await dumpConfig(dshHome)
    const disabled = new Set<string>()
    let current: string | undefined
    for (const line of dump.split('\n')) {
      if (line.startsWith('- id:')) current = line.slice(5).trim()
      else if (current && line.startsWith('  disabled: true')) disabled.add(current)
    }
    assert.ok(dump.includes('id: accessibility-poi-tools'))
    for (const id of [
      'tool-bash',
      'tool-web',
      'tool-fs',
      'tool-plugin-manager',
      'plugin-manager',
      'mcp-resources',
      'hmr',
    ]) {
      assert.ok(disabled.has(id), `${id} should be disabled`)
    }
  }
)

test(
  'spawned sdk runtime advertises only search_pois and get_poi',
  { timeout: 120_000 },
  async () => {
    mkdirSync(join(process.cwd(), 'tests/.tmp'), { recursive: true })
    const dshHome = mkdtempSync(join(process.cwd(), 'tests/.tmp', 'acm-dsh-inspect-'))
    const inspected = await inspectRuntimeToolNames(dshHome)
    assert.deepEqual(inspected.manifest.names, ['get_poi', 'search_pois'])
    assert.equal(inspected.manifest.error, undefined)
  }
)

test('confirmed DSH model id matches the adapter catalog and API model field', () => {
  assert.equal(DSH_PROVIDER_ID, 'deepseek-official')
  assert.equal(DSH_MODEL_ID, 'deepseek-flash')
  assert.equal(DSH_API_MODEL, 'deepseek-flash')
})

test(
  'agent/created restrict fail-closes unless the live agent tools are only search_pois and get_poi',
  { timeout: 120_000 },
  async () => {
    mkdirSync(join(process.cwd(), 'tests/.tmp'), { recursive: true })
    const dshHome = mkdtempSync(join(process.cwd(), 'tests/.tmp', 'acm-dsh-agent-'))
    const inspected = await inspectAgentScopedToolNames(dshHome)
    assert.equal(inspected.manifest.scope, 'agent')
    assert.deepEqual(inspected.manifest.names, ['get_poi', 'search_pois'])
    assert.equal(inspected.manifest.restrictError, null)
    assert.equal(inspected.manifest.failClosed, false)
    assert.equal(inspected.manifest.promptSection, 'accessibility-poi-query')
    const search = inspected.manifest.tools?.find(tool => tool.name === 'search_pois')
    const get = inspected.manifest.tools?.find(tool => tool.name === 'get_poi')
    assert.ok(search)
    assert.ok(get)
    assert.deepEqual(search.required, [])
    assert.ok(search.propertyNames.includes('accessibilityStatus'))
    assert.ok(search.propertyNames.includes('query'))
    assert.ok(search.propertyNames.includes('skip'))
    assert.ok(search.description.includes('Search Occupant'))
    assert.ok(search.description.includes('accessibilityStatus=accessible'))
    assert.deepEqual(get.required, ['id', 'type'])
    assert.ok(get.description.includes('type and id'))
  }
)
