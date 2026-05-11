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

  test('keeps sessions isolated', () => {
    const log = new AgentEventLog()
    log.append('/repo:0', { type: 'assistant', text: 'repo reply' })
    log.append('/other:0', { type: 'assistant', text: 'other reply' })

    expect(log.recentText('/repo:0', 10)).toBe('[assistant] repo reply')
  })
})
