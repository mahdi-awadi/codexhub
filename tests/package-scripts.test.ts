import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const pkg = JSON.parse(readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
  bin: Record<string, string>
}
const readRoot = (path: string) => readFileSync(join(import.meta.dir, '..', path), 'utf8')

describe('package commands', () => {
  test('do not expose the legacy shim or non-Codex launch path', () => {
    expect(pkg.scripts.start).toBe('bun run src/daemon.ts')
    expect(pkg.scripts.shim).toBeUndefined()
    expect(pkg.scripts.build).not.toContain('src/shim.ts')
    expect(pkg.bin['hub-shim']).toBeUndefined()

    const commandSurface = [
      ...Object.values(pkg.scripts),
      ...Object.values(pkg.bin),
    ].join('\n')
    expect(commandSurface).not.toMatch(/\bclaude\b|src\/shim\.ts/)
  })

  test('public install surface is CodexHub only', () => {
    const surface = [
      readRoot('README.md'),
      readRoot('install.sh'),
      readRoot('config.example.json'),
    ].join('\n')

    expect(surface).toContain('mahdi-awadi/codexhub')
    expect(surface).toContain('"telegramBotUsername": "mahdicodexbot"')
    expect(surface).toContain('"rubikaBotUsername": "mahdicodexhub"')
    expect(surface).not.toMatch(/channelhub|ChannelHub|~\/\.claude|claude code|Claude Code|src\/shim\.ts/)
  })
})
