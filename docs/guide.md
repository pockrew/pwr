# PWR user guide

This guide takes one webhook from a provider through a self-hosted server and a local agent to your target, then shows how to inspect, replay, and operate that flow. It covers the current v0.1 behavior. Use the [API reference](api.md) for the full route map and [Operations](operations.md) for every environment setting.

## Contents

- [Before you start](#before-you-start)
- [Deploy the server](#deploy-the-server)
- [Install and connect the agent](#install-and-connect-the-agent)
- [Create a collection and endpoint](#create-a-collection-and-endpoint)
- [Receive and inspect a webhook](#receive-and-inspect-a-webhook)
- [Replay and work offline](#replay-and-work-offline)
- [Security and data ownership](#security-and-data-ownership)
- [Operations and troubleshooting](#operations-and-troubleshooting)
- [Develop and verify from source](#develop-and-verify-from-source)

## Before you start

You need a machine to host the server, a public HTTPS origin for providers and agents, and a macOS or Linux machine that can reach your local target. The released `pwr` and `pwr-agent` binaries do not require Bun; building from source does. Put the server behind a TLS-terminating reverse proxy and set `PUBLIC_URL` to that public `https://` origin.

Keep these credentials distinct:

| Credential                              | Used by                                 | Stored where                                           |
| --------------------------------------- | --------------------------------------- | ------------------------------------------------------ |
| Admin email/password                    | Admin browser; initial server bootstrap | Server auth DB                                         |
| Inbound key **or** provider HMAC secret | Provider ingress for one tunnel         | Inbound key hash or encrypted signing config on server |
| Outbound relay key                      | Agent WebSocket and scoped config sync  | Hash on server; raw key in agent's private local DB    |
| Target secret, if required              | Agent-to-target HTTP request            | Agent's private local DB only                          |

The server confirms that it stored a provider event before preparing deliveries. That response does **not** mean an agent received it or a target processed it.

## Deploy the server

From a server checkout:

```sh
cp .env.example .env
openssl rand -hex 32
```

Edit `.env`: set `PUBLIC_URL` to the public HTTPS origin, set `BETTER_AUTH_SECRET` to the generated random value, and set `ADMIN_EMAIL` and `ADMIN_PASSWORD` for the initial account. Generate a **separate** random 64-character hex value (`openssl rand -hex 32`) for `WEBHOOK_SIGNING_ENCRYPTION_KEY` if you will verify provider signatures. Set `TRUSTED_PROXIES` to the reverse proxy's actual IPs/CIDRs so rate limits, allow/deny lists, and sign-in throttling see the correct client IP. Do not commit `.env`. Then start the server:

```sh
docker compose up -d --build
```

Check `https://hooks.example.com/api/ready`, replacing the domain with your own. Open `https://hooks.example.com/admin`, sign in, create a tunnel such as `my-tunnel`, and issue one **inbound** key and one **outbound** key. Save each newly issued token immediately: its raw value is shown only once. The server's DB is mounted on a persistent volume; see [Operations](operations.md#databases-retention-and-upgrades) before upgrading it.

## Install and connect the agent

On the machine that can reach the local target:

```sh
curl -fsSL https://raw.githubusercontent.com/pockrew/pwr/main/install.sh | bash
pwr agent start
pwr agent status
printf '%s' "$RELAY_KEY" | pwr connect my-tunnel --server https://hooks.example.com --api-key -
pwr status
pwr studio
```

The installer verifies published binary checksums. Add `~/.local/bin` to `PATH` if your shell does not find `pwr`. To build from a checkout instead, run `./install.sh --from-source` with Bun installed. `pwr agent install-service` can start the daemon on login using launchd on macOS or `systemd --user` on Linux.

`$RELAY_KEY` is the **outbound** key. Passing it through stdin keeps it out of command arguments. `pwr connect` saves the connection and key in the local agent; `pwr status` shows whether the WebSocket subscription is connected or still retrying. `pwr studio` opens the local inspector with an HttpOnly session cookie. The agent listens on loopback only.

One agent owns a tunnel at a time. When intentionally moving it to another machine, run `printf '%s' "$RELAY_KEY" | pwr connect my-tunnel --server https://hooks.example.com --api-key - --takeover` (or **Take over** in Studio). The previous agent then stops reconnecting to that tunnel until you connect it again. Do not use takeover just to mask a failed connection; inspect `pwr agent logs` first.

## Create a collection and endpoint

Create the routing metadata locally, then attach a local target:

```sh
pwr collections create my-tunnel payments
pwr collections list my-tunnel
pwr endpoints create my-tunnel <collection-id> --path /hooks --target http://127.0.0.1:3000/hooks
pwr endpoints list my-tunnel
```

Use the ID returned by the collection command in place of `<collection-id>`. The agent saves local edits and automatically syncs collection and endpoint routing metadata to the server. The target URL stays on the agent; the server does not receive it.

If your target requires a secret, set the secret **together with** the target when creating or updating an endpoint. Work waiting for a target is released as soon as one is saved, so saving the target first could send it a request before a separately saved secret is available:

```sh
printf '%s' "$TARGET_SECRET" | pwr endpoints create my-tunnel <collection-id> \
  --path /hooks --target http://127.0.0.1:3000/hooks --secret - --header X-Target-Secret
```

Use either endpoint creation command, not both for the same endpoint. `--secret -` reads stdin; the target and secret commit together in the agent DB. To change an existing endpoint, use `pwr endpoints update` with its collection and endpoint IDs. The [API reference](api.md#agent-local-api) covers secret status, replacement, and removal.

## Receive and inspect a webhook

Configure the provider to call one of these public URLs:

| URL                                                           | Selection                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `https://hooks.example.com/ingress/my-tunnel/<collection-id>` | Every active matching endpoint in that collection gets its own delivery. |
| `https://hooks.example.com/ingress/my-tunnel/target/hooks`    | Endpoints whose path is `/hooks` match; more than one may match.         |

For the default mode, configure the provider to send the **inbound** key in `x-api-key`. The URL `/ingress/my-tunnel` alone is invalid. For providers that cannot add a custom header, enable signature verification in Admin (**Tunnel → Ingress authentication**): GitHub, Stripe, Standard Webhooks/Svix (Clerk, Resend…), Shopify, Slack, or a custom HMAC (header, algorithm, hex/base64 encoding and prefix, for providers such as Linear). The provider signature then **replaces** the inbound key; there is no key fallback. A failed signature creates no delivery and records an audit attempt (at most one per tunnel and minute) without storing the unverified payload.

After a provider request, inspect the agent:

```sh
pwr status
pwr inspect --tunnel my-tunnel
pwr inspect <event-id>
```

The server's HTTP 200 means the original event was stored. It creates one durable delivery per matching endpoint afterward. Offline agents leave deliveries `PENDING` on the server; reconnect sends them in batches. The agent stores a package before `ack_received`, stores the target result before `ack_relayed`, and reports a distinct `ack_replayed` for each replay. The server's `result_committed` frame confirms result persistence; it is not another business ACK. Studio shows the same local request and delivery history.

Every target call carries `X-PWR-Delivery-Id`; replay adds `X-PWR-Replay-Of`. Use these IDs to make your target idempotent: target execution is **at least once** across crashes and reconnects. Provider retries with the same supported provider delivery ID and ingress selector are stored once. Failed target calls are recorded as `FAILED`, not retried automatically.

## Replay and work offline

Inspect an event to find its delivery IDs, then replay the specific delivery you want:

```sh
pwr inspect <event-id>
pwr replay <delivery-id> --tunnel my-tunnel
```

A replay creates a new record and ID; it does not rewrite the original event. It uses the locally stored original body and the current target and secret for that **same endpoint**. If the event fanned out, replay each intended delivery separately. The agent can replay data it already holds while the server is offline and reports the outcome when it reconnects.

You can also create or edit collections and endpoints while offline. The agent persists those changes locally and syncs them later. If the same record changed on the server, the local version remains and a conflict is reported. Inspect it in Studio or the local config API, then choose deliberately:

```sh
pwr collections resolve my-tunnel <collection-id> --choice local
pwr endpoints resolve my-tunnel <collection-id> <endpoint-id> --choice server
```

`local` retries the local edit against the new server baseline; `server` accepts the server version. Choose per record. Neither choice moves target URLs or secrets to the server.

## Security and data ownership

- The agent's local API requires its private `agent.token` or Studio's session cookie and binds only to loopback. `pwr` reads the token from the agent data directory. Do not expose the agent listener through a public proxy.
- Target URLs, target secrets, and response bodies remain with the agent. The server stores routing and outcome metadata, not local target details.
- Use separate inbound and outbound keys. An outbound key manages collection/endpoint metadata only within its tunnel; management keys have explicit permissions. Only the admin account issues or revokes management keys. Audit reads by non-admin keys are scoped to their tunnel.
- Keep the relay connection on HTTPS/WSS outside localhost. A revoked outbound key disconnects its agent; reconnect requires a valid replacement.
- MCP is read-only by default. Enable replay only if needed with `[mcp] allow_replay = true` in `~/.pockrew/config.toml`.

See [Architecture](architecture.md) for the full data flow and [UI](ui.md) for Admin/Studio responsibilities.

## Operations and troubleshooting

Start with `pwr status`, `pwr agent logs`, server `/api/ready`, and `GET /api/tunnels/:id/delivery-status` (with a permitted management identity). The latter distinguishes unprepared events, unmatched events, pending deliveries, and deliveries blocked by config.

| Symptom                                          | Check                                                                                                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider got 200, but nothing reached the target | Confirm the ingress selector, active collection and endpoint, agent connection, and a local target for that endpoint. HTTP 200 only confirms server storage.                          |
| Provider got 4xx in signed mode                  | Check the configured provider, signing secret, raw-body signature, and the server's `ingress.hmac_failed` audit entry. Signed mode has no inbound-key fallback.                       |
| Agent cannot connect                             | Check the public URL and TLS, outbound key, IP rules, `pwr agent logs`, and whether a different agent owns the tunnel (`tunnel_in_use`). Use `--takeover` only when moving ownership. |
| Target failed or replay is unavailable           | Inspect the delivery result and local payload. Failures need explicit replay; replay requires a stored local event and a configured target.                                           |
| Agent reports `storage_blocked`                  | Free disk space or run `pwr clean` under the retention policy. Pending and unreported data are protected; the agent stops intake rather than sending a false receipt.                 |

The agent runs retention at startup, every minute, and during manual clean. Only eligible, server-confirmed terminal data is pruned; deduplication tombstones remain for 30 days. Back up the server and agent databases consistently before upgrades. See [Operations](operations.md#databases-retention-and-upgrades) for WAL/SHM and retention details. See [Known limitations](operations.md#known-limitations-v01) before relying on PWR for a large installation.

## Develop and verify from source

For a source checkout, install Bun and dependencies, configure the server from `.env.example`, then run:

```sh
bun install
bun run dev:server
bun run dev:local
bun run --cwd apps/admin dev
```

The server listens on `:18787` (`PORT`), the agent on loopback `:18788` (or a free port if that one is busy), Studio Vite on `:15174`, and Admin Vite at `http://localhost:15175/admin/`. Development Studio uses Vite/HMR; the production agent serves its embedded Studio build.

Before a release candidate:

```sh
bun run typecheck
bun run lint
bun run lint:rules
bun test
bun run build:all
bun run smoke
bun run notices:check
```

`bun run smoke` uses temporary databases and real processes to exercise ingress, delivery, replay, reconnect, deduplication, and key revocation. `bun run release` builds macOS/Linux binaries and checksums. Record actual verification results for the candidate; a passing unit suite does not replace the production-style smoke flow. See [Operations](operations.md#verify-changes) for build and upgrade details, and [Development rules](coding-rules.md) for package boundaries.
