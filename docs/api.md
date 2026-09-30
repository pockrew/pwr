# Current API and CLI

This is the route map of the current source, not a list of planned endpoints. Server and agent success responses use `{ "data": ..., "requestId": "..." }`; errors from the shared handler use `{ "code": "...", "requestId": "..." }`. Most list routes have schema-defined limits and cursors; `/api/audit` supports a limit and optional tunnel filter but has no cursor. Use **IDs** for management, **tunnel slugs** for ingress and relay, and **session aliases** for the agent's local API. For an end-to-end walkthrough, start with the [user guide](guide.md).

## Authentication

| Client                 | Credential                                                                                         | Scope                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Provider               | Inbound `x-api-key`, or signed (GitHub, Stripe, standard webhooks, Shopify, Slack, or custom HMAC) | Ingress for the matching slug.                                                                       |
| Agent                  | Outbound `x-api-key` in the WebSocket handshake                                                    | Relay for the matching slug; collection/endpoint management for that tunnel, audited by key name/IP. |
| Admin browser          | Better Auth session cookie for the server's sole account                                           | Server administration. Cookie-based mutations require a trusted `Origin`.                            |
| Management HTTP client | `Authorization: Bearer <admin-key>`                                                                | Independent `tunnel`, `keys`, `collections`, and `endpoints` permissions within one tunnel.          |
| CLI `pwr`/Studio/MCP   | Local Agent API on loopback                                                                        | Does not need or retain the server admin account.                                                    |

Inbound and outbound keys are stored as SHA-256 hashes; management keys use Argon2id. Raw tokens are returned only once at issuance. A key with `keys` permission may issue and revoke inbound and outbound keys; only the admin account may issue or revoke management keys. Organizations, teams, and SSH signing are not part of the current flow.

## Server: provider and relay

| Method                | Route                          | Behavior                                                                                       |
| --------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------- |
| Supported HTTP method | `/ingress/:slug/:collectionId` | Store an event for the collection ID; matching endpoints in that collection get deliveries.    |
| Supported HTTP method | `/ingress/:slug/target/:path`  | Select endpoints by literal path; multiple endpoints with that path receive deliveries.        |
| `GET` upgrade         | `/relay/:slug`                 | Agent WebSocket with backlog `sync`, live `webhook_event`, three ACKs, and `result_committed`. |
| `GET`                 | `/relay/:slug/check`           | Outbound-key check with the handshake's IP and key rules; opens no socket and changes nothing. |
| `GET`                 | `/api/health`, `/api/ready`    | Liveness and DB readiness.                                                                     |

Ingress supports `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, and `HEAD`; other methods are rejected. A `GET` or `HEAD` declaring a body that the runtime cannot read completely receives 400 and stores no event. HTTP 200 contains only the event ID and request ID, without echoing body or headers. The ingress `x-api-key` is neither stored in history nor forwarded to the target.

## Server: management

The base path is `/api`. Sign in with `POST /api/auth/sign-in/email`, read the session with `GET /api/auth/get-session`, and sign out with `POST /api/auth/sign-out`. Public sign-up is disabled; the sole account is initialized from the environment for a new database.

| Method                   | Route after `/api`                                                   | Permission and function                                                                                                                                |
| ------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`, `POST`            | `/tunnels`                                                           | List; only the account may create a tunnel.                                                                                                            |
| `GET`, `PATCH`, `DELETE` | `/tunnels/:tunnelId`                                                 | `tunnel` permission; soft deletion.                                                                                                                    |
| `GET`, `POST`            | `/tunnels/:tunnelId/keys`                                            | `keys` permission; list metadata or issue a key.                                                                                                       |
| `DELETE`                 | `/tunnels/:tunnelId/keys/:keyId`                                     | `keys` permission; account-only for a management key.                                                                                                  |
| `GET`, `PUT`, `DELETE`   | `/tunnels/:tunnelId/ingress-signing`                                 | **Account-only**; view status, set, or remove a signing secret (GitHub, Stripe, standard webhooks, Shopify, Slack, or HMAC). `GET` never returns it.   |
| `GET`                    | `/tunnels/:tunnelId/delivery-status`                                 | `endpoints` permission; counts of unprepared, unmatched, pending, and blocked work.                                                                    |
| `GET`, `POST`            | `/tunnels/:tunnelId/config-sync`                                     | Requires both `collections` and `endpoints`; used by the agent for bidirectional sync.                                                                 |
| `GET`, `POST`            | `/tunnels/:tunnelId/collections`                                     | `collections` permission; list or create.                                                                                                              |
| `GET`, `PATCH`, `DELETE` | `/tunnels/:tunnelId/collections/:collectionId`                       | `collections` permission; read, update, or soft-delete.                                                                                                |
| `GET`, `POST`            | `/tunnels/:tunnelId/collections/:collectionId/endpoints`             | `endpoints` permission; list or create.                                                                                                                |
| `GET`, `PATCH`, `DELETE` | `/tunnels/:tunnelId/collections/:collectionId/endpoints/:endpointId` | `endpoints` permission; read, update, or soft-delete.                                                                                                  |
| `GET`                    | `/audit?cursor=...&limit=1..100&tunnelId=...`                        | Read up to 100 recent audit rows, newest first; relay and management keys scoped to their tunnel. `nextCursor` in response; pass `cursor` to paginate. |
| `GET`                    | `/logs`, `/logs/stream?after=<cursor>`                               | **Account-only**; `server.log` pages (as the agent `/logs`) and SSE live tail.                                                                         |
| `GET`, `PUT`             | `/logs/settings`                                                     | **Account-only**; minimum level and rotation `{ level, maxSizeMb, maxFiles }`.                                                                         |

