# Operations

Run the commands below from the repository root. The server requires Bun; the released `pwr` and `pwr-agent` binaries run without Bun. Never use a user's database as a test database.

## Server configuration

| Variable                         | Requirement                                                   | Purpose                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_URL`                     | Set to the actual public URL, especially in production        | Better Auth origin/cookie; local default is `http://localhost:18787`.                                                         |
| `BETTER_AUTH_SECRET`             | Required; at least 32 random characters                       | Signs sessions.                                                                                                               |
| `ADMIN_EMAIL`                    | Required                                                      | The sole admin account.                                                                                                       |
| `ADMIN_PASSWORD`                 | Required for a new auth DB; may be removed after bootstrap    | Initial password; restarting does not reset it.                                                                               |
| `DB_FILE_NAME`                   | Optional; defaults to `data/pwr.sqlite`                       | Server SQLite database.                                                                                                       |
| `WEBHOOK_SIGNING_ENCRYPTION_KEY` | Required when signed ingress is configured; 64 hex characters | Encrypts every provider signing secret. Keep and back it up with the DB. Without it, Admin shows signed modes as unavailable. |
| `PORT`                           | Optional; defaults to `18787`                                 | HTTP server port.                                                                                                             |

The server refuses to start if an existing auth DB does not match the configured account, required credentials are missing, or there is more than one user. Public sign-up is disabled. For Docker or VPS production deployments, copy `.env.example` to `.env` and provide `PUBLIC_URL`, `BETTER_AUTH_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` (for initial bootstrap). `docker-compose.yml` has no default credentials or secrets and reads them from the deployment environment.

Transport limits can be configured with `MAX_INGRESS_PAYLOAD_BYTES` (default 5 MiB), `MAX_REPLAY_BACKLOG_BATCH` (50), `MAX_REPLAY_BATCH_BYTES` (1 MiB for the combined JSON frame), `MAX_WS_BUFFER_BYTES`, and `RELAY_ACK_TIMEOUT_MS` (30 seconds). A single delivery that exceeds the batch byte budget is sent alone rather than truncated. Set `TRUSTED_PROXIES` to your reverse proxy's addresses: forwarded headers are otherwise ignored, so every client appears as the proxy (shared IP rate limit, broken IP allow/deny lists, shared admin sign-in throttle). `PUBLIC_URL` is **required** when `NODE_ENV=production`. The tunnel daily quota (`TUNNEL_DAILY_QUOTA`) is charged only after a request authenticates; the per-IP limit applies before. Retention: `SERVER_RETENTION_DAYS` (7) drops payloads of fully delivered events, `SERVER_METADATA_RETENTION_DAYS` (30) deletes their event/delivery rows, and `AUDIT_RETENTION_DAYS` (90) deletes audit rows; pending or unconfirmed work is never pruned, except deliveries that can never be sent because their endpoint, collection or tunnel was deleted. The server DB uses WAL with `synchronous=FULL`.

## Agent and local client configuration

| Variable                           | Default                                | Purpose                                                                                                                |
| ---------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `PWR_AGENT_HOST`, `PWR_AGENT_PORT` | `127.0.0.1`, `18788`                   | Loopback listener only. An unset port prefers 18788 and moves to a free port when it is busy; a set port must be free. |
| `AGENT_DB_FILE_NAME`               | `~/.pockrew/agent.db`                  | Local SQLite history, keys, and target secrets.                                                                        |
| `STUDIO_DIST_DIR`                  | Embedded in release binaries           | Override Studio assets (development/custom builds).                                                                    |
| `NODE_ENV`                         | Compiled binary defaults to production | Development uses Vite/HMR; the agent does not serve an old Studio build.                                               |

The agent supports loopback only and keeps its private files next to the DB: `agent.token` (local API token), `agent.lock` (one daemon per data directory), `agent.id` (instance ID for the one-agent-per-tunnel rule), `agent.port` (the port the running agent bound) and `logs/agent.log`. The CLI reads `agent.port`, so `pwr` finds an agent that had to move off a busy 18788; `pwr agent status` prints the actual address. For a fixed URL (bookmarks, MCP clients), pin the port with `PWR_AGENT_PORT` or `pwr agent start|install-service --port <n>`; a pinned port that is busy stops startup instead of moving. An outbound key is stored in the local DB on connect or replacement, then attached automatically to handshakes after reconnect. Target secrets are scoped in the local DB by server URL, tunnel slug, and endpoint ID; they never go to the server. Permissions on the local DB/WAL/SHM files and directory are restricted when the agent opens the DB.

