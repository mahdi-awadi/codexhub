// src/codex/session-adapter.ts
import type { AgentSessionBackend, BackendSendMeta, ResumeSessionInput, StartSessionInput, StartSessionResult } from '../agent-backend'
import type { SessionRegistry } from '../session-registry'
import type { CodexApprovalBridge } from './approval-bridge'
import type { AgentEventLog } from './event-log'

type CodexClient = {
  request<T = unknown>(method: string, params: unknown): Promise<T>
  onNotification(method: string, cb: (params: any) => void): void
  onServerRequest?(method: string, cb: (params: any) => Promise<unknown> | unknown): void
}

type SessionAdapterDeps = {
  client: CodexClient
  registry: SessionRegistry
  eventLog: AgentEventLog
  approvalBridge?: CodexApprovalBridge
  deliver(path: string, text: string, files?: string[]): void
}

type ThreadStartResult = {
  threadId?: string
  thread?: { id?: string }
}

type TurnStartResult = {
  turnId?: string
  turn?: { id?: string }
}

function threadIdFrom(result: ThreadStartResult): string {
  const id = result.threadId ?? result.thread?.id
  if (!id) throw new Error('Codex thread/start response did not include a thread id')
  return id
}

function turnIdFrom(result: TurnStartResult): string {
  const id = result.turnId ?? result.turn?.id
  if (!id) throw new Error('Codex turn/start response did not include a turn id')
  return id
}

function textInput(text: string): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text }]
}

export class CodexSessionAdapter implements AgentSessionBackend {
  private threadToSessionPath = new Map<string, string>()
  private messageBuffers = new Map<string, string>()

  constructor(private deps: SessionAdapterDeps) {
    this.deps.client.onNotification('item/agentMessage/delta', (params) => this.onAgentMessageDelta(params))
    this.deps.client.onNotification('item/completed', (params) => this.onItemCompleted(params))
    this.deps.client.onNotification('turn/completed', (params) => this.onTurnCompleted(params))
    this.deps.client.onNotification('item/commandExecution/output', (params) => this.onCommandOutput(params))
    this.deps.client.onNotification('item/fileChange/output', (params) => this.onFileChangeOutput(params))
    for (const method of [
      'item/commandExecution/requestApproval',
      'item/fileChange/requestApproval',
      'item/permissions/requestApproval',
      'item/tool/requestUserInput',
      'mcpServer/elicitation/request',
    ]) {
      this.deps.client.onServerRequest?.(method, (params) => this.onApprovalRequest(method, params))
    }
  }

  async startSession(input: StartSessionInput): Promise<StartSessionResult> {
    const sessionPath = this.sessionPathFor(input.path, input.teamSize)
    const result = await this.deps.client.request<ThreadStartResult>('thread/start', {
      cwd: input.path,
      developerInstructions: input.instructions,
      threadSource: 'user',
    })
    const threadId = threadIdFrom(result)
    const session = this.deps.registry.register(sessionPath, {
      name: input.name,
      trust: input.trust,
      managed: true,
      teamIndex: this.teamIndexFromSessionPath(sessionPath),
      teamSize: input.teamSize ?? 0,
      appliedProfile: input.profileName,
      threadId,
    })
    this.threadToSessionPath.set(threadId, session.path)
    this.deps.eventLog.append(session.path, { type: 'turn', text: `thread started ${threadId}` })
    return { sessionPath: session.path, threadId }
  }

  async resumeSession(input: ResumeSessionInput): Promise<StartSessionResult> {
    if (!input.threadId) return this.startSession(input)
    const sessionPath = this.sessionPathFor(input.path, input.teamSize)
    const result = await this.deps.client.request<ThreadStartResult>('thread/resume', {
      threadId: input.threadId,
      cwd: input.path,
    })
    const threadId = threadIdFrom(result)
    const session = this.deps.registry.register(sessionPath, {
      name: input.name,
      trust: input.trust,
      managed: true,
      teamIndex: this.teamIndexFromSessionPath(sessionPath),
      teamSize: input.teamSize ?? 0,
      appliedProfile: input.profileName,
      threadId,
    })
    this.threadToSessionPath.set(threadId, session.path)
    this.deps.eventLog.append(session.path, { type: 'turn', text: `thread resumed ${threadId}` })
    return { sessionPath: session.path, threadId }
  }

  async restorePersistedSessions(): Promise<number> {
    let restored = 0
    for (const session of this.deps.registry.list()) {
      if (!session.threadId) continue
      try {
        const result = await this.deps.client.request<ThreadStartResult>('thread/resume', {
          threadId: session.threadId,
          cwd: this.deps.registry.folderPath(session.path),
        })
        const threadId = threadIdFrom(result)
        session.threadId = threadId
        session.lastTurnId = undefined
        this.threadToSessionPath.set(threadId, session.path)
        this.deps.registry.reconnect(session.path)
        this.deps.eventLog.append(session.path, { type: 'turn', text: `thread restored ${threadId}` })
        restored++
      } catch (err) {
        session.lastTurnId = undefined
        this.deps.eventLog.append(session.path, { type: 'turn', text: `thread restore failed ${err}` })
        process.stderr.write(`hub: failed to restore codex session ${session.name}: ${err}\n`)
        try {
          const result = await this.deps.client.request<ThreadStartResult>('thread/start', {
            cwd: this.deps.registry.folderPath(session.path),
            threadSource: 'user',
          })
          const threadId = threadIdFrom(result)
          session.threadId = threadId
          this.threadToSessionPath.set(threadId, session.path)
          this.deps.registry.reconnect(session.path)
          this.deps.eventLog.append(session.path, { type: 'turn', text: `thread restarted ${threadId}` })
          process.stderr.write(`hub: started fresh codex thread for ${session.name}: ${threadId}\n`)
          restored++
        } catch (freshErr) {
          this.deps.eventLog.append(session.path, { type: 'turn', text: `thread restart failed ${freshErr}` })
          process.stderr.write(`hub: failed to start fresh codex thread for ${session.name}: ${freshErr}\n`)
        }
      }
    }
    return restored
  }

