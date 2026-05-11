# CodexHub App Server Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ChannelHub's Claude channel/shim transport with a Codex App Server backend while preserving Web, Telegram, Rubika, CLI, profiles, permissions, uploads, verification, browser support, and session routing.

**Architecture:** Keep the product shell and introduce a typed `AgentSessionBackend` boundary. CodexHub owns Codex App Server JSON-RPC over stdio, persists Hub session to Codex thread mappings, converts Codex events into existing frontend deliveries, and routes Codex approval requests through `PermissionEngine`.

**Tech Stack:** Bun, TypeScript, Bun test, Codex App Server JSON-RPC, existing ChannelHub frontend and daemon modules.

---

## Resolved Decisions

- Use `codex app-server --listen stdio://` as the default transport.
- Deliver assistant replies on completed message/item events first; streaming edits can be added after the port is stable.
- Store Hub data under `~/.codexhub` by default while accepting legacy session files during migration tests.
- Treat team creation as Hub-managed multiple Codex threads only after the single-session path is stable; v1 command behavior returns clear "not available in CodexHub v1" messages.
- Make `/btw` unavailable in v1 with a clear message; keep autopilot state toggles but do not run Claude TUI overlay code.
- Replace `/peek` tmux capture with `AgentEventLog.recentText(sessionPath, lines)`.

## File Structure

- Create `src/agent-backend.ts`: backend interface used by daemon/frontends instead of `SocketServer` and `ScreenManager`.
- Create `src/codex/app-server-client.ts`: JSON-RPC stdio client, request correlation, notification dispatch, server-request dispatch.
- Create `src/codex/types.ts`: local App Server request/notification types used by tests and adapter.
- Create `src/codex/thread-store.ts`: persistent session/thread mapping under `HUB_DIR`.
- Create `src/codex/event-log.ts`: bounded per-session event log for `/peek` and debugging.
- Create `src/codex/approval-bridge.ts`: Codex approval request to `PermissionEngine` mapping and approval response delivery.
- Create `src/codex/session-adapter.ts`: Hub session lifecycle, Codex thread start/resume, turn start/steer, completed-message delivery.
- Modify `src/types.ts`: add `threadId` and `lastTurnId` to saved session config; add backend delivery types where useful.
- Modify `src/config.ts`: switch default data dir to `~/.codexhub`; keep `CODEXHUB_DIR`, `HUB_DIR`, and `CLAUDE_PLUGIN_DATA` compatibility order.
- Modify `src/session-registry.ts`: preserve Codex thread metadata in save/restore.
- Modify `src/message-router.ts`: keep the constructor shape, but route through an injected backend send function and test meta preservation.
- Modify `src/daemon.ts`: construct Codex backend, wire events into router/frontends, stop primary socket/shim path.
- Modify `src/frontends/web.ts`, `src/frontends/telegram.ts`, `src/frontends/rubika.ts`: replace lifecycle and approval callback dependencies with `AgentSessionBackend`; update `/peek`, `/btw`, and team messages.
- Modify `src/frontends/web-client.html`: rename peek labels from tmux to event log.
- Modify `src/cli.ts`, `README.md`, `CLAUDE.md`, `package.json`: CodexHub naming and commands.
- Keep `src/shim.ts`, `src/socket-server.ts`, and related tests until daemon is on Codex; then either remove from build/bin or mark legacy-only in tests.

---

### Task 1: Define The Backend Boundary

**Files:**
- Create: `src/agent-backend.ts`
- Modify: `src/types.ts`
- Test: `tests/agent-backend.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/agent-backend.test.ts
import { describe, expect, test } from 'bun:test'
import type { AgentSessionBackend } from '../src/agent-backend'

describe('AgentSessionBackend contract', () => {
  test('mock backend accepts lifecycle and approval calls used by frontends', async () => {
    const calls: string[] = []
    const backend: AgentSessionBackend = {
      async startSession(input) { calls.push(`start:${input.name}:${input.path}`); return { sessionPath: `${input.path}:0`, threadId: 'thread_1' } },
      async resumeSession(input) { calls.push(`resume:${input.name}:${input.threadId ?? 'latest'}`); return { sessionPath: `${input.path}:0`, threadId: input.threadId ?? 'thread_latest' } },
      async stopSession(name) { calls.push(`stop:${name}`) },
      async removeSession(name) { calls.push(`remove:${name}`) },
      async send(path, content, meta) { calls.push(`send:${path}:${meta.frontend}:${content}`); return true },
      async resolveApproval(requestId, behavior) { calls.push(`approval:${requestId}:${behavior}`) },
      async peek(path, lines) { calls.push(`peek:${path}:${lines}`); return 'recent events' },
      async shutdown() { calls.push('shutdown') },
    }

    await backend.startSession({ name: 'sap', path: '/work/sap', instructions: 'hello' })
    await backend.resumeSession({ name: 'sap', path: '/work/sap', threadId: 'thread_9' })
    await backend.send('/work/sap:0', 'fix', { source: 'hub', frontend: 'rubika', user: 'u1', session: 'sap' })
    await backend.resolveApproval('req_1', 'allow')
    expect(await backend.peek('/work/sap:0', 20)).toBe('recent events')
    expect(calls).toContain('send:/work/sap:0:rubika:fix')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/agent-backend.test.ts`
