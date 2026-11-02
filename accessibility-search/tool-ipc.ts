import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server, type Socket } from 'node:net'
import { MAX_TOOL_CALLS } from './agent-limits.ts'
import { bindAssistantTools, type ToolCallRecord } from './bound-tools.ts'
import { searchPois } from './poi-query.ts'

type QueryContext = Parameters<typeof searchPois>[0]

export const IPC_MAX_MESSAGE_BYTES = 64_000
export const IPC_MAX_CONNECTIONS = 2
export const IPC_MAX_REQUESTS = MAX_TOOL_CALLS
export const IPC_READ_TIMEOUT_MS = 10_000
export const IPC_SECRET_ENV = 'ACCESSIBILITY_TOOL_IPC_SECRET'
export const IPC_ADDRESS_ENV = 'ACCESSIBILITY_TOOL_IPC'
export const IPC_UNAUTHORIZED = 'Unauthorized'

export type ToolIpcServer = {
  socketPath: string
  secret: string
  recordedCalls: ToolCallRecord[]
  close(): Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function createIpcSecret(): string {
  return randomBytes(32).toString('base64url')
}

export function secretsEqual(expected: string, received: unknown): boolean {
  if (typeof received !== 'string' || received.length === 0) return false
  const left = createHash('sha256').update(expected).digest()
  const right = createHash('sha256').update(received).digest()
  return timingSafeEqual(left, right)
}

function whenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(new Error('Ask timed out'))
    if (signal.aborted) {
      fail()
      return
    }
    signal.addEventListener('abort', fail, { once: true })
  })
}

function writeJson(socket: Socket, payload: unknown) {
  if (socket.destroyed) return
  socket.write(`${JSON.stringify(payload)}\n`)
}

/**
 * Loopback TCP plus a per-ask secret. Same-uid local processes that can read
 * the child environment can still connect. This does not isolate a process
 * already running as the Keystone Unix user.
 */
export async function startToolIpcServer(context: QueryContext, signal: AbortSignal): Promise<ToolIpcServer> {
  const tools = bindAssistantTools(context)
  const recordedCalls: ToolCallRecord[] = []
  const sockets = new Set<Socket>()
  const secret = createIpcSecret()
  let closed = false
  let requestCount = 0

  const server: Server = createServer(socket => {
    if (closed || sockets.size >= IPC_MAX_CONNECTIONS) {
      socket.destroy()
      return
    }
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))

    let buffer = ''
    const readTimer = setTimeout(() => socket.destroy(), IPC_READ_TIMEOUT_MS)
    socket.on('data', chunk => {
      if (closed) {
        socket.destroy()
        return
      }
      buffer += chunk.toString('utf8')
      if (buffer.length > IPC_MAX_MESSAGE_BYTES) {
        clearTimeout(readTimer)
        socket.destroy()
        return
      }
      const newline = buffer.indexOf('\n')
      if (newline === -1) return
      clearTimeout(readTimer)
      const line = buffer.slice(0, newline)
      buffer = ''
      void (async () => {
        if (closed) {
          socket.destroy()
          return
        }
        requestCount += 1
        if (requestCount > IPC_MAX_REQUESTS) {
          socket.destroy()
          return
        }
        try {
          const request = JSON.parse(line) as unknown
          if (!isRecord(request) || !secretsEqual(secret, request.auth)) {
            if (!closed && !socket.destroyed) writeJson(socket, { ok: false, error: IPC_UNAUTHORIZED })
            return
          }
          if (request.name !== 'search_pois' && request.name !== 'get_poi') {
            if (!closed && !socket.destroyed) writeJson(socket, { ok: false, error: 'Unknown tool' })
            return
          }
          const result = await Promise.race([
            request.name === 'search_pois'
              ? tools.search_pois(request.args)
              : tools.get_poi(request.args),
            whenAborted(signal),
          ])
          recordedCalls.push({ name: request.name, args: request.args, result })
          if (closed || signal.aborted || socket.destroyed) return
          writeJson(socket, { ok: true, result })
        } catch (error) {
          if (closed || signal.aborted || socket.destroyed) return
          writeJson(socket, {
            ok: false,
            error: error instanceof Error ? error.message : 'Parent tool call failed',
          })
        } finally {
          socket.end()
        }
      })()
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve())
    server.on('error', reject)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    await new Promise<void>(resolve => server.close(() => resolve()))
    throw new Error('Failed to bind loopback tool IPC')
  }
  const socketPath = `127.0.0.1:${address.port}`

  const close = async () => {
    if (closed) return
    closed = true
    for (const socket of sockets) socket.destroy()
    sockets.clear()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }

  signal.addEventListener(
    'abort',
    () => {
      void close()
    },
    { once: true }
  )

  return { socketPath, secret, recordedCalls, close }
}
