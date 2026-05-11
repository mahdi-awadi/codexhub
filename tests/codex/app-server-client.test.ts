// tests/codex/app-server-client.test.ts
import { describe, expect, test } from 'bun:test'
import { CodexAppServerClient, createLineJsonRpcTransport } from '../../src/codex/app-server-client'

describe('CodexAppServerClient', () => {
  test('correlates JSON-RPC responses by id', async () => {
    const writes: string[] = []
    let onLine: ((line: string) => void) | undefined
    const client = new CodexAppServerClient(createLineJsonRpcTransport({
      write(line) {
        writes.push(line)
      },
      onLine(cb) {
        onLine = cb
      },
      close() {},
    }))

    const promise = client.request('thread/start', { cwd: '/repo' })
    const id = JSON.parse(writes[0]!).id
    onLine!(JSON.stringify({ jsonrpc: '2.0', id, result: { threadId: 'thread_1' } }))

    await expect(promise).resolves.toEqual({ threadId: 'thread_1' })
  })

  test('rejects JSON-RPC errors for matching pending requests', async () => {
    const writes: string[] = []
    let onLine: ((line: string) => void) | undefined
    const client = new CodexAppServerClient(createLineJsonRpcTransport({
      write(line) {
        writes.push(line)
      },
      onLine(cb) {
        onLine = cb
      },
      close() {},
    }))

    const promise = client.request('thread/start', { cwd: '/repo' })
    const id = JSON.parse(writes[0]!).id
    onLine!(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: 'backend offline' } }))

    await expect(promise).rejects.toThrow('backend offline')
  })

  test('dispatches notifications without resolving pending requests', async () => {
    const events: unknown[] = []
    let onLine: ((line: string) => void) | undefined
    const client = new CodexAppServerClient(createLineJsonRpcTransport({
      write() {},
      onLine(cb) {
        onLine = cb
      },
      close() {},
    }))
    client.onNotification('item/agentMessage/delta', (params) => events.push(params))

    onLine!(JSON.stringify({
      jsonrpc: '2.0',
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread_1', itemId: 'item_1', delta: 'hi' },
    }))

    expect(events).toEqual([{ threadId: 'thread_1', itemId: 'item_1', delta: 'hi' }])
  })

  test('dispatches server approval requests and answers them by id', async () => {
    const writes: string[] = []
    let onLine: ((line: string) => void) | undefined
    const client = new CodexAppServerClient(createLineJsonRpcTransport({
      write(line) {
        writes.push(line)
      },
      onLine(cb) {
        onLine = cb
      },
      close() {},
    }))
    client.onServerRequest('item/commandExecution/requestApproval', async () => ({ decision: 'approved' }))

    onLine!(JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      method: 'item/commandExecution/requestApproval',
      params: { command: 'ls' },
    }))
    await Promise.resolve()

    expect(JSON.parse(writes[0]!)).toEqual({
      jsonrpc: '2.0',
      id: 7,
      result: { decision: 'approved' },
    })
  })
})
