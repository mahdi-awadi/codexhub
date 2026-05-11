// src/codex/types.ts

export type JsonRpcId = string | number

export type CodexThreadStartParams = {
  cwd: string
  instructions?: string
  model?: string
  sandbox?: string
}

export type CodexThreadStartResult = {
  threadId: string
}

export type CodexThreadResumeParams = {
  threadId: string
  cwd?: string
}

export type CodexTurnStartParams = {
  threadId: string
  message: string
}

export type CodexTurnStartResult = {
  turnId: string
}

export type CodexTurnSteerParams = {
  threadId: string
  turnId: string
  message: string
}

export type CodexNotification = {
  method: string
  params: Record<string, unknown>
}
