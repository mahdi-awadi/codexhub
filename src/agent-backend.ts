// src/agent-backend.ts
import type { FrontendSource, TrustLevel } from './types'

export const BACKEND_UNAVAILABLE_MESSAGE = 'Codex backend is unavailable'

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
  trust?: TrustLevel
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
