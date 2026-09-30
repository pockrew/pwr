# Shared (`@pockrew/pwr-shared`)

This package is the shared source for Zod schemas, DTOs, wire messages, error codes, and type helpers used by server, agent, and clients. It does not own IO or business orchestration.

## When changing this package

- Put contracts in `src/schemas` and export them through `src/schemas/index.ts` or `src/libs/index.ts`, consistent with the public exports in `package.json`. Do not import from apps, `packages/core`, or UI.
- A new wire field needs clear semantics, runtime validation, and consumers on the relevant sides. Do not redefine `ack_received`, `ack_relayed`, `ack_replayed`, or `result_committed` to combine distinct states.
- Keep success responses `{ data, requestId }` and error responses `{ code, requestId }` consistent. Schemas must not allow secrets into relay packages, ACKs, config sync, or list responses.
- Apply strict validation and sensible limits to HTTP and WebSocket input. Distinguish optional, nullable, and default values according to actual data; do not add speculative fields without consumers.
- Share only contracts and logic that are genuinely used across packages. Do not pull DB adapters, Bun servers, DOM APIs, or components into this package.

## Verification

Run `bun run --cwd packages/shared typecheck`, then test the server, agent, and CLI boundaries that use the changed schema. For wire message changes, also run WebSocket reconnect and ACK tests.
