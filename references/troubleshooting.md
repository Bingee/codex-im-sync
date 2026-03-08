# Troubleshooting

## Bridge won't start

**Symptoms**: `/codex-im-sync start` fails or daemon exits immediately.

**Steps**:

1. Run `/codex-im-sync doctor` to identify the issue
2. Check that Node.js >= 20 is installed: `node --version`
3. Check that Codex CLI is available: `codex --version`
4. Verify config exists: `ls -la ~/.codex-im-sync/config.env`
5. Check logs for startup errors: `/codex-im-sync logs`

**Common causes**:
- Missing or invalid config.env -- run `/codex-im-sync setup`
- Node.js not found or wrong version -- install Node.js >= 20
- Codex CLI not found or not logged in -- run `codex --version` and `codex auth login`
- Another instance is already running -- check with `/codex-im-sync status`

## Messages not received

**Symptoms**: Bot is online but doesn't respond to messages.

**Steps**:

1. Verify the bot token is valid: `/codex-im-sync doctor`
2. Check allowed user IDs in config -- if set, only listed users can interact
3. For Telegram: ensure you've sent `/start` to the bot first
4. For Discord: verify the bot has been invited to the server with message read permissions
5. For Feishu: confirm the app has been approved and event subscriptions are configured
6. Check logs for incoming message events: `/codex-im-sync logs 200`

## Feishu thread switch card cannot be clicked

**Symptoms**: A Feishu thread card shows content, but button-style switching fails or the platform returns an error such as `230099` or `200340`.

**Cause**:

- Feishu `schema 2.0` raw cards no longer support the legacy `action` tag
- `codex-im-sync` therefore uses menu shortcuts plus `/use <index|thread_id|project_name>` for thread switching

**Steps**:

1. Use `/threads` to view the latest numbered thread list
2. Switch with `/use 1` or `/use babynight`
3. Configure bot menu keys `cti_use_1` through `cti_use_5` for one-tap recent-thread switching
4. Keep `card.action.trigger` only for Feishu template-card integrations; it is not required for the built-in thread list

## Permission timeout

**Symptoms**: The IM bridge starts a Codex turn, but approval or execution never completes.

**Steps**:

1. Check your Codex execution policy in `~/.codex-im-sync/config.env`
2. If you want unattended runs, set `CTI_CODEX_APPROVAL_POLICY=never` or `CTI_CODEX_FULL_AUTO=true`
3. For very high-trust local setups only, consider `CTI_CODEX_DANGEROUS_BYPASS=true`
4. Check logs if the timeout happens during platform API calls or Codex auth

## High memory usage

**Symptoms**: The daemon process consumes increasing memory over time.

**Steps**:

1. Check current memory usage: `/codex-im-sync status`
2. Restart the daemon to reset memory:
   ```
   /codex-im-sync stop
   /codex-im-sync start
   ```
3. If the issue persists, check how many concurrent Codex sessions are active
4. Review logs for error loops that may cause memory leaks

## Session not syncing as expected

**Symptoms**: The IM chat continues, but you do not see the same thread in your local Codex workflow.

**Steps**:

1. Confirm the bridge is running with `CTI_RUNTIME=codex`
2. Check logs for a resumed session ID in `/codex-im-sync logs 200`
3. Avoid switching that IM chat to a different project directory unless you intend to fork context
4. Verify you are continuing the same local Codex session, not opening a fresh one manually

## Stale PID file

**Symptoms**: Status shows "running" but the process doesn't exist, or start refuses because it thinks a daemon is already running.

The daemon management script (`daemon.sh`) handles stale PID files automatically. If you still encounter issues:

1. Run `/codex-im-sync stop` -- it will clean up the stale PID file
2. If stop also fails, manually remove the PID file:
   ```bash
   rm ~/.codex-im-sync/runtime/bridge.pid
   ```
3. Run `/codex-im-sync start` to launch a fresh instance
