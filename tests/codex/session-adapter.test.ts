// tests/codex/session-adapter.test.ts
import { describe, expect, test } from 'bun:test'
import { CodexSessionAdapter } from '../../src/codex/session-adapter'
import { AgentEventLog } from '../../src/codex/event-log'
import { SessionRegistry } from '../../src/session-registry'

class FakeClient {
  requests: Array<{ method: string; params: any }> = []
  handlers = new Map<string, Array<(params: any) => void>>()
  failResumeThreadIds = new Set<string>()
  private turnCount = 0

  async request(method: string, params: any) {
    this.requests.push({ method, params })
    if (method === 'thread/start') return { thread: { id: 'thread_1' } }
    if (method === 'thread/resume') {
      if (this.failResumeThreadIds.has(params.threadId)) throw new Error('no rollout found')
      return { thread: { id: params.threadId } }
    }
    if (method === 'turn/start') return { turn: { id: `turn_${++this.turnCount}` } }
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
      params: { cwd: '/repo', developerInstructions: 'base', threadSource: 'user' },
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

  test('restores persisted Codex threads as active sessions and clears stale turn ids', async () => {
    const { adapter, client, registry } = makeAdapter()
    registry.restoreFrom({
      '/repo:0': {
        name: 'repo',
        trust: 'ask',
        prefix: '',
        uploadDir: '.',
        managed: true,
        teamIndex: 0,
        teamSize: 1,
        threadId: 'thread_9',
        lastTurnId: 'stale_turn',
      },
    })

    expect(registry.get('/repo:0')?.status).toBe('disconnected')
    expect(await adapter.restorePersistedSessions()).toBe(1)

    expect(registry.get('/repo:0')?.status).toBe('active')
    expect(registry.get('/repo:0')?.lastTurnId).toBeUndefined()
    expect(client.requests[0]).toMatchObject({
      method: 'thread/resume',
      params: { threadId: 'thread_9', cwd: '/repo' },
    })
    expect(await adapter.send('/repo:0', 'hello', { source: 'hub', frontend: 'rubika', user: 'u', session: 'repo' })).toBe(true)
    expect(client.requests.map(r => r.method)).toEqual(['thread/resume', 'turn/start'])
  })

  test('starts a fresh Codex thread when a persisted thread cannot be restored', async () => {
    const { adapter, client, registry } = makeAdapter()
    client.failResumeThreadIds.add('missing_thread')
    registry.restoreFrom({
      '/missing:0': {
        name: 'missing',
        trust: 'ask',
        prefix: '',
        uploadDir: '.',
        managed: true,
        teamIndex: 0,
        teamSize: 1,
        threadId: 'missing_thread',
        lastTurnId: 'stale_turn',
      },
      '/repo:0': {
        name: 'repo',
        trust: 'ask',
        prefix: '',
        uploadDir: '.',
        managed: true,
        teamIndex: 0,
        teamSize: 1,
        threadId: 'thread_9',
        lastTurnId: 'stale_turn',
      },
    })

    expect(await adapter.restorePersistedSessions()).toBe(2)

    expect(registry.get('/missing:0')?.status).toBe('active')
    expect(registry.get('/missing:0')?.lastTurnId).toBeUndefined()
    expect(registry.get('/missing:0')?.threadId).toBe('thread_1')
    expect(registry.get('/repo:0')?.status).toBe('active')
    expect(client.requests.map(r => r.method)).toEqual(['thread/resume', 'thread/start', 'thread/resume'])
    expect(client.requests[1]).toMatchObject({
      method: 'thread/start',
      params: { cwd: '/missing', threadSource: 'user' },
    })
    expect(await adapter.send('/missing:0', 'hello', { source: 'hub', frontend: 'rubika', user: 'u', session: 'missing' })).toBe(true)
    expect(await adapter.send('/repo:0', 'hello', { source: 'hub', frontend: 'rubika', user: 'u', session: 'repo' })).toBe(true)
  })

  test('sends first message with turn/start and second active message with turn/steer', async () => {
    const { adapter, client } = makeAdapter()
    await adapter.startSession({ name: 'repo', path: '/repo' })

    expect(await adapter.send('/repo:0', 'first', { source: 'hub', frontend: 'web', user: 'u', session: 'repo' })).toBe(true)
    expect(await adapter.send('/repo:0', 'second', { source: 'hub', frontend: 'web', user: 'u', session: 'repo' })).toBe(true)

    expect(client.requests.map(r => r.method)).toEqual(['thread/start', 'turn/start', 'turn/steer'])
    expect(client.requests[1]).toMatchObject({
      params: { threadId: 'thread_1', input: [{ type: 'text', text: 'first' }] },
    })
    expect(client.requests[2]).toMatchObject({
      params: { threadId: 'thread_1', expectedTurnId: 'turn_1', input: [{ type: 'text', text: 'second' }] },
    })
  })

  test('starts a fresh turn after Codex reports the prior turn completed', async () => {
    const { adapter, client } = makeAdapter()
    await adapter.startSession({ name: 'repo', path: '/repo' })

    expect(await adapter.send('/repo:0', 'first', { source: 'hub', frontend: 'rubika', user: 'u', session: 'repo' })).toBe(true)
    client.emit('turn/completed', { threadId: 'thread_1', turn: { id: 'turn_1', status: 'completed' } })
    expect(await adapter.send('/repo:0', 'second', { source: 'hub', frontend: 'rubika', user: 'u', session: 'repo' })).toBe(true)

    expect(client.requests.map(r => r.method)).toEqual(['thread/start', 'turn/start', 'turn/start'])
    expect(client.requests[2]).toMatchObject({
      params: { threadId: 'thread_1', input: [{ type: 'text', text: 'second' }] },
    })
  })

  test('delivers completed assistant messages once', async () => {
    const { adapter, client, deliveries } = makeAdapter()
    await adapter.startSession({ name: 'repo', path: '/repo' })

    client.emit('item/agentMessage/delta', { threadId: 'thread_1', turnId: 'turn_1', itemId: 'item_1', delta: 'hel' })
    client.emit('item/agentMessage/delta', { threadId: 'thread_1', turnId: 'turn_1', itemId: 'item_1', delta: 'lo' })
    client.emit('item/completed', { threadId: 'thread_1', turnId: 'turn_1', item: { id: 'item_1', type: 'agentMessage' } })

    expect(deliveries).toEqual([{ path: '/repo:0', text: 'hello', files: undefined }])
  })

  test('delivers completed assistant message text when no delta was streamed', async () => {
    const { adapter, client, deliveries } = makeAdapter()
    await adapter.startSession({ name: 'repo', path: '/repo' })

    client.emit('item/completed', {
      threadId: 'thread_1',
      turnId: 'turn_1',
      item: { id: 'item_1', type: 'agentMessage', text: 'hello from completed item' },
    })

    expect(deliveries).toEqual([{ path: '/repo:0', text: 'hello from completed item', files: undefined }])
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
