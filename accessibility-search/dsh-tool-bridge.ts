import type { searchPois } from './poi-query.ts'
import { IPC_ADDRESS_ENV, IPC_SECRET_ENV, startToolIpcServer, type ToolIpcServer } from './tool-ipc.ts'

type QueryContext = Parameters<typeof searchPois>[0]

export type ParentHeldToolBridge = ToolIpcServer & {
  extraEnv: {
    ACCESSIBILITY_TOOL_IPC: string
    ACCESSIBILITY_TOOL_IPC_SECRET: string
  }
}

/**
 * Per-ask loopback bridge. The secret is only in the child environment and
 * the tool execute handshake; never in prompts, tool args, URLs, or logs.
 * Same Unix user can still read the child environment.
 */
export async function startParentHeldToolBridge(
  context: QueryContext,
  signal: AbortSignal
): Promise<ParentHeldToolBridge> {
  const ipc = await startToolIpcServer(context, signal)
  return {
    ...ipc,
    extraEnv: {
      [IPC_ADDRESS_ENV]: ipc.socketPath,
      [IPC_SECRET_ENV]: ipc.secret,
    },
  }
}
