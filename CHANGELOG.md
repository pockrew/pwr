# Changelog

## v0.1.1 — 2026-09-30

### Added

- Windows support (x64, arm64): `pwr.exe` and `pwr-agent.exe` release binaries with SHA-256 checksums, and a verifying PowerShell installer (`irm https://raw.githubusercontent.com/pockrew/pwr/main/install.ps1 | iex`).
- `pwr agent install-service` on Windows adds a per-user Run entry that starts the agent at sign-in (no admin rights); `uninstall-service` removes it.
- Self-update on Windows: running binaries are renamed aside, replaced, and cleaned up on a later start.
- The update status (`GET /updates`) includes `installCommand`, the reinstall one-liner for the agent's platform, shown by `pwr update` and Studio when an install cannot update itself.

### Changed

- `install.sh --from-source` and `install.ps1 -FromSource` build only the current platform (`bun scripts/release.ts --target <os-arch>`).

### Fixed

- `pwr agent stop` and `restart` on Windows shut the agent down gracefully through the local API instead of terminating it, and the agent no longer opens a console window when started in the background.
- A self-update whose file swap fails puts back every binary it already replaced instead of leaving the install incomplete.

## v0.1.0 — 2026-09-28

First public release.

### Highlights

- Self-hosted server (Docker) with ingress, a durable delivery backlog, WebSocket relay, Admin UI, keys and audit.
- Local agent with SQLite history, offline replay, offline config edits with explicit conflict resolution, retention and disk-pressure protection, proxy support and an MCP endpoint.
- `pwr` CLI and the local Studio inspector (embedded in `pwr-agent`).
- Ingress authentication with a scoped `x-api-key`, or provider signatures: GitHub, Stripe, Standard Webhooks/Svix, Shopify, Slack, and a configurable custom HMAC.
- Prebuilt binaries for macOS and Linux (x64, arm64) with SHA-256 checksums, a verifying installer, and self-update.

### Security

- Target URLs, target secrets and response bodies never leave the agent; the server routes by collection/path only and receives outcome metadata.
- Token-protected, loopback-only agent API; `pwr studio` signs Studio in with an HttpOnly session cookie.
- Agent files (DB, WAL/SHM, token) are owner-only; relay keys are sent only over HTTPS (localhost excepted).
- Provider signing secrets are encrypted at rest; failed signatures are audited at most once per tunnel and minute.
- MCP is read-only unless `[mcp] allow_replay = true`.
- The tunnel daily quota is charged only after authentication; admin sign-in throttling uses the verified client IP.

### Reliability

- At-least-once delivery with `X-PWR-Delivery-Id` / `X-PWR-Replay-Of` idempotency headers, in arrival order per tunnel.
- Provider retries (`X-GitHub-Delivery`, Stripe event `id`, `webhook-id`/`svix-id`, `X-Shopify-Webhook-Id`) are stored once per ingress URL.
- One active agent per tunnel (`--takeover` to move it; the previous agent stops reconnecting); one agent process per data directory.
- The agent moves to a free local port when 18788 is busy (unless a port is pinned) and records it for the CLI.
- A failed result commit (e.g. disk full) never re-calls the target; a corrupt stored request fails instead of stalling the queue.
- Server retention for delivered payloads, event metadata and audit rows; `synchronous=FULL` for ingress durability.

### License

- Source-available under the PolyForm Noncommercial License 1.0.0 plus a Small Company Permission: free for personal and noncommercial use and for companies with 10 or fewer people; larger companies need a commercial license.
- `THIRD_PARTY_NOTICES.txt` (license texts of bundled packages) ships with every release and Docker image.
