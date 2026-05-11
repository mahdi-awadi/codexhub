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
    const events = this.bySession.get(sessionPath) ?? []
    events.push({ ...event, ts: event.ts ?? Date.now() })
    while (events.length > this.maxEntriesPerSession) {
      events.shift()
    }
    this.bySession.set(sessionPath, events)
  }

  recent(sessionPath: string, count: number): AgentEvent[] {
    const safeCount = Math.max(1, Math.min(Math.floor(count), this.maxEntriesPerSession))
    return (this.bySession.get(sessionPath) ?? []).slice(-safeCount)
  }

  recentText(sessionPath: string, count: number): string {
    return this.recent(sessionPath, count)
      .map((event) => `[${event.type}] ${event.text}`)
      .join('\n')
  }
}