Expected: fail because `src/agent-backend.ts` does not exist.

- [ ] **Step 3: Add the interface**

```ts
// src/agent-backend.ts
import type { FrontendSource } from './types'

export type BackendSendMeta = {
  source: string
  frontend: FrontendSource
  user: string
  session: string
}

export type StartSessionInput = {
  name: string
  path: string
  instructions?: string
  profileName?: string
  trust?: import('./types').TrustLevel
  teamSize?: number
}

export type ResumeSessionInput = StartSessionInput & {
  threadId?: string
}

export type StartSessionResult = {
  sessionPath: string
  threadId: string
}

export interface AgentSessionBackend {
  startSession(input: StartSessionInput): Promise<StartSessionResult>
  resumeSession(input: ResumeSessionInput): Promise<StartSessionResult>
  stopSession(name: string): Promise<void>
  removeSession(name: string): Promise<void>
  send(path: string, content: string, meta: BackendSendMeta): Promise<boolean>
  resolveApproval(requestId: string, behavior: 'allow' | 'deny'): Promise<void>
  peek(path: string, lines: number): Promise<string>
  shutdown(): Promise<void>
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/agent-backend.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/agent-backend.ts tests/agent-backend.test.ts
git commit -m "feat: define CodexHub backend boundary"
```

### Task 2: Add Codex App Server JSON-RPC Client

**Files:**
- Create: `src/codex/types.ts`
- Create: `src/codex/app-server-client.ts`
- Test: `tests/codex/app-server-client.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/codex/app-server-client.test.ts
import { describe, expect, test } from 'bun:test'
import { CodexAppServerClient, createLineJsonRpcTransport } from '../../src/codex/app-server-client'

describe('CodexAppServerClient', () => {
  test('correlates JSON-RPC responses by id', async () => {
    const writes: string[] = []
    let onLine: ((line: string) => void) | undefined
    const client = new CodexAppServerClient(createLineJsonRpcTransport({
      write(line) { writes.push(line) },
      onLine(cb) { onLine = cb },
      close() {},
    }))
    const promise = client.request('thread/start', { cwd: '/repo' })
    const id = JSON.parse(writes[0]!).id
    onLine!(JSON.stringify({ jsonrpc: '2.0', id, result: { threadId: 'thread_1' } }))
    await expect(promise).resolves.toEqual({ threadId: 'thread_1' })
  })

  test('dispatches notifications without resolving pending requests', async () => {
    const events: unknown[] = []
    let onLine: ((line: string) => void) | undefined
    const client = new CodexAppServerClient(createLineJsonRpcTransport({
      write() {},
      onLine(cb) { onLine = cb },
      close() {},
    }))
    client.onNotification('item/agentMessage/delta', (params) => events.push(params))
    onLine!(JSON.stringify({ jsonrpc: '2.0', method: 'item/agentMessage/delta', params: { threadId: 't1', text: 'hi' } }))
    expect(events).toEqual([{ threadId: 't1', text: 'hi' }])
  })

  test('dispatches server approval requests and answers them by id', async () => {
    const writes: string[] = []
    let onLine: ((line: string) => void) | undefined
    const client = new CodexAppServerClient(createLineJsonRpcTransport({
      write(line) { writes.push(line) },
      onLine(cb) { onLine = cb },
      close() {},
    }))
    client.onServerRequest('item/commandExecution/requestApproval', async () => ({ decision: 'approved' }))
    onLine!(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'item/commandExecution/requestApproval', params: { command: 'ls' } }))
    expect(JSON.parse(writes[0]!)).toEqual({ jsonrpc: '2.0', id: 7, result: { decision: 'approved' } })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/codex/app-server-client.test.ts`
Expected: fail because client files do not exist.

- [ ] **Step 3: Add minimal types**

