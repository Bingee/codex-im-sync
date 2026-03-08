# Codex IM Sync Skill

Bridge Telegram, Discord, or Feishu/Lark to local Codex sessions.

[中文文档](README_CN.md)

> **Want a desktop GUI instead?** Check out [CodePilot](https://github.com/op7418/CodePilot) — a full-featured desktop app with visual chat interface, session management, file tree preview, permission controls, and more. This skill was extracted from CodePilot's IM bridge module for users who prefer a lightweight, CLI-only setup.

## Upstream and This Fork

This repository is based on [op7418/Claude-to-IM-skill](https://github.com/op7418/Claude-to-IM-skill), then adapted into a Codex-first skill for local IM-to-Codex workflows.

Main changes in this fork:

- **Local Codex thread reuse** — use local `codex exec` / `codex exec resume` so one IM chat can continue the same Codex thread you use on your machine
- **Feishu local thread index** — scan `~/.codex/sessions` and expose recent local threads in chat
- **Simpler Feishu switching** — support `/use <index|thread_id|project_name>` plus `cti_use_1` style menu shortcuts
- **Feishu menu compatibility fallback** — accept plain-text `cti_*` payloads when Feishu menus are configured to send text instead of stable event callbacks
- **Codex-first docs and config** — runtime defaults, examples, and setup flow now center on Codex instead of Claude
- **Cleaner thread list output** — compact numbered thread summaries instead of long verbose status blocks

---

## How It Works

This skill runs a background daemon that connects your IM bots to local Codex sessions. Messages from IM are forwarded to Codex, and responses (including tool use, permission requests, and streaming previews) are sent back to chat. The key behavior is that `CTI_RUNTIME=codex` reuses local Codex sessions via `codex exec` / `codex exec resume`, so one IM chat can keep following the same Codex thread you continue on your machine.

```
You (Telegram/Discord/Feishu)
  ↕ Bot API
Background Daemon (Node.js)
  ↕ local Codex CLI
Codex → reads/writes your codebase
```

## Features

- **Three IM platforms** — Telegram, Discord, Feishu/Lark, enable any combination
- **Interactive setup** — guided wizard collects tokens with step-by-step instructions
- **Permission control** — chat-side approval flow for bridge-managed tools
- **Streaming preview** — see Claude's response as it types (Telegram & Discord)
- **Session persistence** — conversations survive daemon restarts
- **Secret protection** — tokens stored with `chmod 600`, auto-redacted in all logs
- **Zero code required** — install the skill and run `/codex-im-sync setup`, that's it

## Prerequisites

- **Node.js >= 20**
- **Codex CLI** — `npm install -g @openai/codex`
- **Codex auth** — run `codex auth login`, or set `OPENAI_API_KEY`

Claude compatibility:
`CTI_RUNTIME=claude` and `CTI_RUNTIME=auto` still exist, but this fork is designed and documented around the Codex path.

## Installation

### Local fork

This repository is intended to be installed from your local checkout or your own fork.

### Symlink

If you prefer to keep the repo elsewhere (e.g., for development):

```bash
git clone <your-fork-url> ~/code/codex-im-sync
mkdir -p ~/.claude/skills
ln -s ~/code/codex-im-sync ~/.claude/skills/codex-im-sync
```

### Codex

If you use [Codex](https://github.com/openai/codex), clone directly into the Codex skills directory:

```bash
bash ~/code/codex-im-sync/scripts/install-codex.sh

# Or use symlink mode for development
bash ~/code/codex-im-sync/scripts/install-codex.sh --link
```

### Verify installation

Start a new Codex session and say `codex-im-sync setup` or `start bridge`. Codex should recognize the skill and run the setup flow.

## Quick Start

### 1. Setup

```
/codex-im-sync setup
```

The wizard will guide you through:

1. **Choose channels** — pick Telegram, Discord, Feishu, or any combination
2. **Enter credentials** — the wizard explains exactly where to get each token, which settings to enable, and what permissions to grant
3. **Set defaults** — working directory, model, and mode
4. **Validate** — tokens are verified against platform APIs immediately

### 2. Start

```
/codex-im-sync start
```

The daemon starts in the background. You can close the terminal — it keeps running.

### 3. Chat

Open your IM app and send a message to your bot. Codex will respond.

If the bridge-managed path needs approval, you'll see **Allow** / **Deny** prompts in chat. For local Codex execution policy, use `CTI_CODEX_APPROVAL_POLICY`, `CTI_CODEX_FULL_AUTO`, or `CTI_CODEX_DANGEROUS_BYPASS` as needed.

## Commands

Common Codex prompts:

| Prompt | Description |
|---|---|
| `codex-im-sync setup` / `配置` | Interactive setup wizard |
| `start bridge` / `启动桥接` | Start the bridge daemon |
| `stop bridge` / `停止桥接` | Stop the bridge daemon |
| `bridge status` / `状态` | Show daemon status |
| `查看日志` / `logs 200` | Show recent log lines |
| `reconfigure` / `修改配置` | Update config interactively |
| `doctor` / `诊断` | Diagnose issues |

## Platform Setup Guides

The `setup` wizard provides inline guidance for every step. Here's a summary:

### Telegram

1. Message `@BotFather` on Telegram → `/newbot` → follow prompts
2. Copy the bot token (format: `123456789:AABbCc...`)
3. Recommended: `/setprivacy` → Disable (for group use)
4. Find your User ID: message `@userinfobot`

### Discord

1. Go to [Discord Developer Portal](https://discord.com/developers/applications) → New Application
2. Bot tab → Reset Token → copy it
3. Enable **Message Content Intent** under Privileged Gateway Intents
4. OAuth2 → URL Generator → scope `bot` → permissions: Send Messages, Read Message History, View Channels → copy invite URL

### Feishu / Lark

1. Go to [Feishu Open Platform](https://open.feishu.cn/app) (or [Lark](https://open.larksuite.com/app))
2. Create Custom App → get App ID and App Secret
3. **Batch-add permissions**: go to "Permissions & Scopes" → use batch configuration to add all required scopes (the `setup` wizard provides the exact JSON)
4. Enable Bot feature under "Add Features"
5. **Events & Callbacks**: select **"Long Connection"** as event dispatch method → add `im.message.receive_v1`, `im.chat.access_event.bot_p2p_chat_entered_v1`, and `application.bot.menu_v6`
   Add callback `card.action.trigger` only if you later use Feishu template-card interactions.
6. **Publish**: go to "Version Management & Release" → create version → submit for review → approve in Admin Console
7. **Important**: The bot will NOT work until the version is approved and published
8. **Bot menu**: configure event-type menu items with these keys:
   `cti_threads`, `cti_threads_refresh`, `cti_new_session`, `cti_status`
   For one-tap recent-thread switching, also add:
   `cti_use_1`, `cti_use_2`, `cti_use_3`, `cti_use_4`, `cti_use_5`

### Thread commands inside Feishu chats

- `/threads`: list recent local Codex threads
- `/refreshthreads`: force a rescan of local Codex history
- `/use <index|thread_id|project_name>`: switch the current IM chat to a local Codex thread

Notes:
- `/threads` numbers the recent thread list, so `/use 1` is usually enough
- Feishu menu keys `cti_use_1` through `cti_use_5` map to `/use 1` through `/use 5`
- Feishu `schema 2.0` raw cards no longer support the legacy `action` tag, so thread switching does not rely on card buttons

## Architecture

```
~/.codex-im-sync/
├── config.env             ← Credentials & settings (chmod 600)
├── data/                  ← Persistent JSON storage
│   ├── sessions.json
│   ├── bindings.json
│   ├── permissions.json
│   └── messages/          ← Per-session message history
├── logs/
│   └── bridge.log         ← Auto-rotated, secrets redacted
└── runtime/
    ├── bridge.pid          ← Daemon PID file
    └── status.json         ← Current status
```

### Key components

| Component | Role |
|---|---|
| `src/main.ts` | Daemon entry — assembles DI, starts bridge |
| `src/config.ts` | Load/save `config.env`, map to bridge settings |
| `src/store.ts` | JSON file BridgeStore (30 methods, write-through cache) |
| `src/llm-provider.ts` | Optional Claude-compatible provider kept for fallback runtime |
| `src/codex-provider.ts` | Local `codex exec` / `codex exec resume` JSONL → SSE stream |
| `src/sse-utils.ts` | Shared SSE formatting helper |
| `src/permission-gateway.ts` | Async bridge: SDK `canUseTool` ↔ IM buttons |
| `src/logger.ts` | Secret-redacted file logging with rotation |
| `scripts/daemon.sh` | Process management (start/stop/status/logs) |
| `scripts/doctor.sh` | Health checks |
| `SKILL.md` | Skill definition and command workflow |

### Permission flow

```
1. A bridge-managed runtime wants to use a tool (for example, edit a file)
2. The provider emits a `permission_request` SSE event
3. Bridge sends inline buttons to IM chat: [Allow] [Deny]
4. The pending request waits for user response (5 min timeout)
5. User taps Allow → bridge resolves the pending permission
6. Execution continues → result streamed back to IM
```

## Troubleshooting

Run diagnostics:

```
/codex-im-sync doctor
```

This checks: Node.js version, config file existence and permissions, token validity (live API calls), log directory, PID file consistency, and recent errors.

| Issue | Solution |
|---|---|
| `Bridge won't start` | Run `doctor`. Check if Node >= 20. Check logs. |
| `Messages not received` | Verify token with `doctor`. Check allowed users config. |
| `Permission timeout` | User didn't respond within 5 min. Tool call auto-denied. |
| `Stale PID file` | Run `stop` then `start`. daemon.sh auto-cleans stale PIDs. |

See [references/troubleshooting.md](references/troubleshooting.md) for more details.

## Security

- All credentials stored in `~/.codex-im-sync/config.env` with `chmod 600`
- Tokens are automatically redacted in all log output (pattern-based masking)
- Allowed user/channel/guild lists restrict who can interact with the bot
- The daemon is a local process with no inbound network listeners
- See [SECURITY.md](SECURITY.md) for threat model and incident response

## Development

```bash
npm install        # Install dependencies
npm run dev        # Run in dev mode
npm run typecheck  # Type check
npm test           # Run tests
npm run build      # Build bundle
```

## Minimal Publish Checklist

Keep these in the GitHub repo:

- `SKILL.md`
- `agents/openai.yaml`
- `README.md`
- `README_CN.md`
- `LICENSE`
- `config.env.example`
- `src/`
- `scripts/`
- `references/`
- `package.json`
- `package-lock.json`

Do not publish these:

- `.git/`
- `node_modules/`
- `~/.codex-im-sync/` runtime data
- local `config.env`

Optional:

- `dist/` — keep it if you want a prebuilt bundle in the repo; omit it if you prefer source-only publishing

## License

[MIT](LICENSE)
