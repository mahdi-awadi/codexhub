import { describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CodexExecAutopilotRunner } from '../../src/codex/exec-autopilot'

function fakeCodex(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'codexhub-fake-codex-'))
  const bin = join(dir, 'codex')
  writeFileSync(bin, script, { mode: 0o700 })
  chmodSync(bin, 0o700)
  return bin
}

describe('CodexExecAutopilotRunner', () => {
  test('runs codex exec one-shot and reads the last-message output file', async () => {
    const bin = fakeCodex(`#!/usr/bin/env bash
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output-last-message" ]; then out="$2"; shift 2; continue; fi
  shift
done
cat > /dev/null
printf 'Use Bun.\\n' > "$out"
`)
    const runner = new CodexExecAutopilotRunner({ codexBin: bin, timeoutMs: 1000 })
    const result = await runner.run('/tmp', 'Pick Bun or Node?')
    expect(result.status).toBe('answered')
    if (result.status === 'answered') expect(result.answer).toBe('Use Bun.')
  })

  test('skips codex exec when risk keywords match', async () => {
    const bin = fakeCodex(`#!/usr/bin/env bash
exit 42
`)
    const runner = new CodexExecAutopilotRunner({ codexBin: bin, timeoutMs: 1000 })
    const result = await runner.run('/tmp', 'wrapped', {
      rawQuestion: 'Should I force push this?',
      riskKeywords: ['force push'],
    })
    expect(result.status).toBe('escalate')
  })
})
