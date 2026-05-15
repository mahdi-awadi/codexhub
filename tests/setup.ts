import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Redirect state writes (sessions.json, config.json) away from the user's real
// CodexHub data directory so a test run can never clobber a running daemon.
// HUB_DIR is captured at config.ts module load, so this must run first via preload.
if (!process.env.HUB_DIR && !process.env.CODEXHUB_DATA) {
  process.env.HUB_DIR = mkdtempSync(join(tmpdir(), 'hub-test-'))
}
