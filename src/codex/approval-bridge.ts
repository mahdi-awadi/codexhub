// src/codex/approval-bridge.ts
import type { PermissionEngine } from '../permission-engine'
import type { SessionRegistry } from '../session-registry'

export type CodexApprovalDecision = {
  decision: 'approved' | 'denied'
}

type PermissionInput = {
  requestId: string
  toolName: string
  description: string
  inputPreview: string
  toolArgs?: Record<string, unknown>
}

export class CodexApprovalBridge {
  private pending = new Map<string, (value: CodexApprovalDecision) => void>()

  constructor(private deps: {
    registry: SessionRegistry
    permissions: PermissionEngine
  }) {}

  async handleServerRequest(
    sessionPath: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<CodexApprovalDecision> {
    const input = this.mapRequest(method, params)
    const immediate = this.deps.permissions.handle(sessionPath, input)
    if (immediate) {
      return { decision: immediate.behavior === 'allow' ? 'approved' : 'denied' }
    }

    return new Promise<CodexApprovalDecision>((resolve) => {
      this.pending.set(input.requestId, resolve)
    })
  }

  resolve(requestId: string, behavior: 'allow' | 'deny'): boolean {
    const resolve = this.pending.get(requestId)
    if (!resolve) return false
    this.pending.delete(requestId)
    resolve({ decision: behavior === 'allow' ? 'approved' : 'denied' })
    return true
  }

  private mapRequest(method: string, params: Record<string, unknown>): PermissionInput {
    const requestId = String(params.requestId ?? params.id ?? `${method}:${Date.now()}`)
    if (method === 'item/commandExecution/requestApproval') {
      const command = String(params.command ?? '')
      const cwd = typeof params.cwd === 'string' ? ` in ${params.cwd}` : ''
      return {
        requestId,
        toolName: 'Bash',
        description: `Run command${cwd}: ${command}`,
        inputPreview: command,
        toolArgs: { command },
      }
    }

    if (method === 'item/fileChange/requestApproval') {
      const path = String(params.path ?? params.filePath ?? '')
      const action = String(params.action ?? 'change')
      return {
        requestId,
        toolName: action === 'delete' ? 'Delete' : 'Write',
        description: `${action} ${path}`.trim(),
        inputPreview: path,
        toolArgs: { file_path: path },
      }
    }

    if (method === 'item/permissions/requestApproval') {
      return {
        requestId,
        toolName: 'CodexPermissions',
        description: 'Codex requested permission policy approval',
        inputPreview: JSON.stringify(params),
        toolArgs: params,
      }
    }

    if (method === 'item/tool/requestUserInput' || method === 'mcpServer/elicitation/request') {
      return {
        requestId,
        toolName: 'CodexApproval',
        description: 'Codex requested user input',
        inputPreview: JSON.stringify(params),
        toolArgs: params,
      }
    }

    return {
      requestId,
      toolName: 'CodexApproval',
      description: method,
      inputPreview: JSON.stringify(params),
      toolArgs: params,
    }
  }
}
