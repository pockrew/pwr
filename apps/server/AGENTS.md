# Server (`@pockrew/pwr-server`)

The server receives provider webhooks, stores original events, prepares deliveries, and sends them to agents over WebSocket. It also owns Better Auth, tunnels, collections, endpoints, keys, and audit logs. Read `../../docs/architecture.md` and `../../docs/coding-rules.md` when changing a core flow.

## When changing this package

- Preserve ingress order: authenticate the inbound key or verify HMAC against the original body, commit `webhook_events`, emit `stored`, then return a receipt to the provider. Prepare deliveries separately with recovery; do not put them in the event-storage transaction.
- Create one delivery per matching endpoint. A delivery not yet acknowledged by an agent must remain `PENDING` for reconnect sync. Do not parse, alter, or re-sign the payload, and do not send the inbound API key to agents or targets.
- Keep the three business ACKs—`ack_received`, `ack_relayed`, and `ack_replayed`—independent. `result_committed` only confirms that a result was committed; retries with the same ID must be idempotent.
- Authenticate and authorize at route boundaries: scope inbound keys to tunnel slugs, limit outbound relay keys to their collection/endpoint capabilities, and use Better Auth for account administration. Audit-read routes must enforce actor type and tunnel scope. Never log raw keys, signing secrets, or payloads.
- Routes and validators return `{ data, requestId }`; the global error handler returns `{ code, requestId }`. Services orchestrate and repositories query the DB. Split files only when responsibilities actually differ.
- When serving Admin, keep `/api`, `/ingress`, and `/relay` outside the SPA fallback. Test routes with `NODE_ENV=production` and a real Admin build; GET ingress and WebSocket handshakes must reach their business handlers, not return HTML.
- New migrations must preserve existing data and have a rollback path before recording their version. Do not edit released migrations. Production configuration must not include public default credentials.

## Verification

Run `bun run --cwd apps/server typecheck`, the relevant tests in `apps/server/src`, and `bun run build:server` when changing the static runtime or Admin contract. For ingress or relay changes, verify a real HTTP request, DB commit, reconnect, and ACKs; tests under `NODE_ENV=test` do not replace a production smoke test.
