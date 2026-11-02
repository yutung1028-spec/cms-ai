import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import type { ToolCallRecord } from './bound-tools.ts'
import { buildDeepSeekHarnessOptions, type DshLaunchOptions } from './dsh-config.ts'
import { DSH_MODEL_ID, DSH_PROVIDER_ID } from './dsh-models.ts'
import { ALLOWED_RUNTIME_TOOLS, waitForManifest, type RuntimeToolManifest } from './dsh-runtime-inspect.ts'
import type { QueryObservation } from './ground-answer.ts'
import type { CitationRef } from './mock-agent.ts'

export type TurnEndActivity = {
  kind: string
  code: string | null
  status: number | null
}

export type ToolActivity = {
  eventsAvailable: boolean
  proposedNames: string[]
  errorResultCount: number
  exposedToolNames: string[]
  turnEnd: TurnEndActivity | null
}

export type DshRunResult = {
  text: string
  citations?: CitationRef[]
  toolCalls?: ToolCallRecord[]
  toolActivity?: ToolActivity
}

export type DshAskRuntime = {
  prepareAgent(): Promise<RuntimeToolManifest>
  run(question: string, signal: AbortSignal): Promise<DshRunResult>
  close(): Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const POI_TOOL_NAMES = new Set(['search_pois', 'get_poi'])

function parseTurnEnd(data: Record<string, unknown>): TurnEndActivity | null {
  const reason = isRecord(data.reason) ? data.reason : null
  if (!reason || typeof reason.kind !== 'string' || reason.kind === '') return null
  const error = isRecord(reason.error) ? reason.error : null
  return {
    kind: reason.kind,
    code: error && typeof error.code === 'string' ? error.code : null,
    status: error && typeof error.status === 'number' ? error.status : null,
  }
}

export function inspectToolActivity(events: unknown): ToolActivity {
  if (!Array.isArray(events) || events.length === 0) {
    return {
      eventsAvailable: false,
      proposedNames: [],
      errorResultCount: 0,
      exposedToolNames: [],
      turnEnd: null,
    }
  }
  const proposedNames: string[] = []
  let errorResultCount = 0
  const exposedToolNames: string[] = []
  let turnEnd: TurnEndActivity | null = null
  for (const event of events) {
    if (!isRecord(event)) continue
    if (event.type === 'tool/call' && isRecord(event.data) && typeof event.data.name === 'string') {
      proposedNames.push(event.data.name)
    }
    if (event.type === 'tool/result' && isRecord(event.data)) {
      const message = isRecord(event.data.message) ? event.data.message : null
      if (message?.isError === true || event.data.error) errorResultCount += 1
    }
    if (event.type === 'request/header' && isRecord(event.data) && isRecord(event.data.header)) {
      const tools = Array.isArray(event.data.header.tools) ? event.data.header.tools : []
      exposedToolNames.length = 0
      for (const tool of tools) {
        if (isRecord(tool) && typeof tool.name === 'string') exposedToolNames.push(tool.name)
      }
    }
    if (event.type === 'turn/end' && isRecord(event.data)) {
      turnEnd = parseTurnEnd(event.data) ?? turnEnd
    }
  }
  return { eventsAvailable: true, proposedNames, errorResultCount, exposedToolNames, turnEnd }
}

export function isQuotaTurnEnd(turnEnd: TurnEndActivity | null | undefined): boolean {
  if (!turnEnd || turnEnd.kind !== 'error') return false
  return turnEnd.code === 'QUOTA' || turnEnd.code === 'ACCOUNT_QUOTA' || turnEnd.status === 402
}

export function observationFromActivity(activity: ToolActivity | undefined): QueryObservation {
  if (!activity?.eventsAvailable) {
    return {
      eventsAvailable: false,
      proposedPoiToolCalls: false,
      toolResultErrors: 0,
      requestExposedPoiTools: null,
      turnObserved: false,
      turnCompleted: false,
      quotaExceeded: false,
      modelTurnFailed: false,
    }
  }
  const exposed = activity.exposedToolNames
  const turnEnd = activity.turnEnd ?? null
  const quotaExceeded = isQuotaTurnEnd(turnEnd)
  return {
    eventsAvailable: true,
    proposedPoiToolCalls: activity.proposedNames.some(name => POI_TOOL_NAMES.has(name)),
    toolResultErrors: activity.errorResultCount,
    requestExposedPoiTools: exposed.length === 0 ? null : exposed.some(name => POI_TOOL_NAMES.has(name)),
    turnObserved: turnEnd !== null,
    turnCompleted: turnEnd?.kind === 'completed',
    quotaExceeded,
    modelTurnFailed: turnEnd !== null && turnEnd.kind !== 'completed' && !quotaExceeded,
  }
}

/** Prefer SDK finalResponse; if empty, use the last assistant/message that still has text. */
export function assistantTextFromRun(result: { finalResponse?: string; events?: unknown }): string {
  const fromFinal = typeof result.finalResponse === 'string' ? result.finalResponse : ''
  if (fromFinal.trim() !== '') return fromFinal
  const events = Array.isArray(result.events) ? result.events : []
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (!isRecord(event) || event.type !== 'assistant/message') continue
    const data = isRecord(event.data) ? event.data : null
    const message = data && isRecord(data.message) ? data.message : null
    const content = message && Array.isArray(message.content) ? message.content : []
    const text = content
      .filter(block => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
      .map(block => String(block.text))
      .join('')
    if (text.trim() !== '') return text
  }
  return fromFinal
}

export function assertApprovedLaunch(launch: DshLaunchOptions) {
  if (launch.profile !== 'sdk') throw new Error('AI runtime profile is not approved')
  if (launch.provider !== DSH_PROVIDER_ID || launch.model !== DSH_MODEL_ID) {
    throw new Error('AI model is not configured for this assistant')
  }
}

function sameAllowedTools(names: string[]) {
  return (
    names.length === ALLOWED_RUNTIME_TOOLS.length &&
    ALLOWED_RUNTIME_TOOLS.every(name => names.includes(name))
  )
}

export function createDeepSeekAskRuntime(
  launch: DshLaunchOptions,
  extraEnv: Record<string, string>
): DshAskRuntime {
  mkdirSync(launch.dshHome, { recursive: true })
  const sessionId = randomUUID()
  const manifestPath = join(launch.dshHome, `ask-manifest-${sessionId}.json`)
  const harness = new DeepSeekHarness(
    buildDeepSeekHarnessOptions(launch, {
      ...extraEnv,
      ACCESSIBILITY_TOOL_MANIFEST_PATH: manifestPath,
    })
  )
  let closed = false

  return {
    async prepareAgent() {
      await harness.start()
      const pending = waitForManifest(
        manifestPath,
        launch.initializeTimeoutMs,
        value => value.scope === 'agent' || value.failClosed === true
      )
      try {
        await harness.session(sessionId).getWorkingDirectory()
      } catch (error) {
        const failed = await pending.catch(() => null)
        if (failed?.failClosed) {
          throw new Error('AI runtime tools are not restricted')
        }
        throw error
      }
      const manifest = await pending
      if (manifest.failClosed || manifest.restrictError || !sameAllowedTools(manifest.names)) {
        throw new Error('AI runtime tools are not restricted')
      }
      return manifest
    },
    async run(question, signal) {
      if (signal.aborted) throw new Error('Ask timed out')
      const onAbort = () => {
        void harness.close()
      }
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        const result = await harness.session(sessionId).run(question)
        if (signal.aborted) throw new Error('Ask timed out')
        return {
          text: assistantTextFromRun(result),
          toolActivity: inspectToolActivity(result.events),
        }
      } finally {
        signal.removeEventListener('abort', onAbort)
      }
    },
    async close() {
      if (closed) return
      closed = true
      await harness.close()
    },
  }
}
