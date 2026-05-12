# CodexHub Resume Prompt

Paste this in a new Codex session from `/home/codexhub`:

```text
We are in /home/codexhub on branch codexhub/app-server-port.

Context:
- This is a fork of /home/channelhub at commit 52903dd.
- Baseline is clean and verified: bun test -> 674 pass, 1 skip, 0 fail.
- Read these first:
  - CLAUDE.md
  - README.md
  - docs/superpowers/specs/2026-05-11-codexhub-app-server-design.md
  - package.json
  - src/shim.ts
  - src/screen-manager.ts
  - src/daemon.ts
  - src/session-registry.ts
  - src/message-router.ts
  - src/types.ts
  - src/config.ts
  - src/profiles.ts
  - src/permission-engine.ts
  - src/frontends/rubika.ts
  - src/frontends/telegram.ts
  - src/frontends/web.ts
  - src/cli.ts

Goal:
Build CodexHub as the same product shape as ChannelHub, but backed by Codex App Server instead of Claude Code’s experimental channel protocol. Keep Web, Telegram, Rubika, CLI, profiles, rules/facts, uploads, permissions, verification, and browser controller. Rubika is first-class.

Important architecture decision:
Use Codex App Server as the primary backend, not Codex TUI scraping and not codex mcp-server as the main transport.

Implementation approach:
1. Use Superpowers skills:
   - superpowers:writing-plans first if no implementation plan exists.
   - superpowers:test-driven-development before feature code.
   - superpowers:verification-before-completion before claiming done.
2. Create a detailed plan at:
   docs/superpowers/plans/2026-05-11-codexhub-app-server-port.md
3. Then implement task by task with tests and commits.

Core replacement:
- Remove/replace Claude-specific transport:
  - src/shim.ts
  - Claude channel notification protocol
  - SocketServer -> shim as the main path
  - ScreenManager Claude launch path for primary session backend
  - ~/.claude/channels/hub paths
  - claude-sessions history reader as primary prior-session source
- Add Codex backend:
  - src/codex/app-server-client.ts
  - src/codex/session-adapter.ts
  - src/codex/approval-bridge.ts
  - src/codex/thread-store.ts
  - src/codex/event-log.ts

Codex App Server mapping:
- Hub -> Codex:
  - thread/start
  - thread/resume
  - turn/start
  - turn/steer
- Codex -> Hub:
  - item/agentMessage/delta
  - item/completed
  - turn/completed
  - command/file-change output notifications
- Codex approval requests -> Hub permission UI:
  - item/commandExecution/requestApproval
  - item/fileChange/requestApproval
  - item/permissions/requestApproval
  - item/tool/requestUserInput if emitted
  - mcpServer/elicitation/request if emitted

Testing requirements:
- Start with failing tests.
- Test JSON-RPC request/response correlation.
- Test App Server notification dispatch.
- Test approval bridge mappings.
- Test trust levels strict/ask/auto/yolo.
- Test session adapter thread start/resume and turn start/steer behavior.
- Test Web/Telegram/Rubika/CLI route into mocked Codex adapter.
- Test Rubika permission callbacks still resolve approval requests.
- Test /peek uses event log instead of tmux capture.
- Keep existing verification runner tests passing.
- Run bun test before completion.

Constraints:
- Do not regress Rubika. It is part of the product.
- Prefer completed-message delivery first; streaming edits can come later.
- Treat teams and /btw autopilot as Codex redesign items:
  - v1 may disable team-specific behavior with clear user-facing messages or map teams to multiple managed Codex threads.
  - v1 may make /btw unavailable or implement a tested side-thread proof of concept only if semantics are clear.
- Preserve clean commits.
- Do not touch /home/channelhub; all implementation happens in /home/codexhub.

First action:
Write the implementation plan from the design spec, save it under docs/superpowers/plans, self-review it for gaps/placeholders, then begin TDD implementation only after the plan is ready.
```
