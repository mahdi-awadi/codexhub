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
    const records = this.load()
    records[record.sessionPath] = record
    this.save(records)
  }

  remove(sessionPath: string): void {
    const records = this.load()
    delete records[sessionPath]
    this.save(records)
  }

  private save(records: Record<string, CodexThreadRecord>): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(records, null, 2) + '\n', { mode: 0o600 })
    renameSync(tmp, this.file)
  }
}
