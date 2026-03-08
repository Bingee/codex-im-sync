# Security

## Credential Storage

All credentials are stored in `~/.codex-im-sync/config.env` with file permissions set to `600` (owner read/write only). This file is created during `setup` and never committed to version control.

The `.gitignore` excludes `config.env` to prevent accidental commits.

## Log Redaction

All tokens and secrets are masked in log output and terminal display. Only the last 4 characters of any secret are shown (e.g., `****abcd`). This applies to:

- Setup wizard confirmation output
- `reconfigure` command display
- `logs` command output
- Error messages

## Threat Model

This project operates as a **single-user local daemon**:

- The daemon runs on the user's local machine under their user account
- No network listeners are opened; the daemon connects outbound to IM platform APIs only
- Authentication is handled by the IM platform's bot token mechanism
- Local Codex access is handled through the user's own Codex CLI login or API key
- Access control is enforced via allowed user/channel ID lists configured per platform

The primary threats are:

- **Token leakage**: Mitigated by file permissions, log redaction, and `.gitignore`
- **Unauthorized message senders**: Mitigated by allowed user ID filtering per platform
- **Over-permissive Codex execution**: Mitigated by conservative `CTI_CODEX_APPROVAL_POLICY` or sandbox settings
- **Local privilege escalation**: Mitigated by running as unprivileged user process

## Token Rotation

To rotate compromised or expired IM tokens:

1. Revoke the old token on the IM platform
2. Generate a new token
3. Run `/codex-im-sync reconfigure` to update the stored credentials
4. Run `/codex-im-sync stop` then `/codex-im-sync start` to apply changes

## Codex Execution Safety

This fork is designed around local Codex session reuse. That means the daemon may resume real local Codex threads and inherit your local Codex auth state.

Recommended defaults:

- Keep `CTI_RUNTIME=codex`
- Prefer `CTI_CODEX_APPROVAL_POLICY=never` only on trusted personal machines
- Prefer `CTI_CODEX_SANDBOX_MODE=workspace-write` over more permissive modes when possible
- Leave `CTI_CODEX_DANGEROUS_BYPASS` disabled unless the machine is isolated and disposable
- Restrict IM access with allowed user IDs or channel IDs whenever the platform supports it

If you enable fully unattended Codex execution, treat the machine as a privileged automation host.

## Leak Response

If you suspect an IM token or Codex credential has been leaked:

1. **Immediately revoke** the token or API key on the respective platform
2. Run `/codex-im-sync stop` to halt the daemon
3. Run `/codex-im-sync reconfigure` with new credentials
4. Review `~/.codex-im-sync/logs/` for unauthorized activity
5. Run `/codex-im-sync start` with the new credentials
