# Agent (`@pockrew/pwr-agent`)

The agent owns local SQLite storage, receives deliveries from the server, forwards them to targets, stores results and replays, and exposes a local API to the CLI, Studio, and MCP. Read `../../docs/architecture.md` and `../../docs/coding-rules.md` when changing a core flow.

## When changing this package

- Bind only to loopback. `src/app.ts` owns the local API and global error envelope; `src/platform/runtime.ts` serves the production Studio build only after API routes. Development uses Vite/HMR.
- Keep relay keys and target secrets in the local DB. Attach the relay key to the WebSocket handshake automatically; add a target secret only when calling its target. Never put secrets in server config sync, ACKs, list responses, or logs.
- Commit the event and package to SQLite before `ack_received`. After forwarding to a target, store the local result before sending `ack_relayed`; a replay gets a new ID and record before `ack_replayed`. Set `reportedAt` only after the server sends `result_committed`.
- Retain work and unconfirmed ACKs across disconnections for later reporting. Replay the stored payload for the same endpoint with its current target and secret, even when the server is offline. Do not add a second fanout engine: the server already creates one delivery per endpoint.
- Collection and endpoint metadata have a local version, server baseline, and possible conflict. Offline edits must be durable. If both sides edit the same record, preserve the local version and report a conflict for an explicit `local` or `server` choice. Do not use localStorage or timestamps to choose a winner.
- Prune only terminal data confirmed by the server, past the retention policy, and free of dependent replays or ACKs. Keep deduplication tombstones; never prune config, keys, secrets, pending work, or conflicts. When storage is blocked, stop intake safely and never send a false receipt.
- Make DB changes through schemas and migrations tested against existing data. Never use a user's DB in tests; point `AGENT_DB_FILE_NAME` to a temporary DB.

## Verification

Run `bun run --cwd apps/agent typecheck` and the relevant tests in `apps/agent/src` for relay/reconnect, offline sync, retention, or the local API. For static runtime changes, run `apps/agent/src/platform/runtime.test.ts` and build Studio; for wire protocol changes, also run the corresponding server relay tests.
