import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AutopilotResult, RunBtwOptions } from '../autopilot'
import { hasRiskKeyword, isEscalateAnswer } from '../autopilot-risk'

export type CodexExecAutopilotOpts = {
  timeoutMs?: number
  codexBin?: string
}

export class CodexExecAutopilotRunner {
  private timeoutMs: number
  private codexBin: string

  constructor(opts: CodexExecAutopilotOpts = {}) {
    this.timeoutMs = opts.timeoutMs ?? 30_000
    this.codexBin = opts.codexBin ?? 'codex'
  }

  async run(projectPath: string, wrappedQuestion: string, opts: RunBtwOptions = {}): Promise<AutopilotResult> {
    if (!opts.riskOverride && opts.rawQuestion && opts.riskKeywords
        && hasRiskKeyword(opts.rawQuestion, opts.riskKeywords)) {
      return { status: 'escalate', reason: 'risk keyword matched in outgoing question' }
    }

    const dir = await mkdtemp(join(tmpdir(), 'codexhub-autopilot-'))
    const outputPath = join(dir, 'answer.txt')
    let timedOut = false
    let proc: ReturnType<typeof Bun.spawn> | null = null
    try {
      proc = Bun.spawn([
        this.codexBin,
        '--ask-for-approval', 'never',
        '--sandbox', 'read-only',
        'exec',
        '--cd', projectPath,
        '--skip-git-repo-check',
        '--color', 'never',
        '--output-last-message', outputPath,
        '-',
      ], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, NO_COLOR: '1' },
      })

      proc.stdin.write(wrappedQuestion)
      proc.stdin.end()

      const timer = setTimeout(() => {
        timedOut = true
        proc?.kill('SIGTERM')
      }, this.timeoutMs)

      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]).finally(() => clearTimeout(timer))

      if (timedOut) return { status: 'timeout', pane: stderr || stdout }
      if (exitCode !== 0) return { status: 'parse_error', pane: stderr || stdout }

      const answer = (await readFile(outputPath, 'utf8').catch(async () => stdout)).trim()
      if (!answer) return { status: 'parse_error', pane: stderr || stdout }

      const esc = isEscalateAnswer(answer)
      if (esc.escalated) return { status: 'escalate', reason: esc.reason ?? 'proxy escalated', pane: answer }
      return { status: 'answered', answer, pane: stderr || stdout }
    } finally {
      if (timedOut) proc?.kill('SIGKILL')
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }
}
