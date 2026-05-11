// tests/codex/session-adapter.test.ts
import { describe, expect, test } from 'bun:test'
import { CodexSessionAdapter } from '../../src/codex/session-adapter'
import { AgentEventLog } from '../../src/codex/event-log'
import { SessionRegistry } from '../../src/session-registry'

class FakeClient {
  requests: Array<{ method: string; params: any }> = []
  handlers = new Map<string, Array<(params: any) => void>>()

  async request(method: string, params: any) {
    this.requests.push({ method, params })
    if (method === 'thread/start') return { threadId: 'thread_1' }
    if (method === 'thread/resume') return { threadId: params.threadId }
    if (method === 'turn/start') return { turnId: 'turn_1' }
    if (method === 'turn/steer') return { ok: true }
    return {}
  }

  onNotification(method: string, cb: (params: any) => void) {
    this.handlers.set(method, [...(this.handlers.get(method) ?? []), cb])
  }

  emit(method: string, params: any) {
    for (const cb of this.handlers.get(method) ?? []) cb(params)
  }
}

function makeAdapter() {
  const client = new FakeClient()
  const registry = new SessionRegistry({ defaultTrust: 'ask', defaultUploadDir: '.' })
  const eventLog = new AgentEventLog()
  const deliveries: Array<{ path: string; text: string; files?: string[] }> = []
  const adapter = new CodexSessionAdapter({
    client: client as any,
    registry,
    eventLog,
    deliver(path, text, files) {
      deliveries.push({ path, text, files })
    },
  })
  return { adapter, client, registry, eventLog, deliveries }
}

describe('CodexSessionAdapter', () => {
  test('starts a thread and registers a Hub session', async () => {
    const { adapter, client, registry } = makeAdapter()

    const result = await adapter.startSession({ name: 'repo', path: '/repo', instructions: 'base' })

    expect(result).toEqual({ sessionPath: '/repo:0', threadId: 'thread_1' })
    expect(registry.get('/repo:0')?.threadId).toBe('thread_1')
    expect(client.requests[0]).toMatchObject({
      method: 'thread/start',
      params: { cwd: '/repo', instructions: 'base' },
    })
  })

  test('resumes an existing thread and registers a Hub session', async () => {
    const { adapter, client, registry } = makeAdapter()

    const result = await adapter.resumeSession({ name: 'repo', path: '/repo', threadId: 'thread_9' })

    expect(result).toEqual({ sessionPath: '/repo:0', threadId: 'thread_9' })
    expect(registry.get('/repo:0')?.threadId).toBe('thread_9')
    expect(client.requests[0]).toMatchObject({
      method: 'thread/resume',
      params: { threadId: 'thread_9', cwd: '/repo' },
    })
  })

  test('sends first message with turn/start and second active message with turn/steer', async () => {
    const { adapter, client } = makeAdapter()
    await adapter.startSession({ name: 'repo', path: '/repo' })

    expect(await adapter.send('/repo:0', 'first', { source: 'hub', frontend: 'web', user: 'u', session: 'repo' })).toBe(true)
    expect(await adapter.send('/repo:0', 'second', { source: 'hub', frontend: 'web', user: 'u', session: 'repo' })).toBe(true)

    expect(client.requests.map(r => r.method)).toEqual(['thread/start', 'turn/start', 'turn/steer'])
    expect(client.requests[1]).toMatchObject({ params: { threadId: 'thread_1', message: 'first' } })
    expect(client.requests[2]).toMatchObject({ params: { threadId: 'thread_1', turnId: 'turn_1', message: 'second' } })
  })

  test('delivers completed assistant messages once', async () => {
    const { adapter, client, deliveries } = makeAdapter()
    await adapter.startSession({ name: 'repo', path: '/repo' })

    client.emit('item/agentMessage/delta', { threadId: 'thread_1', turnId: 'turn_1', itemId: 'item_1', delta: 'hel' })
    client.emit('item/agentMessage/delta', { threadId: 'thread_1', turnId: 'turn_1', itemId: 'item_1', delta: 'lo' })
    client.emit('item/completed', { threadId: 'thread_1', turnId: 'turn_1', itemId: 'item_1' })

    expect(deliveries).toEqual([{ path: '/repo:0', text: 'hello', files: undefined }])
  })

  test('records command, file-change, and turn completion events for peek', async () => {
    const { adapter, client } = makeAdapter()
    await adapter.startSession({ name: 'repo', path: '/repo' })

    client.emit('item/commandExecution/output', { threadId: 'thread_1', output: 'ran tests' })
    client.emit('item/fileChange/output', { threadId: 'thread_1', path: '/repo/a.ts', action: 'write' })
    client.emit('turn/completed', { threadId: 'thread_1', turnId: 'turn_1', status: 'completed' })

    expect(await adapter.peek('/repo:0', 10)).toContain('[command] ran tests')
    expect(await adapter.peek('/repo:0', 10)).toContain('[file-change] write /repo/a.ts')
    expect(await adapter.peek('/repo:0', 10)).toContain('[turn] completed')
  })
})
