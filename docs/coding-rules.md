# Core development rules

Current source and `bun run lint:rules` are the verification baseline. This document keeps only the rules needed to change server, agent, CLI, and UI without recreating legacy engines or changing webhook flow semantics.

## Boundaries

- `packages/shared`: shared Zod schemas, DTOs, wire messages, and error codes. Request and ACK validation belong in one contract, not copied types in each app.
- `packages/core`: reusable logic for server and agent, such as byte mappers, selectors, config comparison, and proxy/retention helpers. It does not open a DB, socket, or HTTP listener.
- `apps/server`: HTTP ingress, persistence, delivery preparation, relay sockets, management, and audit.
- `apps/agent`: local DB, target execution, offline config and replay, retention, and local API.
- `apps/cli`, Studio, Admin: clients of the app that owns the business behavior; they do not run a second relay or replay engine.

When changing an existing module, keep validation and the HTTP envelope at the route, orchestration in the service, and queries in the repository. Split handlers by responsibility when needed; **do not** create empty route/service/repository files just to fit a template. Add an abstraction only when at least two real use cases need it. Do not add a queue framework for a flow already handled by SQLite plus the current event and recovery mechanism.

## Business invariants

- Commit an ingress event before returning HTTP success. Delivery preparation is separate and recoverable; do not combine it with the payload-storage transaction.
- The payload body consists of original bytes: do not parse/stringify, preprocess, decompress, or re-sign it. Use `rawQuery` to reconstruct the query when available. Handle transport headers at the correct boundary and never expose the ingress `x-api-key` to agents or targets.
- One delivery belongs to one endpoint. The agent does not fan out again. `ack_received`, `ack_relayed`, and `ack_replayed` retain separate meanings; `result_committed` only confirms a server commit.
- Replay creates a new ID and record referencing its source; it does not alter the source. Target secrets stay only in the agent DB and never enter server metadata, ACKs, list APIs, or logs.
- Offline config keeps the local version on conflict and requires an explicit choice. Retention does not remove pending work, unreported results, dependent replays, config, keys, or secrets; disk pressure must not produce a false ACK.

## Types, errors, and comments

`bun run lint:rules` checks dependency boundaries, parent imports, file sizes, and several unsafe source constructs. In production `.ts` files, avoid `any`, `as` assertions (except `as const`), non-null assertions, and function declarations according to the current checker. Use `unknown`, Zod or type guards, and arrow functions. The checker exempts `.tsx`, tests, and declaration files; those exemptions do not remove the need for runtime validation.

HTTP routes use shared validators and return `{ data, requestId }`; the global error handler returns `{ code, requestId }`. Do not invent a second response or error envelope in individual handlers. Never include secrets, payloads, or SQL parameters in error responses.

Write TSDoc for public APIs and meaningful repository or service operations. Number comments at commit, ACK, recovery, sync, or prune steps when their order protects data correctness. Comments explain _why_ and document constraints; they do not repeat function names or preserve obsolete historical notes.

## Verification

Test a changed flow at the boundary where it can fail: HTTP ingress and DB failure, WebSocket reconnect and ACK, target side effects, config conflicts, or retention. Use temporary DBs and never migrate a user's DB in tests. Run typecheck, lint, the architecture checker, and builds appropriate to the change. Broaden tests only after a failure or a new risk is found; do not keep legacy-engine tests merely to raise the test count.
