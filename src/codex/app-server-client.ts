// src/codex/app-server-client.ts
import type { JsonRpcId } from './types'

export type JsonRpcTransport = {
  send(message: unknown): void
  close(): void
}

type ReceivableTransport = JsonRpcTransport & {
  setReceiver?: (cb: (message: unknown) => void) => void
}

type LineTransportInput = {
  write(line: string): void
  onLine(cb: (line: string) => void): void
  close(): void
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export function createLineJsonRpcTransport(input: LineTransportInput): JsonRpcTransport & {
  setReceiver(cb: (message: unknown) => void): void
} {
  let receiver: (message: unknown) => void = () => {}

  input.onLine((line) => {
    if (!line.trim()) return
    receiver(JSON.parse(line))
  })

  return {
    setReceiver(cb) {
      receiver = cb
    },
    send(message) {
      input.write(JSON.stringify(message))
    },
    close() {
      input.close()
    },
  }
}

export function createCodexAppServerTransport(args: string[] = ['codex', 'app-server', '--listen', 'stdio://']): JsonRpcTransport & {
  setReceiver(cb: (message: unknown) => void): void
} {
  const proc = Bun.spawn(args, {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  })
  let receiver: (message: unknown) => void = () => {}
  let buffer = ''
  const decoder = new TextDecoder()

  ;(async () => {
    const reader = proc.stdout.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value)
      let idx
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        if (!line.trim()) continue
        try {
          receiver(JSON.parse(line))
        } catch (err) {
          process.stderr.write(`codex app-server: failed to parse stdout JSON: ${err}\n`)
        }
      }
    }
  })().catch((err) => process.stderr.write(`codex app-server stdout failed: ${err}\n`))

  ;(async () => {
    const reader = proc.stderr.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      process.stderr.write(decoder.decode(value))
    }
  })().catch(() => {})

  return {
    setReceiver(cb) {
      receiver = cb
    },
    send(message) {
      proc.stdin.write(JSON.stringify(message) + '\n')
    },
    close() {
      proc.kill()
    },
  }
}

export class CodexAppServerClient {
  private nextId = 1
  private pending = new Map<JsonRpcId, PendingRequest>()
  private notifications = new Map<string, Set<(params: any) => void>>()
  private serverRequests = new Map<string, (params: any) => Promise<unknown> | unknown>()

  constructor(private transport: ReceivableTransport) {
    this.transport.setReceiver?.((message) => {
      this.receive(message as Record<string, any>)
    })
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      })
    })
    this.transport.send({ jsonrpc: '2.0', id, method, params })
    return promise
  }

  onNotification(method: string, cb: (params: any) => void): void {
    const handlers = this.notifications.get(method) ?? new Set()
    handlers.add(cb)
    this.notifications.set(method, handlers)
  }

  onServerRequest(method: string, cb: (params: any) => Promise<unknown> | unknown): void {
    this.serverRequests.set(method, cb)
  }

  close(): void {
    this.transport.close()
  }

  private async receive(message: Record<string, any>): Promise<void> {
    if ('id' in message && !message.method && ('result' in message || 'error' in message)) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) {
        pending.reject(new Error(message.error.message ?? 'Codex App Server error'))
      } else {
        pending.resolve(message.result)
      }
      return
    }

    if (message.method && 'id' in message) {
      await this.handleServerRequest(message.id, message.method, message.params ?? {})
      return
    }

    if (message.method) {
      for (const cb of this.notifications.get(message.method) ?? []) {
        cb(message.params ?? {})
      }
    }
  }

  private async handleServerRequest(id: JsonRpcId, method: string, params: any): Promise<void> {
    const handler = this.serverRequests.get(method)
    if (!handler) {
      this.transport.send({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `No handler for ${method}` },
      })
      return
    }

    try {
      const result = await handler(params)
      this.transport.send({ jsonrpc: '2.0', id, result })
    } catch (err) {
      this.transport.send({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: err instanceof Error ? err.message : String(err) },
      })
    }
  }
}
