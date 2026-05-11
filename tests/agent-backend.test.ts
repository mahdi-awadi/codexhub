// tests/agent-backend.test.ts
import { describe, expect, test } from 'bun:test'
import { BACKEND_UNAVAILABLE_MESSAGE, type AgentSessionBackend } from '../src/agent-backend'

describe('AgentSessionBackend contract', () => {
  test('exposes a shared unavailable message for frontends', () => {
    expect(BACKEND_UNAVAILABLE_MESSAGE).toBe('Codex backend is unavailable')
  })

  test('mock backend accepts lifecycle and approval calls used by frontends', async () => {
    const calls: string[] = []
    const backend: AgentSessionBackend = {
      async startSession(input) {
        calls.push(`start:${input.name}:${input.path}`)
        return { sessionPath: `${input.path}:0`, threadId: 'thread_1' }
      },
      async resumeSession(input) {
        calls.push(`resume:${input.name}:${input.threadId ?? 'latest'}`)
        return { sessionPath: `${input.path}:0`, threadId: input.threadId ?? 'thread_latest' }
      },
      async stopSession(name) {
        calls.push(`stop:${name}`)
      },
      async removeSession(name) {
        calls.push(`remove:${name}`)
      },
      async send(path, content, meta) {
        calls.push(`send:${path}:${meta.frontend}:${content}`)
        return true
      },
      async resolveApproval(requestId, behavior) {
        calls.push(`approval:${requestId}:${behavior}`)
      },
      async peek(path, lines) {
        calls.push(`peek:${path}:${lines}`)
        return 'recent events'
      },
      async shutdown() {
        calls.push('shutdown')
      },
    }

    await backend.startSession({ name: 'sap', path: '/work/sap', instructions: 'hello' })
    await backend.resumeSession({ name: 'sap', path: '/work/sap', threadId: 'thread_9' })
    await backend.send('/work/sap:0', 'fix', {
      source: 'hub',
      frontend: 'rubika',
      user: 'u1',
      session: 'sap',
    })
    await backend.resolveApproval('req_1', 'allow')

    expect(await backend.peek('/work/sap:0', 20)).toBe('recent events')
    expect(calls).toContain('send:/work/sap:0:rubika:fix')
  })
})
