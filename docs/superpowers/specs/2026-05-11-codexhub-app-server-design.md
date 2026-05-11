# CodexHub App Server Port - Design

**Status:** draft approved for spec writing 2026-05-11
**Author:** Codex
**Source project:** `/home/channelhub`
**Target project:** `/home/codexhub`

## 1. Goal

Create CodexHub as a separate project derived from ChannelHub, with the same
product shape but backed by Codex instead of Claude Code. The user-facing
experience remains: one daemon controls multiple coding sessions; users can
send messages from Web, Telegram, Rubika, and CLI; sessions can request
permissions; uploads, profiles, rules, facts, verification, browser support, and
managed session lifecycle continue to work.

The core change is protocol ownership. ChannelHub currently depends on Claude's
experimental channel protocol:

- daemon sends `notifications/claude/channel`
- Claude calls `reply`, `edit_message`, `list_sessions`, and `send_to_session`
  through the shim's MCP tools
- Claude emits `notifications/claude/channel/permission_request`
- `ScreenManager` starts the Claude TUI with
  `--dangerously-load-development-channels server:hub`

CodexHub replaces that with Codex App Server:

- Hub starts or connects to `codex app-server`
- Hub creates/resumes Codex threads
- Hub starts and steers turns
- Hub consumes streaming item notifications
- Hub answers Codex approval requests through the existing permission UI

## 2. Non-goals

This is not a direct port of Claude's private channel plugin. Codex does not
expose the same channel plugin protocol, so CodexHub should not pretend that it
does.

Out of scope for the first implementation:

1. A fully native clone of Claude's experimental Agent Teams behavior.
2. TUI scraping as the main transport.
3. Depending on `codex mcp-server` as the primary backend.
4. Rewriting the Web, Telegram, Rubika, and CLI frontends from scratch.
5. Adding new visual product features while the protocol port is incomplete.

## 3. Recommended Approach

Use Codex App Server as the primary backend.

ChannelHub is built around two halves:

1. Product shell: daemon, router, registry, permissions, profiles, frontends,
   verification, browser controller, upload handling, and user-facing commands.
2. Claude transport: shim, Claude channel notification format, Claude
   permission notification format, `.claude` paths, and tmux/TUI lifecycle.

CodexHub should keep the product shell and replace the transport. The new
transport is a typed Codex session adapter that speaks App Server JSON-RPC.

### Alternatives considered

**A. Codex App Server adapter - recommended**

This is the cleanest replacement for Claude's side channel. It gives Hub a
programmatic API for thread start/resume, turn start/steer, streaming assistant
messages, command/file-change events, and approval requests.

Trade-off: it requires changing the current internal assumption that the
coding agent is a tmux process that calls Hub tools. CodexHub becomes the app
server client instead.

**B. Codex TUI/tmux bridge - fallback only**

This is closer to `ScreenManager`, but it is fragile. It depends on screen
capture, key injection, terminal rendering, and heuristics. It can remain useful
for emergency compatibility or for features App Server does not expose, but it
should not be the main architecture.

**C. Codex MCP server as primary backend - rejected**

`codex mcp-server` is useful when another MCP host wants to invoke Codex tools.
It is not the right primary control plane for multi-session streaming chat,
frontend fan-out, and permission relay. CodexHub may still expose its own MCP
server to Codex later, but that is optional, not the transport foundation.

## 4. Project Split

Create `/home/codexhub` from `/home/channelhub` after this spec is accepted.
The source repo is not modified beyond planning artifacts.

The new project keeps history only if the chosen copy method preserves it. The
implementation plan should choose between:

1. `cp -a /home/channelhub /home/codexhub` for a simple separate working copy.
2. `git worktree add /home/codexhub` if the user wants shared git history and a
   branch-based port.

Because the user asked for a separate project copied from the folder, the
default implementation should use a directory copy unless they ask for a
worktree.

## 5. Architecture

### 5.1 Main boundary

