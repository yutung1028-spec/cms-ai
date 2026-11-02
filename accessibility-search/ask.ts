import type { KeystoneContext } from '@keystone-6/core/types'
import { ASK_TIMEOUT_MS, MAX_QUESTION_CHARS } from './agent-limits.ts'
import { requireAssistantUser } from './assistant-auth.ts'
import { anySearchTruncated, bindAssistantTools, collectEvidence } from './bound-tools.ts'
import {
  createDeepSeekAskRuntime,
  assertApprovedLaunch,
  observationFromActivity,
  type DshAskRuntime,
} from './dsh-ask-runtime.ts'
import { getAssistantAiStatus } from './dsh-config.ts'
import { startParentHeldToolBridge } from './dsh-tool-bridge.ts'
import {
  groundAnswer,
  mockQueryObservation,
  MODEL_QUOTA_TEXT,
  MODEL_RUN_FAILED_TEXT,
  type GroundedAnswer,
} from './ground-answer.ts'
import { createScriptedAgent, type MockAgentStep } from './mock-agent.ts'

type AskContext = Pick<KeystoneContext, 'session' | 'query'>

export type AskResult =
  | GroundedAnswer
  | {
      ok: false
      error: string
      code:
        | 'unauthenticated'
        | 'forbidden'
        | 'ai_not_configured'
        | 'invalid'
        | 'busy'
        | 'timeout'
        | 'tool_limit'
        | 'quota'
        | 'model_error'
        | 'failed'
    }

type AgentFn = ReturnType<typeof createScriptedAgent>

const inFlightUsers = new Set<string>()

export function resetAskInFlightForTests() {
  inFlightUsers.clear()
}

function parseQuestion(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'question must be a string' }
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: false, error: 'question must not be empty' }
  if (trimmed.length > MAX_QUESTION_CHARS) {
    return { ok: false, error: `question must be at most ${MAX_QUESTION_CHARS} characters` }
  }
  return { ok: true, value: trimmed }
}

function publicAskError(error: unknown): { error: string; code: 'timeout' | 'tool_limit' | 'failed' } {
  const message = error instanceof Error ? error.message : 'Ask failed'
  if (message === 'Ask timed out') return { error: 'Ask timed out', code: 'timeout' }
  if (message.includes('Tool call limit exceeded')) return { error: message, code: 'tool_limit' }
  if (message === 'AI runtime tools are not restricted') {
    return { error: 'AI runtime tools are not restricted', code: 'failed' }
  }
  if (message === 'AI model is not configured for this assistant' || message === 'AI runtime profile is not approved') {
    return { error: 'AI model is not configured for this assistant', code: 'failed' }
  }
  return { error: 'Ask failed', code: 'failed' }
}

export async function askAccessibilityAssistant(
  context: AskContext,
  rawQuestion: unknown,
  options?: {
    agent?: AgentFn
    mockSteps?: MockAgentStep[]
    timeoutMs?: number
    dshRuntime?: DshAskRuntime
  }
): Promise<AskResult> {
  const auth = await requireAssistantUser(context)
  if (!auth.ok) {
    return {
      ok: false,
      error: auth.error,
      code: auth.error === 'Authentication required' ? 'unauthenticated' : 'forbidden',
    }
  }

  const parsed = parseQuestion(rawQuestion)
  if (!parsed.ok) return { ok: false, error: parsed.error, code: 'invalid' }

  const status =
    options?.agent || options?.mockSteps
      ? { configured: true as const, mode: 'mock' as const }
      : getAssistantAiStatus()
  if (!status.configured) {
    return { ok: false, error: 'AI 尚未設定', code: 'ai_not_configured' }
  }

  if (inFlightUsers.has(auth.user.id)) {
    return { ok: false, error: 'An AI request is already in progress for this user', code: 'busy' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? ASK_TIMEOUT_MS)
  inFlightUsers.add(auth.user.id)

  try {
    if (status.mode === 'mock') {
      const tools = bindAssistantTools(context)
      const agent = options?.agent ?? createScriptedAgent(options?.mockSteps ?? [])
      const run = await agent(tools, controller.signal)
      return groundAnswer({
        text: run.text,
        citations: run.citations,
        evidence: collectEvidence(run.toolCalls),
        truncated: anySearchTruncated(run.toolCalls),
        toolCalls: run.toolCalls,
        observation: mockQueryObservation(run.toolCalls),
      })
    }

    assertApprovedLaunch(status.launch)
    const bridge = await startParentHeldToolBridge(context, controller.signal)
    const runtime = options?.dshRuntime ?? createDeepSeekAskRuntime(status.launch, bridge.extraEnv)
    try {
      await runtime.prepareAgent()
      if (controller.signal.aborted) throw new Error('Ask timed out')
      const run = await runtime.run(parsed.value, controller.signal)
      const observation = observationFromActivity(run.toolActivity)
      if (observation.quotaExceeded) {
        return { ok: false, error: MODEL_QUOTA_TEXT, code: 'quota' }
      }
      if (observation.modelTurnFailed) {
        return { ok: false, error: MODEL_RUN_FAILED_TEXT, code: 'model_error' }
      }
      const toolCalls = bridge.recordedCalls.length > 0 ? bridge.recordedCalls : (run.toolCalls ?? [])
      return groundAnswer({
        text: run.text,
        citations: run.citations ?? [],
        evidence: collectEvidence(toolCalls),
        truncated: anySearchTruncated(toolCalls),
        toolCalls,
        observation,
      })
    } finally {
      await runtime.close()
      await bridge.close()
    }
  } catch (error) {
    const mapped = publicAskError(error)
    if (controller.signal.aborted && mapped.code === 'failed') {
      return { ok: false, error: 'Ask timed out', code: 'timeout' }
    }
    return { ok: false, error: mapped.error, code: mapped.code }
  } finally {
    clearTimeout(timer)
    inFlightUsers.delete(auth.user.id)
  }
}
