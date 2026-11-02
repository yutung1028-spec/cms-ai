import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import {
  assistantTextFromRun,
  inspectToolActivity,
  type DshAskRuntime,
  type DshRunResult,
} from '../accessibility-search/dsh-ask-runtime.ts'
import { buildDeepSeekHarnessOptions, type DshLaunchOptions } from '../accessibility-search/dsh-config.ts'
import { waitForManifest } from '../accessibility-search/dsh-runtime-inspect.ts'

export function extractPatchPath(): string {
  return join(process.cwd(), 'poi-from-text/dsh-runtime/cordis.patch.yml')
}

export function extractLaunch(launch: DshLaunchOptions): DshLaunchOptions {
  return { ...launch, patches: [extractPatchPath()] }
}

export function createPoiExtractRuntime(launch: DshLaunchOptions): DshAskRuntime {
  const extract = extractLaunch(launch)
  mkdirSync(extract.dshHome, { recursive: true })
  const sessionId = randomUUID()
  const manifestPath = join(extract.dshHome, `extract-manifest-${sessionId}.json`)
  const harness = new DeepSeekHarness(
    buildDeepSeekHarnessOptions(extract, {
      POI_FROM_TEXT_MANIFEST_PATH: manifestPath,
    })
  )
  let closed = false

  return {
    async prepareAgent() {
      await harness.start()
      const pending = waitForManifest(
        manifestPath,
        extract.initializeTimeoutMs,
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
      if (manifest.failClosed || manifest.restrictError || manifest.names.length !== 0) {
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

export type { DshAskRuntime, DshRunResult }
