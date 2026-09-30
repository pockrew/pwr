# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

PWR (Pocket Webhook Relay) is a self-hosted webhook relay: a server stores provider webhooks and pushes deliveries over WebSocket to a local agent, which forwards them to local targets and keeps history for inspection and replay. Bun monorepo (`apps/*`, `packages/*`), TypeScript 7, Hono, Drizzle + SQLite, Zod 4, SolidJS + Vite + Tailwind 4 for frontends.

Each package has an `AGENTS.md` with package-specific rules and verification steps — **read the one for the package you are changing** before editing. Deeper references: `docs/architecture.md` (core flows), `docs/api.md`, `docs/operations.md`, `docs/ui.md`, `docs/coding-rules.md`.

## Commands

```sh
bun install
bun run dev:server          # server on :18787 (needs PUBLIC_URL, BETTER_AUTH_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD)
bun run dev:local           # agent on :18788 + Studio Vite on :15174
bun run --cwd apps/admin dev   # Admin Vite at http://localhost:15175/admin/

bun run typecheck           # tsc --build --noEmit across the workspace
bun run --cwd apps/agent typecheck   # single package
bun run lint                # prettier --check + oxlint --deny-warnings
bun run lint:fix
bun run lint:rules          # architecture checker (scripts/dependencies): import boundaries, file sizes, unsafe constructs

bun test                               # all tests
bun test apps/agent/src                # one package
bun test apps/agent/src/platform/runtime.test.ts   # one file
bun test -t "name pattern"             # filter by test name

bun run build:server        # builds Admin and copies it into apps/server/public
bun run build:studio
bun run build:binaries      # dist/pwr (CLI) and dist/pwr-agent for this machine
bun run release             # cross-platform release binaries + SHA256SUMS in dist/release
bun run --cwd apps/server db:generate | db:migrate    # Drizzle (agent also has db:generate)
```

`bunfig.toml` preloads `scripts/test.setup.ts`, which forces `NODE_ENV=test`, an in-memory server DB, and a temp `HOME`/`AGENT_DB_FILE_NAME` — tests must never touch a real user DB.

## Architecture

```text
Provider ──HTTP──> Server/SQLite ──WebSocket──> Agent/SQLite ──HTTP──> Local target
                             Admin ──API──> Server     CLI/Studio/MCP ──local API──> Agent
```

- `apps/server` — ingress (`/ingress/:slug/:collectionId` or `/ingress/:slug/target/:path`), delivery backlog, WebSocket relay (`/relay/:slug`), Better Auth, tunnels/keys, collection/endpoint metadata, audit. Serves the Admin build under `/admin`.
- `apps/agent` — loopback-only, token-protected local API, local SQLite, agent-owned target URLs and secrets, offline replay, config sync with conflict detection, retention/disk pressure, proxy, MCP (read-only by default). Serves the Studio build at its root (embedded in release binaries). `src/index.ts` takes the per-data-dir lock, then loads `src/daemon.ts`.
- `apps/cli` — the `pwr` binary; a thin client of the agent API only.
- `apps/studio` / `apps/admin` — Solid frontends for the agent and server respectively; they call APIs via `src/libs/api-client`.
- `packages/shared` — Zod schemas, DTOs, wire messages, error codes (pure; imports nothing internal).
- `packages/core` — pure shared logic for server and agent (matchers, byte mappers, forwarder, config diff/sync, retention, proxy). No DB connections, sockets, or listeners.
- `packages/ui` — shared Solid components/icons/theme; no API knowledge.

Server and agent have **separate** DBs, Drizzle schemas, and migrations. Apps never import each other at runtime (only `import type` and `*.integration.test.ts` may); sharing goes through `packages/*`. `lint:rules` enforces this plus server layering (`platform/` must not import `modules/`; `routes.ts` files are imported only by `app.ts`).

### Invariants that must not break

- Ingress: verify inbound `x-api-key` or the tunnel's provider signature (GitHub, Stripe, Standard Webhooks, Shopify, Slack, custom HMAC) against the raw body → commit the event → return 200. Delivery preparation is a **separate, recoverable** transaction.
- Payload bodies are original bytes (BLOB / base64 on the wire): never parse, re-serialize, decompress, or re-sign. Preserve `rawQuery` (appended after the target URL's own query).
- One delivery per matching endpoint; the agent never fans out again. Undelivered deliveries stay `PENDING` for reconnect and are sent in event insertion order (rowid, not the second-precision `receivedAt`).
- ACKs `ack_received`, `ack_relayed`, `ack_replayed` are independent; `result_committed` is only a transport confirmation (agent sets `reportedAt` after it). All are idempotent by stable ID.
- Agent commits to SQLite before sending `ack_received`, stores the target result before `ack_relayed`. Replay creates a new ID/record, never modifies its source, and works offline.
- Target URLs never come from or go to the server; ACKs carry outcome metadata only (no response body/headers). A target call whose commit failed is retried as a commit, never re-called (`relays/execution.ts`).
- One active agent per tunnel (instance ID header; `--takeover` to replace; an agent closed with `4409` stops reconnecting until connected again). Ingress dedupes provider delivery IDs per selector; the daily quota is charged only after auth.
- Target secrets and relay keys live only in the agent DB — never in config sync, ACKs, list responses, logs, URLs, or browser storage.
- Offline config conflicts keep the local version and require an explicit `local`/`server` choice; timestamps never pick a winner.
- Retention never prunes pending work, unreported results, dependent replays, config, keys, secrets, or conflicts; `storage_blocked` stops intake without false ACKs.

### Code conventions

- HTTP success envelope `{ data, requestId }`; the global error handler returns `{ code, requestId }`. Validation at the route, orchestration in services, queries in repositories — but don't create empty layers to fit a template.
- In production `.ts`: no `any`, no `as` (except `as const`), no non-null `!`, arrow functions instead of `function` declarations (checked by `lint:rules`; `.tsx`, tests, and `.d.ts` are exempt).
- File size limits: source `.ts/.tsx` warn 300 / fail 500 lines; docs 600/1000; `apps/server/src/app.ts` and `auth/index.ts` 100/150.
- TSDoc on exported APIs; number comments at commit/ACK/recovery/sync/prune steps where order protects correctness.
- Don't edit released migrations; new migrations must preserve existing data.
- Don't reintroduce parallel/legacy ingress, relay, or replay engines.
