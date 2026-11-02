import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { MAX_OUTPUT_TOKENS, DSH_INITIALIZE_TIMEOUT_MS, ASK_TIMEOUT_MS } from './agent-limits.ts'
import { DSH_MODEL_ID, DSH_PROVIDER_ID } from './dsh-models.ts'

/**
 * TypeScript SDK 0.2.1-rc.5 DeepSeekHarnessOptions has no apiKey field.
 * Official adapter docs: credentials resolve from the inherited environment,
 * $DSH_HOME/.credentials.yaml, the invoking directory's .env, then $DSH_HOME/.env.
 * Presence is checked without reading or logging the secret value.
 */
export const DEEPSEEK_API_KEY_ENV = 'DEEPSEEK_API_KEY'

export type DshLaunchOptions = {
  profile: string
  dshHome: string
  provider: string
  model: string
  maxTokens: number
  requestTimeoutMs: number
  initializeTimeoutMs: number
  patches: string[]
}

export type AssistantAiStatus =
  | { configured: false; reason: 'AI 尚未設定' }
  | { configured: true; mode: 'mock' }
  | { configured: true; mode: 'dsh'; launch: DshLaunchOptions }

export function runtimePatchPath(): string {
  return join(process.cwd(), 'accessibility-search/dsh-runtime/cordis.patch.yml')
}

function nonEmptyEnv(name: string): string | undefined {
  const value = process.env[name]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function hasCredentialWithoutReading(): boolean {
  if (nonEmptyEnv(DEEPSEEK_API_KEY_ENV)) return true
  const home = nonEmptyEnv('ACCESSIBILITY_DSH_HOME')
  if (home && existsSync(`${home}/.credentials.yaml`)) return true
  if (home && existsSync(`${home}/.env`)) return true
  return false
}

export function getAssistantAiStatus(): AssistantAiStatus {
  if (nonEmptyEnv('ACCESSIBILITY_ASSISTANT_BACKEND') === 'mock') {
    return { configured: true, mode: 'mock' }
  }

  const dshHome = nonEmptyEnv('ACCESSIBILITY_DSH_HOME')
  if (!dshHome || !isAbsolute(dshHome)) {
    return { configured: false, reason: 'AI 尚未設定' }
  }
  if (!hasCredentialWithoutReading()) {
    return { configured: false, reason: 'AI 尚未設定' }
  }

  const maxTokensRaw = nonEmptyEnv('ACCESSIBILITY_DSH_MAX_TOKENS')
  const maxTokens = maxTokensRaw ? Number(maxTokensRaw) : MAX_OUTPUT_TOKENS
  if (!Number.isInteger(maxTokens) || maxTokens < 1) {
    return { configured: false, reason: 'AI 尚未設定' }
  }

  const profile = nonEmptyEnv('ACCESSIBILITY_DSH_PROFILE') ?? 'sdk'
  const provider = nonEmptyEnv('ACCESSIBILITY_DSH_PROVIDER') ?? DSH_PROVIDER_ID
  const model = nonEmptyEnv('ACCESSIBILITY_DSH_MODEL') ?? DSH_MODEL_ID
  if (profile !== 'sdk' || provider !== DSH_PROVIDER_ID || model !== DSH_MODEL_ID) {
    return { configured: false, reason: 'AI 尚未設定' }
  }

  return {
    configured: true,
    mode: 'dsh',
    launch: {
      profile,
      dshHome,
      provider,
      model,
      maxTokens,
      requestTimeoutMs: ASK_TIMEOUT_MS,
      initializeTimeoutMs: DSH_INITIALIZE_TIMEOUT_MS,
      patches: [runtimePatchPath()],
    },
  }
}

const FORBIDDEN_CHILD_ENV = new Set([
  'SESSION_SECRET',
  'COOKIE',
  'COOKIES',
  'KEYSTONE_SESSION',
])

/**
 * Child env replaces the parent env entirely (SDK 0.2.1-rc.5).
 * ACCESSIBILITY_DSH_HOME is copied to DSH_HOME; session secrets are omitted.
 * DEEPSEEK_API_KEY is forwarded only when already present, never logged.
 */
export function buildScrubbedDshEnv(options: {
  dshHome: string
  extra?: Record<string, string>
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of FORBIDDEN_CHILD_ENV) delete env[key]
  env.DSH_HOME = options.dshHome
  for (const [key, value] of Object.entries(options.extra ?? {})) {
    if (FORBIDDEN_CHILD_ENV.has(key)) continue
    env[key] = value
  }
  return env
}

/** Confirmed 0.2.1-rc.5 DeepSeekHarnessOptions subset. Does not spawn a process. */
export function buildDeepSeekHarnessOptions(launch: DshLaunchOptions, extraEnv?: Record<string, string>) {
  return {
    profile: launch.profile,
    dshHome: launch.dshHome,
    patches: launch.patches,
    provider: launch.provider,
    model: launch.model,
    maxTokens: launch.maxTokens,
    requestTimeoutMs: launch.requestTimeoutMs,
    initializeTimeoutMs: launch.initializeTimeoutMs,
    cwd: launch.dshHome,
    processCwd: launch.dshHome,
    env: buildScrubbedDshEnv({ dshHome: launch.dshHome, extra: extraEnv }),
  }
}