```ts
// src/codex/types.ts
export type JsonRpcId = string | number

export type CodexThreadStartParams = { cwd: string; instructions?: string; model?: string; sandbox?: string }
export type CodexThreadStartResult = { threadId: string }
export type CodexThreadResumeParams = { threadId: string; cwd?: string }
export type CodexTurnStartParams = { threadId: string; message: string }
export type CodexTurnStartResult = { turnId: string }
export type CodexTurnSteerParams = { threadId: string; turnId: string; message: string }

export type CodexNotification = {
  method: string
  params: Record<string, unknown>
}
```

- [ ] **Step 4: Implement line-delimited JSON-RPC client**

```ts
// src/codex/app-server-client.ts
import type { JsonRpcId } from './types'

export type JsonRpcTransport = {
  send(message: unknown): void
  close(): void
}

type LineTransportInput = {
  write(line: string): void
  onLine(cb: (line: string) => void): void
  close(): void
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export function createLineJsonRpcTransport(input: LineTransportInput): JsonRpcTransport & { setReceiver(cb: (message: unknown) => void): void } {
  let receiver: (message: unknown) => void = () => {}
  input.onLine((line) => {
    if (!line.trim()) return
    receiver(JSON.parse(line))
  })
  return {
    setReceiver(cb) { receiver = cb },
    send(message) { input.write(JSON.stringify(message)) },
    close() { input.close() },
  }
}

export class CodexAppServerClient {
  private nextId = 1
  private pending = new Map<JsonRpcId, Pending>()
  private notifications = new Map<string, Set<(params: any) => void>>()
  private requests = new Map<string, (params: any) => Promise<unknown> | unknown>()

  constructor(private transport: JsonRpcTransport & { setReceiver?: (cb: (message: unknown) => void) => void }) {
    this.transport.setReceiver?.((message) => this.receive(message as any))
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
    })
    this.transport.send({ jsonrpc: '2.0', id, method, params })
    return promise
  }

  onNotification(method: string, cb: (params: any) => void): void {
    const set = this.notifications.get(method) ?? new Set()
    set.add(cb)
    this.notifications.set(method, set)
  }

  onServerRequest(method: string, cb: (params: any) => Promise<unknown> | unknown): void {
    this.requests.set(method, cb)
  }

  private async receive(message: any): Promise<void> {
    if ('id' in message && ('result' in message || 'error' in message) && !message.method) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message ?? 'Codex App Server error'))
      else pending.resolve(message.result)
      return
    }
    if (message.method && 'id' in message) {
      const handler = this.requests.get(message.method)
      if (!handler) {
        this.transport.send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `No handler for ${message.method}` } })
        return
      }
      try {
        const result = await handler(message.params ?? {})
        this.transport.send({ jsonrpc: '2.0', id: message.id, result })
      } catch (err) {
        this.transport.send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: String(err) } })
      }
      return
    }
    if (message.method) {
      for (const cb of this.notifications.get(message.method) ?? []) cb(message.params ?? {})
    }
  }

  close(): void {
    this.transport.close()
  }
}
```

- [ ] **Step 5: Run tests**

Run: `bun test tests/codex/app-server-client.test.ts`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/codex/types.ts src/codex/app-server-client.ts tests/codex/app-server-client.test.ts
git commit -m "feat: add Codex App Server JSON-RPC client"
```

### Task 3: Persist Codex Thread Mappings

**Files:**
- Create: `src/codex/thread-store.ts`
- Modify: `src/types.ts`
- Modify: `src/session-registry.ts`
- Test: `tests/codex/thread-store.test.ts`
- Test: `tests/session-registry.test.ts`

- [ ] **Step 1: Write failing thread-store tests**

```ts
// tests/codex/thread-store.test.ts
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { CodexThreadStore } from '../../src/codex/thread-store'