Introduce an agent-session boundary so frontends do not know whether the
session is Claude or Codex.

```
Web / Telegram / Rubika / CLI
        |
MessageRouter
        |
SessionRegistry
        |
AgentSessionAdapter
        |
CodexAppServerClient
        |
codex app-server
```

The old Claude-specific path was:

```
Frontend -> MessageRouter -> SocketServer -> shim -> Claude channel plugin
```

The Codex path becomes:

```
Frontend -> MessageRouter -> CodexSessionAdapter -> Codex App Server
```

`SocketServer` can either be removed from the main path or kept as a
compatibility wrapper during migration. The final CodexHub product should not
require a shim process inside the agent session.

### 5.2 New components

**`CodexAppServerClient`**

Owns the App Server process or connection. It supports stdio first, with Unix
socket support if local testing shows the App Server socket transport is stable
enough for this product.

Responsibilities:

- start `codex app-server --listen stdio://` or connect to a configured
  `unix://` listener
- send JSON-RPC requests
- correlate responses by id
- dispatch notifications and server requests
- expose lifecycle state and reconnect errors to the daemon

**`CodexSessionAdapter`**

Maps ChannelHub/CodexHub sessions to Codex threads and turns.

Responsibilities:

- create a thread for new sessions
- resume a thread for existing sessions
- start a turn for a new user message
- steer an active turn when App Server supports steering for the expected turn
- queue or reject messages when a turn cannot accept steering
- accumulate streaming assistant text and completed items
- emit Hub delivery events back to frontends

**`CodexApprovalBridge`**

Maps Codex approval requests into ChannelHub's existing `PermissionRequest`
model and maps frontend button decisions back to App Server approval responses.

It handles at least:

- command execution approval
- file change approval
- permission approval
- user input requests
- MCP elicitation requests, if Codex emits them during normal sessions

**`CodexThreadStore`**

Persists the relationship between Hub session keys and Codex thread ids.

Stored data:

- folder path
- session name
- thread id
- trust level
- prefix
- upload directory
- applied profile and overrides
- managed-session metadata
- last active turn id, when useful for recovery

**`AgentEventLog`**

Replaces tmux pane capture for `/peek` and debugging. It stores recent event
summaries, assistant deltas, command output deltas, file-change events, approval
requests, and turn completion state per session.

## 6. Data Flow

### 6.1 New session

```
User /spawn <path>
  -> frontend command handler
  -> daemon/session registry creates CodexHub session
  -> CodexSessionAdapter.threadStart({ cwd, instructions, model, sandbox })
  -> Codex returns threadId
  -> CodexThreadStore persists threadId and session metadata
  -> frontends receive session-created message
```

### 6.2 Send message

```
User sends text from Web, Telegram, Rubika, or CLI
  -> MessageRouter resolves target session and applies prefixes
  -> profiles.injectContext adds channel/rules/facts context
  -> CodexSessionAdapter sends:
       turn/start if no active turn
       turn/steer if an active turn can be steered
       queued message if the active turn cannot safely accept input
  -> Codex streams item notifications
  -> CodexSessionAdapter converts them into Hub outbound messages
  -> frontends fan out to users
```

### 6.3 Assistant response

```
Codex item/agentMessage/delta
  -> CodexAppServerClient dispatches notification
  -> CodexSessionAdapter buffers by threadId/turnId/itemId
  -> throttled delivery to Web/Telegram/Rubika/CLI
  -> item/completed or turn/completed flushes final text
```

The frontend delivery shape should remain compatible with the current
`deliverToUser(name, text, files)` style. Streaming can be added incrementally:
first deliver completed assistant messages, then add edit/update behavior where
frontends support it.

### 6.4 Permission request

```
Codex item/commandExecution/requestApproval
  -> CodexApprovalBridge creates PermissionRequest
  -> PermissionEngine applies trust policy
  -> if ask: Web/Telegram/Rubika render buttons
  -> user chooses Allow / Always Allow / Deny
  -> CodexApprovalBridge sends matching App Server response
```