## Run, build, and install

```sh
bun install
bun run dev:server           # Server :18787; requires the auth environment variables above
bun run dev:local            # Agent :18788 + Studio Vite :15174
bun run --cwd apps/admin dev # Admin Vite :15175/admin/
```

For production, `docker compose up -d --build` runs the server (non-root, persistent DB volume, readiness healthcheck). `bun scripts/release.ts [version]` cross-compiles `pwr` and `pwr-agent` (Studio embedded) for macOS/Linux x64/arm64 into `dist/release/` with `SHA256SUMS`, `LICENSE` and `THIRD_PARTY_NOTICES.txt` (both are also copied into the Docker images; run `bun run notices` after changing dependencies, CI fails on a stale file); pushing a `v*` tag runs it in CI and publishes a GitHub release. `install.sh` downloads and verifies those assets (`--from-source` builds locally). The server serves production Admin under `/admin`; the agent serves Studio at `/`. The CLI calls the agent API and does not connect to the server directly to forward webhooks.

Server liveness is `/api/health`, and DB readiness is `/api/ready`. Agent `/health` returns `storage.state`; `storage_blocked` means intake has stopped safely while reporting and reads can continue. Use `GET /api/tunnels/:id/delivery-status` to distinguish unprepared events, unmatched events, pending deliveries, and deliveries blocked by config. An agent disconnect does not delete the server backlog.

## Logs, masking, and self-update

