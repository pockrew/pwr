# CLI (`@pockrew/pwr-cli`)

`pwr` parses commands and acts as a client of the local agent. The agent owns the DB, relay, replay, and configuration; the CLI calls the corresponding API. Consult `../../docs/api.md` when changing a command or response.

## When changing this package

- Keep parsing and dispatch in `src/index.ts`, command groups in `src/commands`, and HTTP/SSE clients and daemon lifecycle code in `src/client`. Do not add a business engine, query the DB directly, or connect to providers or the relay server on the agent's behalf.
- Keep the `pwr` command name. Collection, endpoint, secret, replay, inspect, proxy, maintenance, and status commands must map to the current agent API. Remove commands for obsolete config flows instead of maintaining parallel paths.
- Read secrets and keys from stdin or another safe input channel, never from argv. Do not expose them in output, exceptions, or URLs. Show a secret only when the user has just issued it and the API deliberately returns it once.
- Handle the standard HTTP error envelope consistently; do not report success when the agent rejects a request or is offline. Close streams cleanly when the user stops them.
- Change the API contract in `packages/shared` or `apps/agent` before updating a parser to call it. Do not copy validators or infer response fields without a contract.

## Verification

Run `bun run --cwd apps/cli typecheck`, `bun test apps/cli/src`, and exercise the changed command against a local agent. For daemon lifecycle changes, verify start, stop, and reconnect without losing the agent DB.
