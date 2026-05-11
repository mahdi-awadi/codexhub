// tests/codex/approval-bridge.test.ts
import { describe, expect, test } from 'bun:test'
import { CodexApprovalBridge } from '../../src/codex/approval-bridge'
import { PermissionEngine } from '../../src/permission-engine'
import { SessionRegistry } from '../../src/session-registry'

describe('CodexApprovalBridge', () => {
  test('auto-approved command returns approved response to Codex', async () => {
    const registry = new SessionRegistry({ defaultTrust: 'auto', defaultUploadDir: '.' })
    registry.register('/repo:0', { name: 'repo' })
    const permissions = new PermissionEngine(registry, () => {})
    const bridge = new CodexApprovalBridge({ registry, permissions })

    await expect(bridge.handleServerRequest('/repo:0', 'item/commandExecution/requestApproval', {
      requestId: 'codex_req_1',
      command: 'ls',
      cwd: '/repo',
    })).resolves.toEqual({ decision: 'approved' })
  })

  test('escalated file change waits for frontend resolution', async () => {
    const registry = new SessionRegistry({ defaultTrust: 'strict', defaultUploadDir: '.' })
    registry.register('/repo:0', { name: 'repo' })
    const forwarded: string[] = []
    const permissions = new PermissionEngine(registry, (req) => forwarded.push(req.requestId))
    const bridge = new CodexApprovalBridge({ registry, permissions })

    const pending = bridge.handleServerRequest('/repo:0', 'item/fileChange/requestApproval', {
      requestId: 'codex_req_2',
      path: '/repo/src/a.ts',
      action: 'write',
    })

    expect(forwarded).toEqual(['codex_req_2'])
    expect(bridge.resolve('codex_req_2', 'deny')).toBe(true)
    await expect(pending).resolves.toEqual({ decision: 'denied' })
  })

  test('unknown approval methods are forwarded as CodexApproval review requests', async () => {
    const registry = new SessionRegistry({ defaultTrust: 'ask', defaultUploadDir: '.' })
    registry.register('/repo:0', { name: 'repo' })
    const forwarded: Array<{ toolName: string; inputPreview: string }> = []
    const permissions = new PermissionEngine(registry, (req) => {
      forwarded.push({ toolName: req.toolName, inputPreview: req.inputPreview })
    })
    const bridge = new CodexApprovalBridge({ registry, permissions })

    const pending = bridge.handleServerRequest('/repo:0', 'mcpServer/elicitation/request', {
      requestId: 'codex_req_3',
      prompt: 'Need input',
    })

    expect(forwarded[0]?.toolName).toBe('CodexApproval')
    expect(forwarded[0]?.inputPreview).toContain('Need input')
    bridge.resolve('codex_req_3', 'allow')
    await expect(pending).resolves.toEqual({ decision: 'approved' })
  })
})
