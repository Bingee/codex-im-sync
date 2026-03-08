# Usage Guide

This skill is designed primarily for **Codex**, using prompts like `start bridge`, `配置`, and `诊断`. Slash-command style examples are shown only as a concise command notation.

## setup

Interactive wizard that configures the bridge.

```
/codex-im-sync setup
```

The wizard will prompt you for:

1. **Channels to enable** -- Enter comma-separated values: `telegram`, `discord`, `feishu`
2. **Platform credentials** -- Bot tokens, app IDs, and secrets for each enabled channel
3. **Allowed users** (optional) -- Restrict which users can interact with the bot
4. **Working directory** -- Default project directory for Codex sessions
5. **Model and mode** -- Codex model override and interaction mode (`code` / `plan` / `ask`)

After collecting input, the wizard validates tokens by calling each platform's API and reports results.

Example interaction:

```
> /codex-im-sync setup
Which channels to enable? telegram,discord
Enter Telegram bot token: <your-token>
Enter Discord bot token: <your-token>
Default working directory [/current/dir]: /Users/me/projects
Model [leave blank to use Codex default]:
Mode [code]:

Validating tokens...
  Telegram: OK (bot @MyBotName)
  Discord: OK (format valid)

Config written to ~/.codex-im-sync/config.env
```

## start

Starts the bridge daemon in the background.

```
/codex-im-sync start
```

The daemon process ID is stored in `~/.codex-im-sync/runtime/bridge.pid`. If the daemon is already running, the command reports the existing process.

If startup fails, run `/codex-im-sync doctor` to diagnose issues.

## stop

Stops the running bridge daemon.

```
/codex-im-sync stop
```

Sends SIGTERM to the daemon process and cleans up the PID file.

## status

Shows whether the daemon is running and basic health information.

```
/codex-im-sync status
```

Output includes:
- Running/stopped state
- PID (if running)
- Uptime
- Connected channels

## logs

Shows recent log output from the daemon.

```
/codex-im-sync logs        # Last 50 lines (default)
/codex-im-sync logs 200    # Last 200 lines
```

Logs are stored in `~/.codex-im-sync/logs/` and are automatically redacted to mask secrets.

## reconfigure

Interactively update the current configuration.

```
/codex-im-sync reconfigure
```

Displays current settings with secrets masked, then prompts for changes. After updating, you must restart the daemon for changes to take effect:

```
/codex-im-sync stop
/codex-im-sync start
```

## doctor

Runs diagnostic checks and reports issues.

```
/codex-im-sync doctor
```

Checks performed:
- Node.js version (>= 20 required)
- Codex CLI availability and auth state
- Config file exists and has correct permissions
- Required tokens are set for enabled channels
- Token validity (API calls)
- Daemon process health
- Log directory writability
