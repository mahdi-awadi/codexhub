# CodexHub Agent Notes

CodexHub is a Codex-first project. Do not add legacy channel setup, old install paths, or old shim wiring.

## Runtime

- Daemon entry point: `src/daemon.ts`
- CLI entry point: `src/cli.ts`
- Default data directory: `~/.codexhub/data`
- Config file: `~/.codexhub/data/config.json`
- Telegram bot username: `mahdicodexbot`
- Rubika bot username: `mahdicodexbot`

## Commands

```bash
bun test
bun run src/daemon.ts
bun run src/cli.ts
```

Use `codexhub start`, `codexhub stop`, `codexhub status`, and `codexhub logs` for installed local runs.

## Architecture

The daemon owns session registry, routing, permissions, frontends, and persistence. Codex-specific behavior lives under `src/codex/` and is connected through backend adapters.

Frontends:

- `src/frontends/telegram.ts`
- `src/frontends/rubika.ts`
- `src/frontends/web.ts`

Core routing and state:

- `src/message-router.ts`
- `src/session-registry.ts`
- `src/permission-engine.ts`
- `src/screen-manager.ts`
- `src/config.ts`

## Development Rules

- Keep user-facing docs and installer paths on CodexHub names only.
- Keep bot identity as `mahdicodexbot` unless the user explicitly asks for another bot.
- Do not reintroduce old shim files, old channel notifications, or old command names.
- Preserve existing user changes in the worktree.
