// tests/codex/thread-store.test.ts
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { CodexThreadStore } from '../../src/codex/thread-store'

describe('CodexThreadStore', () => {
  test('saves and loads session thread records', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codexhub-thread-store-'))
    try {
      const store = new CodexThreadStore(dir)
      store.upsert({
        sessionPath: '/repo:0',
        sessionName: 'repo',
        folderPath: '/repo',
        threadId: 'thread_1',
        trust: 'ask',
        prefix: '',
        uploadDir: '.',
        managed: true,
        teamIndex: 0,
        teamSize: 0,
      })

      expect(new CodexThreadStore(dir).get('/repo:0')?.threadId).toBe('thread_1')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('removes a stored session thread record', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codexhub-thread-store-'))
    try {
      const store = new CodexThreadStore(dir)
      store.upsert({
        sessionPath: '/repo:0',
        sessionName: 'repo',
        folderPath: '/repo',
        threadId: 'thread_1',
        trust: 'ask',
        prefix: '',
        uploadDir: '.',
        managed: false,
        teamIndex: 0,
        teamSize: 0,
      })

      store.remove('/repo:0')

      expect(store.get('/repo:0')).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
