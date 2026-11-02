import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, watchFile, unwatchFile, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { DSH_INITIALIZE_TIMEOUT_MS } from './agent-limits.ts'
import { buildScrubbedDshEnv, runtimePatchPath } from './dsh-config.ts'
import { DSH_MODEL_ID, DSH_PROVIDER_ID } from './dsh-models.ts'

export const ALLOWED_RUNTIME_TOOLS = ['get_poi', 'search_pois'] as const

export type RuntimeToolSchemaSummary = {
  name: string
  description: string
  required: string[]
  propertyNames: string[]
}

export type RuntimeToolManifest = {
  names: string[]
  restrictError: string | null
  phase?: string
  scope?: string
  error?: string
  failClosed?: boolean
  promptSection?: string | null
  tools?: RuntimeToolSchemaSummary[]
}

function installedDshBin(): string {
  const require = createRequire(join(process.cwd(), 'package.json'))
  return join(dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'lib/bin.js')
}

export function waitForManifest(
  path: string,
  timeoutMs: number,
  matches: (manifest: RuntimeToolManifest) => boolean
): Promise<RuntimeToolManifest> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unwatchFile(path)
      reject(new Error(`Timed out waiting for tool manifest at ${path}`))
    }, timeoutMs)
    const check = () => {
      try {
        const text = readFileSync(path, 'utf8')
        if (text.trim() === '') return
        const manifest = JSON.parse(text) as RuntimeToolManifest
        if (!matches(manifest)) return
        clearTimeout(timer)
        unwatchFile(path)
        resolve(manifest)
      } catch {
        // not written yet or incomplete JSON
      }
    }
    watchFile(path, { interval: 100 }, check)
    check()
  })
}

function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode) {
      resolve()
      return
    }
    const finish = () => resolve()
    child.once('exit', finish)
    child.kill('SIGTERM')
    setTimeout(() => {
      if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL')
    }, 2000).unref()
  })
}

function inspectEnv(dshHome: string, manifestPath: string) {
  const env = buildScrubbedDshEnv({
    dshHome,
    extra: { ACCESSIBILITY_TOOL_MANIFEST_PATH: manifestPath },
  })
  delete env.DEEPSEEK_API_KEY
  return env
}

/**
 * Boot `dsh --profile sdk --patch` only. Does not call DeepSeekHarness.start,
 * initialize, session.prompt, or harness.run.
 */
export async function inspectRuntimeToolNames(dshHome: string): Promise<{
  manifest: RuntimeToolManifest
}> {
  mkdirSync(dshHome, { recursive: true })
  const manifestPath = join(dshHome, 'tool-manifest.json')
  const stderrPath = join(dshHome, 'inspect-stderr.txt')
  const child = spawn(process.execPath, [installedDshBin(), '--profile', 'sdk', '--patch', runtimePatchPath()], {
    env: inspectEnv(dshHome, manifestPath),
    cwd: dshHome,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr?.on('data', chunk => {
    stderr += String(chunk)
    if (stderr.length > 16_000) stderr = stderr.slice(-12_000)
  })

  try {
    const manifest = await waitForManifest(manifestPath, 60_000, value => Array.isArray(value.names))
    writeFileSync(stderrPath, stderr)
    return { manifest }
  } catch (error) {
    writeFileSync(stderrPath, stderr)
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${message}\nstderr tail:\n${stderr.slice(-2000)}`)
  } finally {
    await stopChild(child)
  }
}

/**
 * Initialize + create a Session via getWorkingDirectory (no prompt / run).
 * That fires agent/created. Fail-closed if restrict or the tool list fails.
 */
export async function inspectAgentScopedToolNames(dshHome: string): Promise<{
  manifest: RuntimeToolManifest
}> {
  mkdirSync(dshHome, { recursive: true })
  const manifestPath = join(dshHome, 'tool-manifest.json')
  const harness = new DeepSeekHarness({
    profile: 'sdk',
    dshHome,
    patches: [runtimePatchPath()],
    provider: DSH_PROVIDER_ID,
    model: DSH_MODEL_ID,
    cwd: dshHome,
    processCwd: dshHome,
    initializeTimeoutMs: Math.max(DSH_INITIALIZE_TIMEOUT_MS, 30_000),
    requestTimeoutMs: 30_000,
    env: inspectEnv(dshHome, manifestPath),
  })
  try {
    await harness.start()
    const pendingManifest = waitForManifest(
      manifestPath,
      30_000,
      value => value.scope === 'agent' || value.failClosed === true
    )
    try {
      await harness.session('inspect-tools').getWorkingDirectory()
    } catch (error) {
      const failed = await pendingManifest.catch(() => null)
      if (failed?.failClosed) {
        throw new Error(
          `Agent tool restrict failed closed: ${failed.restrictError ?? failed.error ?? 'creation rejected'}`
        )
      }
      throw error
    }
    const manifest = await pendingManifest
    if (manifest.failClosed || manifest.restrictError) {
      throw new Error(
        `Agent tool restrict failed closed: ${manifest.restrictError ?? 'unexpected tools'}`
      )
    }
    return { manifest }
  } finally {
    await harness.close()
  }
}
