import { MAX_TOOL_CALLS } from './agent-limits.ts'
import type { AssistantToolName } from './bound-tools.ts'
import { bindAssistantTools, type ToolCallRecord } from './bound-tools.ts'

export type CitationRef = { type: string; id: string }

export type MockAgentStep =
  | { type: 'tool'; name: AssistantToolName; args: unknown }
  | { type: 'answer'; text: string; citations: CitationRef[] }
  | { type: 'delay'; ms: number }
  | { type: 'throw'; error: string }

export type MockAgentRun = {
  text: string
  citations: CitationRef[]
  toolCalls: ToolCallRecord[]
}

export function createScriptedAgent(steps: MockAgentStep[]) {
  return async function runScriptedAgent(
    tools: ReturnType<typeof bindAssistantTools>,
    signal: AbortSignal
  ): Promise<MockAgentRun> {
    const toolCalls: ToolCallRecord[] = []
    let text = ''
    let citations: CitationRef[] = []

    for (const step of steps) {
      if (signal.aborted) throw new Error('Ask timed out')
      if (step.type === 'delay') {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, step.ms)
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer)
              reject(new Error('Ask timed out'))
            },
            { once: true }
          )
        })
        continue
      }
      if (step.type === 'throw') throw new Error(step.error)
      if (step.type === 'answer') {
        text = step.text
        citations = step.citations
        continue
      }
      if (toolCalls.length >= MAX_TOOL_CALLS) {
        throw new Error(`Tool call limit exceeded (${MAX_TOOL_CALLS})`)
      }
      if (step.name !== 'search_pois' && step.name !== 'get_poi') {
        throw new Error(`Unknown tool "${String(step.name)}"`)
      }
      const result =
        step.name === 'search_pois' ? await tools.search_pois(step.args) : await tools.get_poi(step.args)
      toolCalls.push({ name: step.name, args: step.args, result })
    }

    return { text, citations, toolCalls }
  }
}
