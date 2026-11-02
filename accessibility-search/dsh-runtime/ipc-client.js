import net from 'node:net'

export function connectParentIpc(target) {
  if (target.startsWith('/') || target.startsWith('.')) {
    return net.connect(target)
  }
  const separator = target.lastIndexOf(':')
  const host = target.slice(0, separator)
  const port = Number(target.slice(separator + 1))
  return net.connect(port, host)
}

export function callParentTool(name, args, signal, options) {
  const target = options?.address ?? process.env.ACCESSIBILITY_TOOL_IPC
  const secret = options?.secret ?? process.env.ACCESSIBILITY_TOOL_IPC_SECRET
  if (!target) {
    throw new Error('POI tools are not bound to a parent request')
  }

  return new Promise((resolve, reject) => {
    const client = connectParentIpc(target)
    let buffer = ''
    const onAbort = () => {
      client.destroy()
      reject(new Error('Ask timed out'))
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    client.on('error', error => {
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    client.on('data', chunk => {
      buffer += chunk.toString('utf8')
      const newline = buffer.indexOf('\n')
      if (newline === -1) return
      const line = buffer.slice(0, newline)
      signal?.removeEventListener('abort', onAbort)
      client.end()
      try {
        const payload = JSON.parse(line)
        if (!payload.ok) {
          reject(new Error(payload.error || 'Parent tool call failed'))
          return
        }
        resolve(payload.result)
      } catch (error) {
        reject(error)
      }
    })
    client.on('connect', () => {
      client.write(`${JSON.stringify({ auth: secret, name, args })}\n`)
    })
  })
}
