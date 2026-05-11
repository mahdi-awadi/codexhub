// src/codex/session-adapter.ts
import type { AgentSessionBackend, BackendSendMeta, ResumeSessionInput, StartSessionInput, StartSessionResult } from '../agent-backend'
import type { SessionRegistry } from '../session-registry'
import type { CodexApprovalBridge } from './approval-bridge'
import type { AgentEventLog } from './event-log'

type CodexClient = {
  request<T = unknown>(method: string, params: unknown): Promise<T>
  onNotification(method: string, cb: (params: any) => void): void
}

type SessionAdapterDeps = {
  client: CodexClient
  registry: SessionRegistry
  eventLog: AgentEventLog
  approvalBridge?: CodexApprovalBridge
  deliver(path: string, text: string, files?: string[]): void
}

type ThreadStartResult = {
  threadId: string
}

type TurnStartResult = {
  turnId: string
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
  }

  async startSession(input: StartSessionInput): Promise<StartSessionResult> {
    const sessionPath = this.sessionPathFor(input.path, input.teamSize)
    const result = await this.deps.client.request<ThreadStartResult>('thread/start', {
      cwd: input.path,
      instructions: input.instructions,
    })
    const session = this.deps.registry.register(sessionPath, {
      name: input.name,
      trust: input.trust,
      managed: true,
      teamIndex: this.teamIndexFromSessionPath(sessionPath),
      teamSize: input.teamSize ?? 0,
      appliedProfile: input.profileName,
      threadId: result.threadId,
    })
    this.threadToSessionPath.set(result.threadId, session.path)
    this.deps.eventLog.append(session.path, { type: 'turn', text: `thread started ${result.threadId}` })
    return { sessionPath: session.path, threadId: result.threadId }
  }

  async resumeSession(input: ResumeSessionInput): Promise<StartSessionResult> {
    if (!input.threadId) return this.startSession(input)
    const sessionPath = this.sessionPathFor(input.path, input.teamSize)
    const result = await this.deps.client.request<ThreadStartResult>('thread/resume', {
      threadId: input.threadId,
      cwd: input.path,
    })
    const session = this.deps.registry.register(sessionPath, {
      name: input.name,
      trust: input.trust,
      managed: true,
      teamIndex: this.teamIndexFromSessionPath(sessionPath),
      teamSize: input.teamSize ?? 0,
      appliedProfile: input.profileName,
      threadId: result.threadId,
    })
    this.threadToSessionPath.set(result.threadId, session.path)
    this.deps.eventLog.append(session.path, { type: 'turn', text: `thread resumed ${result.threadId}` })
    return { sessionPath: session.path, threadId: result.threadId }
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
        turnId: session.lastTurnId,
        message: content,
      })
      this.deps.eventLog.append(path, { type: 'turn', text: `steered ${session.lastTurnId}` })
      return true
    }

    const result = await this.deps.client.request<TurnStartResult>('turn/start', {
      threadId: session.threadId,
      message: content,
    })
    session.lastTurnId = result.turnId
    this.deps.eventLog.append(path, { type: 'turn', text: `started ${result.turnId}` })
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
    const text = String(params.text ?? this.messageBuffers.get(key) ?? '')
    this.messageBuffers.delete(key)
    if (!text) return
    this.deps.deliver(sessionPath, text, Array.isArray(params.files) ? params.files : undefined)
  }

  private onTurnCompleted(params: any): void {
    const sessionPath = this.sessionPathForThread(params.threadId)
    if (!sessionPath) return
    const session = this.deps.registry.get(sessionPath)
    if (session && session.lastTurnId === params.turnId) {
      session.lastTurnId = undefined
    }
    this.deps.eventLog.append(sessionPath, { type: 'turn', text: String(params.status ?? 'completed') })
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

  private sessionPathForThread(threadId: unknown): string | undefined {
    if (typeof threadId !== 'string') return undefined
    return this.threadToSessionPath.get(threadId)
  }

  private itemKey(params: any): string {
    return `${params.threadId ?? ''}:${params.turnId ?? ''}:${params.itemId ?? ''}`
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
