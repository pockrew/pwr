# PWR — Pocket Webhook Relay

**Website:** [pockrew.github.io/pwr](https://pockrew.github.io/pwr/) · **Releases:** [github.com/pockrew/pwr/releases](https://github.com/pockrew/pwr/releases)

PWR is a self-hosted webhook relay. A server you run receives and stores provider webhooks; a local agent on your machine receives the deliveries, calls **your** local target, and keeps history for inspection and replay. The `pwr` CLI and the local Studio UI work with the agent; the Admin UI manages the server.

```text
Provider ──HTTP──> Server/SQLite ──WebSocket──> Agent/SQLite ──HTTP──> Local target
                             Admin ──API──> Server     CLI/Studio/MCP ──local API──> Agent
```

The server reports success after **storing the original event**; deliveries are prepared separately and recovered if the process stops in between. An offline agent loses nothing: pending deliveries wait on the server. Payload bytes are never parsed, rewritten or re-signed.

## Contents

- [Install the CLI and agent](#install-the-cli-and-agent)
- [Run the server](#run-the-server)
- [Getting started](#getting-started)
- [Security model](#security-model)
- [Delivery guarantees](#delivery-guarantees)
- [Known limits](#known-limits-v01)
- [Documentation](#documentation)
- [License](#license)

## Install the CLI and agent

macOS and Linux (x64, arm64):

```sh
curl -fsSL https://raw.githubusercontent.com/pockrew/pwr/main/install.sh | bash
```

Windows (x64, arm64), in PowerShell:

```powershell
irm https://raw.githubusercontent.com/pockrew/pwr/main/install.ps1 | iex
```

The installer downloads `pwr` and `pwr-agent` from [GitHub Releases](https://github.com/pockrew/pwr/releases), verifies them against `SHA256SUMS`, and installs to `~/.local/bin` (`--prefix <dir>` to change, `--version vX.Y.Z` to pin). On Windows it installs to `%LOCALAPPDATA%\Programs\pwr` and adds it to the user `PATH` (`-Prefix`, `-Version`). Studio is embedded in `pwr-agent`. To build from a checkout instead: `./install.sh --from-source` or `.\install.ps1 -FromSource` (requires [Bun](https://bun.sh)).

## Run the server

```sh
cp .env.example .env   # set PUBLIC_URL, BETTER_AUTH_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
docker compose up -d --build
```

Run it behind a TLS-terminating reverse proxy, set `PUBLIC_URL` to its `https://` origin and `TRUSTED_PROXIES` to the proxy's address. Admin is at `${PUBLIC_URL}/admin`. See [Operations](docs/operations.md).

## Getting started

1. In Admin, create a tunnel (e.g. `my-tunnel`) and issue an **inbound** key (for providers) and an **outbound** key (for your agent).
2. On your machine:

   ```sh
   pwr agent start
   printf '%s' "$RELAY_KEY" | pwr connect my-tunnel --server https://hooks.example.com --api-key -
   pwr collections create my-tunnel payments
   pwr endpoints create my-tunnel <collection-id> --path /hooks --target http://127.0.0.1:3000/hooks
   pwr studio
   ```

3. Point the provider at `https://hooks.example.com/ingress/my-tunnel/<collection-id>` with the inbound `x-api-key`. Providers that cannot add a header use signature verification instead (Admin → tunnel → **Ingress authentication**): GitHub, Stripe, Standard Webhooks/Svix, Shopify, Slack, or a custom HMAC. An ingress URL always needs a collection ID or `/target/<path>`.

`pwr agent install-service` starts the agent on login (launchd on macOS, `systemd --user` on Linux, a per-user Run entry on Windows). `pwr help` lists all commands.

## Security model

- **Targets and secrets are agent-owned.** The server routes by collection/path only; it never sees, sets or learns target URLs, target secrets, or response bodies. Only outcome metadata (status, latency, size) is reported upstream.
- **The agent listens on loopback only** and requires a local token (`~/.pockrew/agent.token`, 0600). The CLI reads it; `pwr studio` signs Studio in with an HttpOnly session cookie. Agent files are private to your OS user.
- **One active agent per tunnel.** A second agent is rejected; use `pwr connect … --takeover` to move a tunnel to another machine.
- **MCP is read-only by default.** Enable replay through MCP with `allow_replay = true` under `[mcp]` in `~/.pockrew/config.toml`.
- Relay keys are sent only over `https://` (plain `http://` is allowed for `localhost`).

## Delivery guarantees

PWR delivers **at least once** to your target. Every target request carries `X-PWR-Delivery-Id` (and `X-PWR-Replay-Of` for replays) so your handler can deduplicate. Provider retries carrying the same delivery ID (`X-GitHub-Delivery`, Stripe event `id`, `webhook-id`/`svix-id`, `X-Shopify-Webhook-Id`) are stored once per ingress URL. Deliveries run in the order the server received them. A failed target call is recorded as `FAILED` and is not retried automatically; replay it from Studio or `pwr replay`.

## Known limits (v0.1)

- On Windows, `install-service` has no service manager behind it: a crashed agent is not relaunched until the next sign-in or `pwr` command that needs it, and a console window shows briefly at sign-in.
- Failed target calls are not retried automatically, and there is no bulk replay.
- Deliveries on one tunnel run sequentially; the target timeout is 10 seconds.
- One server process (in-memory relay registry and rate limits) and one admin account.
- Secrets are stored in the agent's SQLite file (owner-only permissions), not the OS keychain.

The full list, including signature-scheme caveats, is in [Operations → Known limitations](docs/operations.md#known-limitations-v01).

## Documentation

- [Complete user guide](docs/guide.md): deploy, connect, route, inspect, replay, troubleshoot, and verify a release.
- [Architecture and core flows](docs/architecture.md)
- [API and CLI](docs/api.md)
- [Operations](docs/operations.md)
- [UI](docs/ui.md)
- [Development rules](docs/coding-rules.md)

## License

Source-available under the [PolyForm Noncommercial License 1.0.0 with a Small Company Permission](LICENSE). You may use, modify and redistribute PWR free of charge for:

- personal and hobby use, and noncommercial organizations such as charities, schools, public research and government;
- the benefit of a company with **10 or fewer people** (employees and independent contractors, counting parent and sister companies), including commercial work.

Larger companies need a commercial license: contact us through [github.com/pockrew/pwr](https://github.com/pockrew/pwr). This summary is for convenience; the [license text](LICENSE) governs.

PWR includes third-party open-source packages under their own licenses; see [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt), which ships with every release and Docker image.