The server and the agent log with [LogTape](https://logtape.org) to local files only: `server.log` in `$LOG_DIR` (default `logs/` beside the server DB) and `logs/agent.log` in the agent data directory. Each line is a JSON Lines record (`@timestamp`, `level`, `message`, `logger` category such as `pwr.server.relay`, `properties`); records written during an HTTP request carry its `requestId`. Files rotate by size to `<file>.1` … `<file>.<maxFiles>`; level and rotation are set in Admin (**Server Logs → Level & rotation**, stored in the `server_settings` table) and Studio (**Agent Logs**, stored as `[logs]` in `config.toml`) and apply without a restart. Admin and Studio page these files newest first across rotated files, filter by level, text and time on the server, and follow new entries over SSE. The server also prints the records to stdout as JSON Lines for container logs; a foreground agent prints readable text, while a background agent's stdout/stderr go to `logs/agent.out.log` for crash output only.

Nothing is sent to an external log service. Every sink receives masked records: values under keys such as password, secret, token, API/relay key, authorization, cookie, session, signature, and webhook `payload`/`body` fields become `[REDACTED]` (also when used as message placeholders), errors keep only their name and code (messages can embed query parameters), and HTTP request lines contain method, path, status and duration only, with Better Auth reset tokens masked in paths. Better Auth's own warnings are routed into `server.log` without their arguments. Audit rows stay in the database (scoped reads, `AUDIT_RETENTION_DAYS`) and are also written to `server.log` under `pwr.server.audit`, so a log shipper added later would receive them in the same format.

Release installs update themselves: `pwr update`, or **Settings → Local Agent → Updates** in Studio. The agent downloads `pwr-agent` (Studio embedded) and the `pwr` CLI beside it from the GitHub release, verifies them against `SHA256SUMS`, renames them into place and restarts; a failed or mismatched download changes nothing. `[updates] mode` in `config.toml` is `manual` (daily check, install on request), `auto` (install when found) or `never` (no background request to GitHub; a check runs only when asked). Source and `-dev` builds, and installs in a read-only directory, only report why they cannot update; re-run `install.sh` for those. Agents installed with `pwr agent install-service` restart through launchd/systemd (`PWR_AGENT_SUPERVISED=1`); re-run `install-service` for units written before this setting existed.

## Databases, retention, and upgrades

Server and agent migrations run at startup. Before upgrading an active DB, stop the process, checkpoint WAL, and back up SQLite together with WAL/SHM files or use a consistent SQLite backup mechanism; only then start the new binary. Do not edit released migrations. For confirmation or retention changes, upgrade the server before the agent. A new agent talking to an old server keeps results unconfirmed and does not prune them.

The agent prunes only terminal packages confirmed by the server, older than `retentionDays` or beyond `maxEvents`, and without dependent replays or ACKs. Startup, the 60-second timer, `PUT /retention`, and `POST /maintenance/clean` use the same policy. Tombstones retain IDs for 30 days after pruning to prevent duplicate forwarding. Config, pending work, conflicts, keys, and secrets are not pruned. `maxDbSizeMb` (default 512 MB) is a threshold for **accepting new work**, not a hard quota on all SQLite writes; one package needs about three times its encoded size in headroom. If the disk is full and remaining data is protected, the agent stops intake and does not send a successful ACK.

## Verify changes

```sh
bun run typecheck
bun run lint
bun run lint:rules
bun test apps/server/src/modules/relays/release-flow.test.ts apps/agent/src/modules/relays/relay-flow.integration.test.ts
bun run build:all
bun run smoke                # cross-process: scripts/smoke.ts (ports 28787–28799) and scripts/smoke-flows.ts (28827–28839)
bun run notices:check        # THIRD_PARTY_NOTICES.txt matches the shipped dependency tree
```

For core changes, also run tests at the relevant boundary: ingress/HMAC, auth/management, offline config, or retention. A successful build and isolated unit tests do not replace a cross-process smoke test with a temporary DB, provider request, WebSocket, and local target; `bun run smoke` covers ingress, held work, target secrets, replay, dedupe, offline agent/server, one agent per tunnel, key revocation, signed ingress for all providers, endpoint/tunnel pause/resume, and multi-tunnel/multi-agent scenarios (`SMOKE_BASE_PORT` moves the port block; logs are kept only on failure). Report the actual result for each release candidate rather than reusing an old test count.

## Known limitations (v0.1)

These are deliberate scope decisions or trade-offs of the first release.

**Delivery**

- Target execution is **at least once**: a crash after the target handled a call but before the agent committed the result can repeat the call. Deduplicate on `X-PWR-Delivery-Id`.
- A failed target call (non-2xx, connection refused, or no response within 10 seconds) is a terminal `FAILED` result. There are no automatic retries and no bulk replay; replay each delivery from Studio or `pwr replay`.
- Deliveries on one tunnel run one at a time, in arrival order.
- Work that waits for a local target and whose endpoint is then deleted on the server stays pending on the agent; it is never executed or pruned.
- Thousands of packages held for a missing target or a paused endpoint slow down the agent's queue scan.

**Ingress and signatures**

- GitHub, Shopify and custom HMAC signatures carry no timestamp, and their delivery-ID headers are not signed: someone who captured a valid request can resend it with a new ID and create a new event. Stripe, Standard Webhooks and Slack reject signatures older than 5 minutes.
- Slack retries are not deduplicated; Slack sends no delivery-ID header.
- A provider "redeliver" that reuses the original delivery ID is deduplicated: the server answers 200 and stores nothing new. Use PWR replay to send a stored event again.
- Synchronous callbacks that need the target's response (Twilio, Slack slash commands) are not supported: the server answers as soon as the event is stored.
- Providers that can neither send an `x-api-key` header nor use a supported signature are not supported; there is deliberately no key-in-URL mode.

**Server**

- One server process: the relay registry, rate limits and daily quotas live in memory (limits reset on restart), so the server does not scale horizontally.
- One admin account, no organizations or teams, and no password change or reset screen; a lost password needs direct database access.

**Agent and clients**

- macOS and Linux only (x64, arm64); no Windows build.
- One agent per tunnel; competing consumers are not supported.
- Target secrets and relay keys are stored in the agent's SQLite file with owner-only permissions, not in the OS keychain.
- Studio's request list shows the newest 50 requests (up to 200 while it stays open); use `pwr inspect` for older history.
- Self-update checks downloads against the release's `SHA256SUMS`, which proves integrity, not authorship; release binaries are not signed.
- Payload transformation, replay target overrides and SSH signing are not implemented.