A collection has `slug` and `isActive`. An endpoint has `pathName`, `isActive`, and `isPaused`; the server has no target URL or target-secret field (sending `localTarget` is rejected with 400). Multiple endpoints may share a path for fanout. Signing mode is **one of** `api_key`, `github`, `stripe`, `standard_webhooks`, `shopify`, `slack`, or `hmac`, without an extra fallback API key. `PUT /ingress-signing` takes `{ provider, secret }`; `hmac` also takes `options: { header, algorithm: sha256|sha1|sha512, encoding: hex|base64, prefix }` and may omit `secret` to keep the saved one while changing only the options. Status responses are `{ provider, configured, options, available }`; `available` is false until the server has `WEBHOOK_SIGNING_ENCRYPTION_KEY`, and saving a signed mode then fails with `409 SIGNING_UNAVAILABLE`.

## Agent: local API

The agent listens on `127.0.0.1:18788` by default (a free port if 18788 is busy and no port is pinned; see `agent.port` in [Operations](operations.md#agent-and-local-client-configuration)) and rejects non-loopback hosts and origins. The routes below can also be called with an `/api` prefix; unprefixed paths remain mounted for CLI compatibility. In production, the agent serves Studio at `/`; in development, Vite owns HTML/HMR.

| Method                 | Local route                                                                | Function                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET`                  | `/health`                                                                  | Health and `storage` status (`storage_blocked` when intake stops).                                            |
| `POST`                 | `/agent/stop`, `/agent/restart`                                            | Graceful stop, or restart on the same port; `install-service` agents are relaunched by the OS.                |
| `GET`                  | `/logs`                                                                    | Newest-first `agent.log` page across rotated files: `before` cursor, `limit`, `level`, `q`, `from`/`to`.      |
| `GET`                  | `/logs/stream?after=<cursor>`                                              | SSE tail from an `<inode>:<offset>` cursor, surviving rotation; each `logs` batch carries the next `after`.   |
| `GET`, `PUT`           | `/logs/settings`                                                           | Minimum level and rotation of `agent.log` (`[logs]` in `config.toml`), applied immediately.                   |
| `GET`, `PUT`           | `/updates`, `/updates/config`                                              | Update status; set `{ "mode": "manual" }`, `auto` (installs and restarts), or `never` (no checks).            |
| `POST`                 | `/updates/check`, `/updates/apply`                                         | Check GitHub now; install the latest release (SHA256SUMS-verified), then restart the agent.                   |
| `GET`                  | `/tunnels`, `/tunnels/:alias`                                              | Saved sessions and runtime status.                                                                            |
| `POST`                 | `/tunnels/connect`, `/tunnels/disconnect`                                  | Connect/disconnect; store the outbound key locally.                                                           |
| `POST`                 | `/tunnels/test`                                                            | Check `{ serverWsUrl, slug, apiKey? }` against the server; stores nothing (without `apiKey`, the saved key).  |
| `POST`                 | `/tunnels/:alias/pause`, `/tunnels/:alias/resume`, `/tunnels/:alias/drain` | Control local execution.                                                                                      |
| `GET`, `PUT`, `DELETE` | `/tunnels/:alias/relay-key`                                                | Check presence, replace, or remove a local relay key; never returns its value.                                |
| `GET`                  | `/requests`, `/requests/:id`, `/requests/:id/deliveries`                   | Scoped, paginated history; each request carries delivery counts and the newest result's status/latency.       |
| `POST`                 | `/replay/:id`                                                              | Create a local replay by delivery ID; an event ID is valid only if it has exactly one delivery. Body is `{}`. |
| `GET`                  | `/events/stream` or `/events/stream/:alias`                                | SSE for local clients.                                                                                        |
| `GET`                  | `/tunnels/:alias/config?kind=collection` or `kind=endpoint`                | Metadata backup, pending/conflict state, and sync status.                                                     |
| `POST`                 | `/tunnels/:alias/config/:kind/:id/resolve`                                 | Choose `{ "choice": "local" }` or `server`.                                                                   |
| `POST`                 | `/tunnels/:alias/collections`                                              | Create a local collection.                                                                                    |
| `GET`, `PATCH`         | `/tunnels/:alias/collections/:collectionId`                                | Read/update a local collection; local deletion is not available yet.                                          |
| `POST`                 | `/tunnels/:alias/collections/:collectionId/endpoints`                      | Create a local endpoint; optional agent-owned `localTarget` and `secret`, committed together.                 |
| `GET`, `PATCH`         | `/tunnels/:alias/collections/:collectionId/endpoints/:endpointId`          | Read/update a local endpoint; `localTarget`/`secret` commit together, `null` clears. Deletion is in Admin.    |
| `GET`, `PUT`, `DELETE` | `/tunnels/:alias/collections/:collectionId/endpoints/:endpointId/secret`   | Check status, set, or remove a local target secret; `GET` never returns its value.                            |
| `GET`, `POST`          | `/proxy`                                                                   | Read/update proxy settings.                                                                                   |
| `GET`, `PUT`           | `/retention`                                                               | Read/update policy and storage status.                                                                        |
| `POST`                 | `/maintenance/clean`                                                       | Run the same safe policy used at startup and by the timer.                                                    |
| `POST`                 | `/mcp`                                                                     | Local JSON-RPC for tunnel and request/delivery inspection; replay only with `[mcp] allow_replay = true`.      |
| `GET`                  | `/auth?token=…`                                                            | Exchange the local token for Studio's HttpOnly session cookie (used by `pwr studio`).                         |

Every local API route except `/health` requires the local token: `Authorization: Bearer <~/.pockrew/agent.token>` or the Studio session cookie. `POST /tunnels/connect` accepts `tunnelId` (a local alias), optional `slug`, `serverWsUrl` (must be `https://`/`wss://` except for localhost), optional `apiKey` if a key was already stored, and optional `takeover`. A session has no default target. Replay accepts no payload, header, or target override; the agent reads the target secret at execution time.

## CLI `pwr`

The CLI only parses commands and calls the local agent: `agent` (start/stop/restart/status/logs/install-service), `update` (`--check`, `--mode auto|manual|never`), `studio`, `connect`, `status`, `inspect`, `replay`, `collections`, `endpoints`, `secrets`, `proxy`, and `clean`. `status` and `inspect` never start the agent. `pwr help` prints the latest syntax and examples. There is no project switch; `--project` remains a filter/scope for commands that support it.

```sh
pwr status
pwr collections list my-alias
pwr collections create my-alias payments
pwr endpoints create my-alias <collection-id> --path /hooks --target http://127.0.0.1:3000/hooks
printf '%s' "$TARGET_SECRET" | pwr secrets set my-alias <collection-id> <endpoint-id>
printf '%s' "$TARGET_SECRET" | pwr endpoints update my-alias <collection-id> <endpoint-id> \
  --target http://127.0.0.1:3000/hooks --secret - --header x-target-key
pwr replay <delivery-id> --tunnel my-alias
```

Deliveries held for a missing target are released as soon as a target is saved, so set an endpoint's secret **before or together with** its target: `--secret -` on `endpoints create|update` (or `secret` in the local API body) commits both at once. Secrets and relay keys are accepted only through stdin (`--api-key -`, `--secret -`) or `PWR_API_KEY`, never as command-line arguments, to keep them out of shell history and `ps`. `pwr secrets relay ...` manages an outbound key already stored by the agent; it does **not** issue a key on the server.