  async stopSession(name: string): Promise<void> {
    const path = this.deps.registry.findByName(name)
    if (!path) return
    const session = this.deps.registry.get(path)
    if (session?.threadId) this.threadToSessionPath.delete(session.threadId)
    this.deps.registry.disconnect(path)
  }

  async removeSession(name: string): Promise<void> {
    const path = this.deps.registry.findByName(name)
    if (!path) return
    const session = this.deps.registry.get(path)
    if (session?.threadId) this.threadToSessionPath.delete(session.threadId)
    this.deps.registry.unregister(path)
  }

  async send(path: string, content: string, _meta: BackendSendMeta): Promise<boolean> {
    const session = this.deps.registry.get(path)
    if (!session?.threadId || session.status !== 'active') return false

    if (session.lastTurnId) {
      await this.deps.client.request('turn/steer', {
        threadId: session.threadId,
        expectedTurnId: session.lastTurnId,
        input: textInput(content),
      })
      this.deps.eventLog.append(path, { type: 'turn', text: `steered ${session.lastTurnId}` })
      return true
    }

    const result = await this.deps.client.request<TurnStartResult>('turn/start', {
      threadId: session.threadId,
      input: textInput(content),
    })
    session.lastTurnId = turnIdFrom(result)
    this.deps.eventLog.append(path, { type: 'turn', text: `started ${session.lastTurnId}` })
    return true
  }

  async resolveApproval(requestId: string, behavior: 'allow' | 'deny'): Promise<void> {
    this.deps.approvalBridge?.resolve(requestId, behavior)
  }

  async peek(path: string, lines: number): Promise<string> {
    return this.deps.eventLog.recentText(path, lines)
  }

  async shutdown(): Promise<void> {}

  private onAgentMessageDelta(params: any): void {
    const sessionPath = this.sessionPathForThread(params.threadId)
    if (!sessionPath) return
    const key = this.itemKey(params)
    const delta = String(params.delta ?? params.text ?? '')
    this.messageBuffers.set(key, (this.messageBuffers.get(key) ?? '') + delta)
    this.deps.eventLog.append(sessionPath, { type: 'assistant', text: delta })
  }

  private onItemCompleted(params: any): void {
    const sessionPath = this.sessionPathForThread(params.threadId)
    if (!sessionPath) return
    const key = this.itemKey(params)
    const text = String(params.text ?? params.item?.text ?? this.messageBuffers.get(key) ?? '')
    this.messageBuffers.delete(key)
    if (!text) return
    this.deps.deliver(sessionPath, text, Array.isArray(params.files) ? params.files : undefined)
  }

  private onTurnCompleted(params: any): void {
    const sessionPath = this.sessionPathForThread(params.threadId)
    if (!sessionPath) return
    const session = this.deps.registry.get(sessionPath)
    const turnId = params.turnId ?? params.turn?.id
    if (session && session.lastTurnId === turnId) {
      session.lastTurnId = undefined
    }
    this.deps.eventLog.append(sessionPath, { type: 'turn', text: String(params.status ?? params.turn?.status ?? 'completed') })
  }

  private onCommandOutput(params: any): void {
    const sessionPath = this.sessionPathForThread(params.threadId)
    if (!sessionPath) return
    this.deps.eventLog.append(sessionPath, { type: 'command', text: String(params.output ?? params.text ?? '') })
  }

  private onFileChangeOutput(params: any): void {
    const sessionPath = this.sessionPathForThread(params.threadId)
    if (!sessionPath) return
    const action = String(params.action ?? 'changed')
    const path = String(params.path ?? '')
    this.deps.eventLog.append(sessionPath, { type: 'file-change', text: `${action} ${path}`.trim() })
  }

  private async onApprovalRequest(method: string, params: any): Promise<unknown> {
    const sessionPath = this.sessionPathForThread(params.threadId)
    if (!sessionPath || !this.deps.approvalBridge) return { decision: 'denied' }
    this.deps.eventLog.append(sessionPath, { type: 'approval', text: method })
    return this.deps.approvalBridge.handleServerRequest(sessionPath, method, params)
  }

  private sessionPathForThread(threadId: unknown): string | undefined {
    if (typeof threadId !== 'string') return undefined
    return this.threadToSessionPath.get(threadId)
  }

  private itemKey(params: any): string {
    return `${params.threadId ?? ''}:${params.turnId ?? ''}:${params.itemId ?? params.item?.id ?? ''}`
  }

  private sessionPathFor(projectPath: string, teamSize?: number): string {
    const teamIndex = this.deps.registry.nextTeamIndex(projectPath)
    if ((teamSize ?? 0) > 1 || teamIndex > 0) return `${projectPath}:${teamIndex}`
    return `${projectPath}:0`
  }

  private teamIndexFromSessionPath(sessionPath: string): number {
    const idx = sessionPath.lastIndexOf(':')
    if (idx < 0) return 0
    const parsed = Number(sessionPath.slice(idx + 1))
    return Number.isFinite(parsed) ? parsed : 0
  }
}
