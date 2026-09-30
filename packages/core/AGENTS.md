# Core (`@pockrew/pwr-core`)

Core contains logic shared by server and agent: matching, payload and record conversion, forwarding, config comparison and sync, proxy resolution, and retention helpers. It does not start HTTP listeners or own SQLite storage.

## When changing this package

- Prefer pure functions with clear inputs and outputs. Use existing ports or callbacks for IO; transactions, sockets, and storage policy belong to the calling app. Do not add an abstraction for a single use case.
- Keep payload bodies as bytes; converters and forwarders must not parse and re-serialize them. Handle transport headers and target secrets at the correct boundary without losing the raw query.
- Make selectors and config comparison deterministic: identical inputs produce identical results. An offline conflict must not silently overwrite the local version. Retention helpers must not make pending or unreported data eligible for deletion.
- Import only `packages/shared` and declared dependencies. Do not reference source files in `apps/server`, `apps/agent`, the CLI, or frontends.
- Before changing a helper used by server and agent, check callers on both sides for signature or default changes. Do not keep parallel legacy ingress, relay, or replay engines.

## Verification

Run `bun run --cwd packages/core typecheck` and `bun test packages/core/src`. For payload, config, or retention changes, also run integration tests in the apps that use the helper.
