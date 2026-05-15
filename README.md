# CodexHub

CodexHub is a multi-session hub for Codex. It lets you manage Codex sessions from Telegram, Rubika, a web dashboard, or the CLI.

This project is Codex-first. It uses Codex backend adapters and CodexHub install paths.

## Features

- Multi-session Codex management from one daemon
- Telegram bot messaging, approvals, and file upload
- Rubika bot message routing and approval buttons
- Web dashboard with Telegram login
- CLI for session management
- Permission relay from Codex approval requests to Telegram, Rubika, and web
- Session spawning and recovery through Codex backend adapters

## Prerequisites

- Bun 1.0 or newer
- tmux
- Codex CLI / Codex app server access
- git
- A Telegram bot token for `@mahdicodexbot`, if you want Telegram
- A Rubika bot token for `@mahdicodexhub`, if you want Rubika

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/mahdi-awadi/codexhub/main/install.sh | bash
```

The installer clones the repo to `~/.codexhub`, installs dependencies, creates `~/.codexhub/data/config.json`, and installs the `codexhub` command in `~/.local/bin`.

## Configure

Edit `~/.codexhub/data/config.json`:

```json
{
  "webPort": 3000,
  "telegramToken": "<telegram-token-for-mahdicodexbot>",
  "telegramBotUsername": "mahdicodexbot",
  "telegramFrontendEnabled": true,
  "telegramAllowFrom": ["<your-telegram-user-id>"],
  "rubikaToken": "<rubika-token-for-mahdicodexhub>",
  "rubikaBotUsername": "mahdicodexhub",
  "rubikaAllowFrom": ["<your-rubika-sender-id>"],
  "rubikaWebhookBase": "https://your-public-origin.example",
  "defaultTrust": "ask",
  "defaultUploadDir": "."
}
```

Empty `telegramToken` disables Telegram. Empty `rubikaToken` disables Rubika. If a token is set, the matching allowlist must contain your user or sender id.

## Run

```bash
codexhub start
codexhub status
codexhub logs
```

Open the dashboard at `http://localhost:3000`.

Start Codex from any project directory:

```bash
codex
```

## CLI

```bash
codexhub list
codexhub status
codexhub spawn <name> <path>
codexhub send <name> "message"
codexhub trust <name> auto
codexhub kill <name>
codexhub refresh-rubika
```

## Telegram Commands

| Command | Description |
| --- | --- |
| `/list` | Show sessions and pick the active session |
| `/status` | Show daemon and session status |
| `/spawn <name> <path> [team-size]` | Start a Codex session |
| `/kill <name>` | Stop a session |
| `/remove <name>` | Remove a disconnected session |
| `/team <name> [add]` | Show team status or add a teammate |
| `/trust <name> [auto\|ask]` | Toggle permission behavior |
| `/prefix <name> <text>` | Set the message prefix for a session |
| `/rename <old> <new>` | Rename a session |
| `/all <message>` | Broadcast to all sessions |
| `/verify <name>` | Run verification commands |
| `/autopilot <name> [on\|off]` | Toggle autopilot |
| `/btw <question>` | Ask a side question |

Plain messages route to your active session. `/<session-name> message` targets a specific session.

## Rubika

Rubika uses the `mahdicodexhub` bot identity. Configure `rubikaToken`, `rubikaBotUsername`, `rubikaAllowFrom`, and `rubikaWebhookBase`. The daemon registers webhook endpoints under `/api/rubika/...` when a public base URL is configured and also polls Rubika's queue with message-id dedupe so queued updates are not missed.

## Configuration

Config file: `~/.codexhub/data/config.json`

| Field | Default | Description |
| --- | --- | --- |
| `webPort` | `3000` | Web dashboard and API port |
| `webHost` | `127.0.0.1` | Web bind host |
| `telegramToken` | `""` | Telegram bot token |
| `telegramBotUsername` | `"mahdicodexbot"` | Telegram login widget bot username |
| `telegramFrontendEnabled` | `false` in new templates | Enables Telegram polling when token is present |
| `telegramAllowFrom` | `[]` | Allowed Telegram user ids |
| `rubikaToken` | `""` | Rubika bot token |
| `rubikaBotUsername` | `"mahdicodexhub"` | Rubika bot username for logs and command identity |
| `rubikaAllowFrom` | `[]` | Allowed Rubika sender ids |
| `rubikaWebhookBase` | `""` | Public HTTPS origin for Rubika webhooks |
| `rubikaApiBase` | `https://botapi.rubika.ir/v3` | Rubika API base override |
| `defaultTrust` | `"ask"` | Default permission mode |
| `defaultUploadDir` | `"."` | Upload directory relative to the project root |
| `browseRoot` | `$HOME` | Directory picker root |

## Development

```bash
bun test
bun run src/daemon.ts
bun run src/cli.ts
```

## License

[Apache-2.0](LICENSE)