describe('CodexThreadStore', () => {
  test('saves and loads session thread records', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codexhub-thread-store-'))
    try {
      const store = new CodexThreadStore(dir)
      store.upsert({ sessionPath: '/repo:0', sessionName: 'repo', folderPath: '/repo', threadId: 'thread_1', trust: 'ask', prefix: '', uploadDir: '.', managed: true, teamIndex: 0, teamSize: 0 })
      expect(new CodexThreadStore(dir).get('/repo:0')?.threadId).toBe('thread_1')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Add session-registry persistence test**

```ts
test('toSaveFormat preserves Codex thread metadata', () => {
  const reg = new SessionRegistry({ defaultTrust: 'ask', defaultUploadDir: '.' })
  reg.register('/repo:0', { name: 'repo', threadId: 'thread_1', lastTurnId: 'turn_1' })
  expect(reg.toSaveFormat()['/repo:0']).toMatchObject({ threadId: 'thread_1', lastTurnId: 'turn_1' })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/codex/thread-store.test.ts tests/session-registry.test.ts`
Expected: fail because thread store and metadata fields do not exist.

- [ ] **Step 4: Extend session config types**

Add to `SessionConfig` in `src/types.ts`:

```ts
  threadId?: string
  lastTurnId?: string
```

- [ ] **Step 5: Implement `CodexThreadStore`**

```ts
// src/codex/thread-store.ts
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { SessionConfig } from '../types'

export type CodexThreadRecord = SessionConfig & {
  sessionPath: string
  sessionName: string
  folderPath: string
  threadId: string
}

export class CodexThreadStore {
  private file: string
  constructor(private dir: string) {
    this.file = join(dir, 'codex-threads.json')
  }

  load(): Record<string, CodexThreadRecord> {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, CodexThreadRecord>
    } catch {
      return {}
    }
  }

  get(sessionPath: string): CodexThreadRecord | undefined {
    return this.load()[sessionPath]
  }

  upsert(record: CodexThreadRecord): void {
    const all = this.load()
    all[record.sessionPath] = record
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 })
    renameSync(tmp, this.file)
  }

  remove(sessionPath: string): void {
    const all = this.load()
    delete all[sessionPath]
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 })
    renameSync(tmp, this.file)
  }
}
```

- [ ] **Step 6: Preserve metadata in `SessionRegistry.toSaveFormat` and `restoreFrom`**

Add `threadId` and `lastTurnId` when creating/restoring/saving sessions.

- [ ] **Step 7: Run tests**

Run: `bun test tests/codex/thread-store.test.ts tests/session-registry.test.ts`
Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/session-registry.ts src/codex/thread-store.ts tests/codex/thread-store.test.ts tests/session-registry.test.ts
git commit -m "feat: persist Codex thread metadata"
```

### Task 4: Add Agent Event Log For Peek

**Files:**
- Create: `src/codex/event-log.ts`
- Test: `tests/codex/event-log.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/codex/event-log.test.ts
import { describe, expect, test } from 'bun:test'
import { AgentEventLog } from '../../src/codex/event-log'

describe('AgentEventLog', () => {
  test('returns newest bounded text for a session', () => {
    const log = new AgentEventLog({ maxEntriesPerSession: 3 })
    log.append('/repo:0', { type: 'assistant', text: 'one' })
    log.append('/repo:0', { type: 'command', text: 'two' })
    log.append('/repo:0', { type: 'file-change', text: 'three' })
    log.append('/repo:0', { type: 'turn', text: 'four' })
    expect(log.recentText('/repo:0', 10)).not.toContain('one')
    expect(log.recentText('/repo:0', 2)).toBe('[file-change] three\n[turn] four')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/codex/event-log.test.ts`
Expected: fail because `AgentEventLog` does not exist.

- [ ] **Step 3: Implement event log**

```ts
// src/codex/event-log.ts
export type AgentEvent = {
  ts?: number
  type: 'assistant' | 'command' | 'file-change' | 'approval' | 'turn' | 'error'
  text: string
}

export class AgentEventLog {
  private maxEntriesPerSession: number
  private bySession = new Map<string, AgentEvent[]>()

  constructor(opts: { maxEntriesPerSession?: number } = {}) {
    this.maxEntriesPerSession = opts.maxEntriesPerSession ?? 500
  }

  append(sessionPath: string, event: AgentEvent): void {
    const list = this.bySession.get(sessionPath) ?? []
    list.push({ ...event, ts: event.ts ?? Date.now() })
    while (list.length > this.maxEntriesPerSession) list.shift()
    this.bySession.set(sessionPath, list)
  }

  recent(sessionPath: string, count: number): AgentEvent[] {
    return (this.bySession.get(sessionPath) ?? []).slice(-Math.max(1, Math.min(count, this.maxEntriesPerSession)))
  }

  recentText(sessionPath: string, count: number): string {
    return this.recent(sessionPath, count).map(e => `[${e.type}] ${e.text}`).join('\n')
  }
}
```

- [ ] **Step 4: Run test**

Run: `bun test tests/codex/event-log.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/codex/event-log.ts tests/codex/event-log.test.ts
git commit -m "feat: add CodexHub event log"
```

### Task 5: Map Codex Approval Requests

**Files:**
- Create: `src/codex/approval-bridge.ts`
- Test: `tests/codex/approval-bridge.test.ts`
- Test: `tests/permission-engine.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/codex/approval-bridge.test.ts
import { describe, expect, test } from 'bun:test'
import { CodexApprovalBridge } from '../../src/codex/approval-bridge'
import { PermissionEngine } from '../../src/permission-engine'
import { SessionRegistry } from '../../src/session-registry'

describe('CodexApprovalBridge', () => {
  test('auto-approved command returns approved response to Codex', async () => {
    const reg = new SessionRegistry({ defaultTrust: 'auto', defaultUploadDir: '.' })
    reg.register('/repo:0', { name: 'repo' })
    const engine = new PermissionEngine(reg, () => {})
    const bridge = new CodexApprovalBridge({ registry: reg, permissions: engine })
    await expect(bridge.handleServerRequest('/repo:0', 'item/commandExecution/requestApproval', {
      requestId: 'codex_req_1',
      command: 'ls',
      cwd: '/repo',
    })).resolves.toEqual({ decision: 'approved' })
  })

  test('escalated file change waits for frontend resolution', async () => {
    const reg = new SessionRegistry({ defaultTrust: 'ask', defaultUploadDir: '.' })
    reg.register('/repo:0', { name: 'repo' })
    const forwarded: string[] = []
    const engine = new PermissionEngine(reg, req => forwarded.push(req.requestId))
    const bridge = new CodexApprovalBridge({ registry: reg, permissions: engine })
    const pending = bridge.handleServerRequest('/repo:0', 'item/fileChange/requestApproval', {
      requestId: 'codex_req_2',
      path: '/repo/src/a.ts',
      action: 'write',
    })
    expect(forwarded).toEqual(['codex_req_2'])
    bridge.resolve('codex_req_2', 'deny')
    await expect(pending).resolves.toEqual({ decision: 'denied' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/codex/approval-bridge.test.ts`
Expected: fail because bridge does not exist.

- [ ] **Step 3: Implement bridge**

```ts
// src/codex/approval-bridge.ts
import type { PermissionEngine } from '../permission-engine'
import type { SessionRegistry } from '../session-registry'

type ApprovalDecision = { decision: 'approved' | 'denied' }

export class CodexApprovalBridge {
  private pending = new Map<string, (value: ApprovalDecision) => void>()

  constructor(private deps: { registry: SessionRegistry; permissions: PermissionEngine }) {}

  async handleServerRequest(sessionPath: string, method: string, params: Record<string, unknown>): Promise<ApprovalDecision> {
    const mapped = this.mapRequest(method, params)
    const response = this.deps.permissions.handle(sessionPath, mapped)
    if (response) return { decision: response.behavior === 'allow' ? 'approved' : 'denied' }
    return new Promise<ApprovalDecision>(resolve => {
      this.pending.set(mapped.requestId, resolve)
    })
  }

  resolve(requestId: string, behavior: 'allow' | 'deny'): boolean {
    const resolve = this.pending.get(requestId)
    if (!resolve) return false
    this.pending.delete(requestId)
    resolve({ decision: behavior === 'allow' ? 'approved' : 'denied' })
    return true
  }

  private mapRequest(method: string, params: Record<string, unknown>) {
    const requestId = String(params.requestId ?? params.id ?? `${method}:${Date.now()}`)
    if (method === 'item/commandExecution/requestApproval') {
      const command = String(params.command ?? '')
      return { requestId, toolName: 'Bash', description: `Run command: ${command}`, inputPreview: command, toolArgs: { command } }
    }
    if (method === 'item/fileChange/requestApproval') {
      const path = String(params.path ?? '')
      const action = String(params.action ?? 'change')
      return { requestId, toolName: action === 'delete' ? 'Delete' : 'Write', description: `${action} ${path}`, inputPreview: path, toolArgs: { file_path: path } }
    }
    return { requestId, toolName: 'CodexApproval', description: method, inputPreview: JSON.stringify(params), toolArgs: params }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/codex/approval-bridge.test.ts tests/permission-engine.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/codex/approval-bridge.ts tests/codex/approval-bridge.test.ts
git commit -m "feat: bridge Codex approvals to Hub permissions"
```

### Task 6: Implement Codex Session Adapter

**Files:**
- Create: `src/codex/session-adapter.ts`
- Test: `tests/codex/session-adapter.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/codex/session-adapter.test.ts
import { describe, expect, test } from 'bun:test'
import { CodexSessionAdapter } from '../../src/codex/session-adapter'
import { SessionRegistry } from '../../src/session-registry'
import { AgentEventLog } from '../../src/codex/event-log'

class FakeClient {
  requests: { method: string; params: any }[] = []
  handlers = new Map<string, ((params: any) => void)[]>()
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

describe('CodexSessionAdapter', () => {
  test('starts a thread and registers a Hub session', async () => {
    const client = new FakeClient()
    const registry = new SessionRegistry({ defaultTrust: 'ask', defaultUploadDir: '.' })
    const adapter = new CodexSessionAdapter({ client: client as any, registry, eventLog: new AgentEventLog(), deliver() {} })
    const result = await adapter.startSession({ name: 'repo', path: '/repo', instructions: 'base' })
    expect(result).toEqual({ sessionPath: '/repo:0', threadId: 'thread_1' })
    expect(registry.get('/repo:0')?.threadId).toBe('thread_1')
    expect(client.requests[0]).toMatchObject({ method: 'thread/start', params: { cwd: '/repo', instructions: 'base' } })
  })

  test('sends first message with turn/start and second active message with turn/steer', async () => {
    const client = new FakeClient()
    const registry = new SessionRegistry({ defaultTrust: 'ask', defaultUploadDir: '.' })
    const adapter = new CodexSessionAdapter({ client: client as any, registry, eventLog: new AgentEventLog(), deliver() {} })
    await adapter.startSession({ name: 'repo', path: '/repo' })
    expect(await adapter.send('/repo:0', 'first', { source: 'hub', frontend: 'web', user: 'u', session: 'repo' })).toBe(true)
    expect(await adapter.send('/repo:0', 'second', { source: 'hub', frontend: 'web', user: 'u', session: 'repo' })).toBe(true)
    expect(client.requests.map(r => r.method)).toEqual(['thread/start', 'turn/start', 'turn/steer'])
  })

  test('delivers completed assistant messages once', async () => {
    const client = new FakeClient()
    const deliveries: string[] = []
    const registry = new SessionRegistry({ defaultTrust: 'ask', defaultUploadDir: '.' })
    const adapter = new CodexSessionAdapter({ client: client as any, registry, eventLog: new AgentEventLog(), deliver(_path, text) { deliveries.push(text) } })
    await adapter.startSession({ name: 'repo', path: '/repo' })
    client.emit('item/agentMessage/delta', { threadId: 'thread_1', turnId: 'turn_1', itemId: 'item_1', delta: 'hel' })
    client.emit('item/agentMessage/delta', { threadId: 'thread_1', turnId: 'turn_1', itemId: 'item_1', delta: 'lo' })
    client.emit('item/completed', { threadId: 'thread_1', turnId: 'turn_1', itemId: 'item_1' })
    expect(deliveries).toEqual(['hello'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/codex/session-adapter.test.ts`
Expected: fail because adapter does not exist.

- [ ] **Step 3: Implement adapter**

Implement `CodexSessionAdapter` with:
- `startSession`: `registry.register(path + ':0', overrides)`, call `thread/start`, store `threadId`.
- `resumeSession`: call `thread/resume` when `threadId` exists; otherwise call `startSession`.
- `send`: call `turn/start` when `lastTurnId` is empty; call `turn/steer` when `lastTurnId` exists.
- notification handlers for `item/agentMessage/delta`, `item/completed`, `turn/completed`, command/file-change outputs.
- `peek`: delegate to `AgentEventLog.recentText`.
- `resolveApproval`: delegate to `CodexApprovalBridge.resolve`.

- [ ] **Step 4: Run tests**

Run: `bun test tests/codex/session-adapter.test.ts tests/codex/event-log.test.ts tests/codex/approval-bridge.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/codex/session-adapter.ts tests/codex/session-adapter.test.ts
git commit -m "feat: adapt Hub sessions to Codex threads"
```

### Task 7: Wire Router And Daemon To Codex Backend

**Files:**
- Modify: `src/message-router.ts`
- Modify: `src/daemon.ts`
- Test: `tests/message-router.test.ts`
- Test: `tests/integration.test.ts`

- [ ] **Step 1: Add router async backend test**

```ts
test('routeToSession accepts async backend send and preserves metadata', async () => {
  const registry = new SessionRegistry({ defaultTrust: 'ask', defaultUploadDir: '.' })
  registry.register('/repo:0', { name: 'repo' })
  const sent: any[] = []
  const router = new MessageRouter(
    registry,
    (path, content, meta) => { sent.push({ path, content, meta }); return true },
    () => {},
  )
  expect(router.routeToSession('repo', 'ship it', 'rubika', 'u1')).toBe(true)
  expect(sent[0]).toMatchObject({ path: '/repo:0', content: 'ship it', meta: { frontend: 'rubika', user: 'u1', session: 'repo' } })
})
```

- [ ] **Step 2: Add daemon integration test with fake backend**

Create an integration helper that constructs `MessageRouter` using a fake `AgentSessionBackend.send`, calls `routeToSession`, and asserts the backend receives profile-injected content.

- [ ] **Step 3: Run targeted tests**

Run: `bun test tests/message-router.test.ts tests/integration.test.ts`
Expected: pass before daemon edits, or fail only on newly added daemon helper.

- [ ] **Step 4: Refactor daemon wiring**

In `src/daemon.ts`:
- create `CodexAppServerClient` process transport,
- create `AgentEventLog`,
- create `CodexApprovalBridge`,
- create `CodexSessionAdapter`,
- pass adapter `send` into `MessageRouter`,
- replace socket permission response path with `codexAdapter.resolveApproval`,
- keep `SocketServer` construction behind a legacy flag only if tests still need it.

- [ ] **Step 5: Run daemon/router tests**

Run: `bun test tests/message-router.test.ts tests/integration.test.ts tests/codex/session-adapter.test.ts`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/daemon.ts src/message-router.ts tests/message-router.test.ts tests/integration.test.ts
git commit -m "feat: route daemon messages through Codex backend"
```

### Task 8: Replace Frontend Lifecycle Dependencies

**Files:**
- Modify: `src/frontends/web.ts`
- Modify: `src/frontends/telegram.ts`
- Modify: `src/frontends/rubika.ts`
- Test: `tests/frontends/web.test.ts`
- Test: `tests/frontends/telegram.test.ts`
- Test: `tests/frontends/rubika.test.ts`
- Test: `tests/frontends/rubika.integration.test.ts`

- [ ] **Step 1: Add failing frontend tests**

Add tests that assert:
- Web `POST /api/spawn` calls `backend.startSession`.
- Telegram `/spawn` calls `backend.startSession`.
- Rubika `/spawn` calls `backend.startSession`.
- Permission callbacks call `backend.resolveApproval`.
- `/peek` calls `backend.peek`.
- `/btw` replies with `Not available in CodexHub v1.`
- Team add replies with `Teams are not available in CodexHub v1.`

- [ ] **Step 2: Run tests to verify failure**

Run: `bun test tests/frontends/web.test.ts tests/frontends/telegram.test.ts tests/frontends/rubika.test.ts tests/frontends/rubika.integration.test.ts`
Expected: fail on new backend expectations.

- [ ] **Step 3: Modify dependency types**

Change frontend deps from `screenManager/socketServer` for lifecycle and approval to:

```ts
backend?: AgentSessionBackend
```

Use `backend.startSession`, `backend.resumeSession`, `backend.stopSession`, `backend.removeSession`, `backend.resolveApproval`, and `backend.peek` in command handlers.

- [ ] **Step 4: Preserve uploads and verification**

Keep upload destination logic based on `SessionRegistry` folder paths. Keep `VerificationRunner` unchanged.

- [ ] **Step 5: Run frontend tests**

Run: `bun test tests/frontends/web.test.ts tests/frontends/telegram.test.ts tests/frontends/rubika.test.ts tests/frontends/rubika.integration.test.ts`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/frontends/web.ts src/frontends/telegram.ts src/frontends/rubika.ts tests/frontends/web.test.ts tests/frontends/telegram.test.ts tests/frontends/rubika.test.ts tests/frontends/rubika.integration.test.ts
git commit -m "feat: use Codex backend from frontends"
```

### Task 9: Update Config, Profiles, CLI, And Branding

**Files:**
- Modify: `src/config.ts`
- Modify: `src/profiles.ts`
- Modify: `src/cli.ts`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Test: `tests/config.test.ts`
- Test: `tests/profiles.test.ts`
- Test: `tests/cli.test.ts`

- [ ] **Step 1: Add failing tests**

Tests should assert:
- default `HUB_DIR` prefers `CODEXHUB_DIR`, then `HUB_DIR`, then `~/.codexhub`;
- profile channel instructions say CodexHub/Codex where backend-specific wording appears;
- CLI help starts with `CodexHub CLI`;
- package name is `codexhub`, bin names include `codexhub` and `codexhub-daemon`.

- [ ] **Step 2: Run tests**

Run: `bun test tests/config.test.ts tests/profiles.test.ts tests/cli.test.ts`
Expected: fail on branding/path assertions.

- [ ] **Step 3: Make changes**

Update code and docs strings without changing frontend command semantics.

- [ ] **Step 4: Run tests**

Run: `bun test tests/config.test.ts tests/profiles.test.ts tests/cli.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/profiles.ts src/cli.ts package.json README.md CLAUDE.md tests/config.test.ts tests/profiles.test.ts tests/cli.test.ts
git commit -m "chore: rename product shell to CodexHub"
```

### Task 10: Replace Prior Session And Peek Behavior

**Files:**
- Modify: `src/claude-sessions.ts` or replace with `src/codex/prior-sessions.ts`
- Modify: `src/frontends/web-client.html`
- Modify: `src/frontends/web.ts`
- Modify: `src/frontends/telegram.ts`
- Modify: `src/frontends/rubika.ts`
- Test: `tests/claude-sessions.test.ts` or new `tests/codex/prior-sessions.test.ts`
- Test: `tests/frontends/web-client-helpers.test.ts`

- [ ] **Step 1: Add failing tests**

Assert that:
- prior sessions list comes from `CodexThreadStore` records;
- web peek title is `event log: <session>`;
- Telegram/Rubika `/peek` text is event-log content and does not call tmux.

- [ ] **Step 2: Run tests**

Run: `bun test tests/codex/prior-sessions.test.ts tests/frontends/web-client-helpers.test.ts tests/frontends/telegram.test.ts tests/frontends/rubika.test.ts`
Expected: fail until old Claude/tmux paths are replaced.

- [ ] **Step 3: Implement prior-session reader**

Create `src/codex/prior-sessions.ts` that reads `CodexThreadStore.load()` and returns records grouped by folder path for spawn/resume UI.

- [ ] **Step 4: Update peek UI copy**

Change visible labels from `Peek tmux`, `tmux pane`, and `tmux: hub-...` to `Peek log`, `event log`, and `event log: ...`.

- [ ] **Step 5: Run tests**

Run: `bun test tests/codex/prior-sessions.test.ts tests/frontends/web-client-helpers.test.ts tests/frontends/telegram.test.ts tests/frontends/rubika.test.ts`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/codex/prior-sessions.ts src/frontends/web-client.html src/frontends/web.ts src/frontends/telegram.ts src/frontends/rubika.ts tests/codex/prior-sessions.test.ts tests/frontends/web-client-helpers.test.ts tests/frontends/telegram.test.ts tests/frontends/rubika.test.ts
git commit -m "feat: use Codex event log and thread history"
```

### Task 11: Remove Primary Shim And Tmux Launch Path

**Files:**
- Modify: `package.json`
- Modify: `src/daemon.ts`
- Modify: `src/screen-manager.ts`
- Modify: `tests/shim.test.ts`
- Modify: `tests/shim-reconnect.test.ts`
- Modify: `tests/screen-manager.test.ts`

- [ ] **Step 1: Add or update tests**

Assert:
- package `daemon` script starts CodexHub daemon only;
- package no longer exposes `hub-shim` as the primary bin;
- `ScreenManager` tests only cover legacy helper behavior if the file remains;
- daemon startup does not require a Unix socket.

- [ ] **Step 2: Run tests**

Run: `bun test tests/shim.test.ts tests/shim-reconnect.test.ts tests/screen-manager.test.ts tests/integration.test.ts`
Expected: fail where primary shim assumptions remain.

- [ ] **Step 3: Remove primary path**

Remove `SocketServer -> shim` from the main daemon path and package build/bin. Keep source files only if tests or migration docs need a legacy reference.

- [ ] **Step 4: Run tests**

Run: `bun test tests/shim.test.ts tests/shim-reconnect.test.ts tests/screen-manager.test.ts tests/integration.test.ts`
Expected: pass with legacy tests adjusted or removed.

- [ ] **Step 5: Commit**

```bash
git add package.json src/daemon.ts src/screen-manager.ts tests/shim.test.ts tests/shim-reconnect.test.ts tests/screen-manager.test.ts tests/integration.test.ts
git commit -m "chore: remove Claude shim as primary backend"
```

### Task 12: Full Verification And Smoke Test

**Files:**
- Modify as needed only for defects found by verification.

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: all tests pass; baseline target remains no regressions from the recorded `674 pass, 1 skip, 0 fail`.

- [ ] **Step 2: Run an opt-in local App Server smoke test**

Run only if `codex app-server --help` works locally:

```bash
codex app-server --help
```

Expected: command exits 0 and confirms App Server is installed. Do not require authenticated real Codex integration for normal CI.

- [ ] **Step 3: Review uncommitted changes**

Run: `git status --short`
Expected: only intentional files are modified.

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "feat: port CodexHub to Codex App Server"
```

---

## Self-Review

- Spec coverage: Codex App Server client, request correlation, notification dispatch, approval bridge, trust policy, session start/resume, turn start/steer, frontend routing, Rubika permission callbacks, `/peek` event log, verification preservation, browser preservation, and primary shim replacement are covered by Tasks 1-12.
- Placeholder scan: no task uses unresolved placeholder text; each code-creating task includes concrete file paths, test intent, command, and expected result.
- Type consistency: `AgentSessionBackend`, `CodexAppServerClient`, `CodexApprovalBridge`, `CodexSessionAdapter`, `CodexThreadStore`, and `AgentEventLog` names are consistent across tasks.
- Open choices resolved: stdio transport, completed-message delivery first, CodexThreadStore prior sessions, v1 unavailable messages for teams and `/btw`, and event-log-backed `/peek`.