Trust behavior:

- `strict`: deny or ask for all mutating/high-risk operations, according to
  existing ChannelHub rules.
- `ask`: show approval prompts for operations Codex asks about.
- `auto`: auto-approve low-risk operations and ask for risky ones.
- `yolo`: auto-approve within Codex policy, while preserving catastrophic
  guards where Hub already has them.

The implementation should prefer receiving approval requests and deciding in
Hub instead of disabling approvals globally. That keeps Rubika/Web/Telegram
permission prompts valuable.

## 7. Existing Feature Mapping

### 7.1 Web, Telegram, Rubika, CLI

Keep all frontends. Rubika is first-class and remains part of the product, not a
side integration. Command parity should be preserved as much as possible.

Expected unchanged command families:

- discovery: list, status, profiles, facts
- lifecycle: spawn, resume, kill/remove where meaningful, rename
- behavior: trust, prefix, rules, fact, channel, verify
- routing: select, all
- files: uploads into session project folders
- permissions: allow, always allow, deny

### 7.2 Profiles, rules, facts, and channel context

Keep the current injection model. Replace Claude-specific wording in default
channel instructions with Codex wording.

Codex thread start should use stable base/developer instructions for persistent
session behavior. Individual user messages should still receive
channel/session/facts context through the existing profile injector.

### 7.3 Prior sessions

`src/claude-sessions.ts` currently reads `~/.claude/projects/.../*.jsonl`.
CodexHub needs a Codex equivalent.

Preferred order:

1. Use App Server thread resume/list capabilities if exposed sufficiently.
2. Use persisted CodexHub `CodexThreadStore` mappings.
3. Read Codex local session files only as a compatibility fallback after
   inspecting the actual Codex CLI session format.

Do not hard-code guessed Codex session file paths without tests.

### 7.4 Verification runner

Keep it. Verification is independent of Claude/Codex. It runs project commands
from the session cwd and reports results back through frontends.

### 7.5 Browser controller

Keep it. Browser control is daemon-owned and independent of the agent backend.
Codex can receive browser facts/results through normal messages until a deeper
tool integration is designed.

### 7.6 Autopilot and `/btw`

The current autopilot design is Claude TUI-specific. It sends `/btw`, captures a
tmux pane, parses an overlay, and can veto drafts. CodexHub should redesign this
instead of porting the implementation directly.

Phase 1:

- keep the autopilot configuration commands and state
- implement veto prompts for user-originated drafts where the Hub can identify
  them
- replace `/peek` with the event log
- mark `/btw` as unavailable or route it to a lightweight side thread only if
  the semantics are clear in tests

Phase 2:

- add Codex-native autopilot using App Server threads or subagents
- design how side questions get current-session context without corrupting the
  main coding thread

### 7.7 Teams

Claude's experimental team mode does not map one-to-one to Codex. The first
CodexHub version should treat team sessions as multiple managed Codex threads
with Hub-level coordination, or temporarily disable team-specific commands with
clear messages.

Native Codex subagent/collaboration support can be added later when the App
Server event model and local CLI behavior are verified.

## 8. File-Level Change Plan

This is a design-level map, not the implementation plan.

Likely removed or replaced:

- `src/shim.ts`
- Claude channel setup in `src/screen-manager.ts`
- Claude project-history reader in `src/claude-sessions.ts`
- `.claude-plugin`
- `.mcp.json` Claude-only assumptions

Likely added:

- `src/codex/app-server-client.ts`
- `src/codex/session-adapter.ts`
- `src/codex/approval-bridge.ts`
- `src/codex/thread-store.ts`
- `src/codex/event-log.ts`
- `tests/codex/app-server-client.test.ts`
- `tests/codex/session-adapter.test.ts`
- `tests/codex/approval-bridge.test.ts`

Likely changed:

- `src/config.ts` for CodexHub paths and env vars
- `src/daemon.ts` to construct Codex adapters instead of Claude shim/socket
- `src/session-registry.ts` to store Codex thread ids
- `src/message-router.ts` only at the backend send boundary
- `src/frontends/web.ts`, `telegram.ts`, `rubika.ts`, `cli.ts` for naming and
  any backend-specific commands
- `src/profiles.ts` to replace Claude-specific channel instructions
- tests that currently assert Claude-specific socket/shim behavior

## 9. Error Handling

CodexHub should surface backend state explicitly:

- App Server unavailable: session commands fail with a clear backend-offline
  message.
- Thread start failure: session is not registered as healthy.
- Turn start failure: message is not silently dropped; the frontend receives an
  error.
- Active turn conflict: the message is queued or rejected with a clear
  explanation depending on the adapter's tested behavior.
- Lost App Server connection: sessions become degraded; reconnect attempts do
  not duplicate in-flight turns.
- Approval timeout: use the current permission timeout semantics, then answer
  Codex with decline/cancel consistently.

## 10. Testing Strategy

Use test-driven implementation for the backend port.

Required tests:

1. JSON-RPC request/response correlation in `CodexAppServerClient`.
2. Notification dispatch for assistant deltas, item completion, command output,
   file-change output, and turn completion.
3. Approval bridge mapping for command execution approval and file-change
   approval.
4. Trust-level behavior for `strict`, `ask`, `auto`, and `yolo`.
5. Session adapter new-thread and resume flows.
6. Message routing from Web/Telegram/Rubika/CLI into a Codex session adapter
   mock.
7. Rubika permission callbacks still resolve approval requests.
8. `/peek` returns recent event-log content.
9. Existing verification runner tests continue to pass.

Integration tests should use a fake App Server process/socket before hitting a
real local `codex app-server`. Real Codex CLI integration can be opt-in because
it depends on local authentication and CLI version.

## 11. Migration Order

1. Copy `/home/channelhub` to `/home/codexhub`.
2. Rename branding, env vars, data paths, and docs from ChannelHub/ClaudeHub to
   CodexHub where appropriate.
3. Add Codex App Server client tests and implementation.
4. Add Codex session adapter tests and implementation.
5. Add approval bridge tests and implementation.
6. Wire daemon/router/registry to the adapter.
7. Update frontends only where backend-specific assumptions leak.
8. Replace `/peek`, prior-session, team, and autopilot behavior with Codex-safe
   versions.
9. Run full test suite.
10. Run a local smoke test with `codex app-server`.

## 12. Open Decisions For Implementation Plan

These should be resolved during planning, not left to ad hoc coding:

1. Transport default: stdio or Unix socket. The safe default is stdio because
   the App Server help lists it as the default listener.
2. Session copy method: plain directory copy or git worktree. The default is
   directory copy because the user asked for a copied folder.
3. Streaming delivery policy: completed-message delivery first, then frontend
   edits/updates later.
4. Team command behavior in v1: disable with clear messaging or create multiple
   coordinated Codex threads.
5. `/btw` behavior in v1: unavailable with explanation or side-thread proof of
   concept.

## 13. References

Official OpenAI/Codex references checked during research:

- Codex App Server documentation:
  `https://developers.openai.com/codex/app-server`
- Codex CLI features:
  `https://developers.openai.com/codex/cli/features`
- Codex hooks:
  `https://developers.openai.com/codex/hooks`
- Codex CLI slash commands:
  `https://developers.openai.com/codex/cli/slash-commands`
- Agents SDK MCP guide:
  `https://developers.openai.com/codex/guides/agents-sdk`

Local CLI references checked:

- `codex --version` returned `codex-cli 0.130.0`
- `codex app-server --help`
- `codex app-server generate-json-schema`
- generated schemas for `ServerRequest`, `ClientRequest`,
  `ThreadStartParams`, `ThreadResumeParams`, `TurnStartParams`,
  `TurnSteerParams`, and approval request/response types
