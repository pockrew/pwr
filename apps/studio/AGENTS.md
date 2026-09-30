# Studio (`@pockrew/pwr-studio`)

Studio is the local frontend for the agent: it shows requests and deliveries and manages replay, collections, endpoints, proxy settings, and retention. The agent API and DB are the source of truth. Consult `../../docs/ui.md` and `../../docs/api.md` when adding a screen.

## When changing this package

- Call the agent through `src/libs/api-client` and queries/mutations in `src/libs/queries`. Do not call server management APIs directly or run a relay/replay engine in the browser.
- Do not present mock seeds, localStorage, or optimistic fallbacks as real data when the agent returns an empty response or an error. Show empty, offline, and error states clearly; report mutation success only after the agent commits it. Delete and toggle actions must call the API, not merely edit the query cache.
- Send target secrets only to the agent for storage in its local DB. Do not keep them in query caches, localStorage, logs, URLs, or list responses; sensitive input state should exist only in the form that needs it.
- The inspector must distinguish events, individual deliveries, the three business ACKs, and replay records. Preserve original bytes and query data when inspecting or replaying; do not offer payload or target overrides that the agent API does not support.
- Use the existing theme and `packages/ui` components. Aim for concise configuration navigation like Supabase Studio and a clear request/response inspector like Postman. Do not change core behavior to accommodate presentation.
- Development uses Vite/HMR; the production agent serves the Studio build at its root. API paths must work in both modes, and the SPA fallback must not hide API errors or missing assets.

## Verification

Run `bun run --cwd apps/studio typecheck` and `bun run --cwd apps/studio build`. For create, update, or replay changes, test agent success, 4xx/5xx, and offline responses; confirm the UI does not claim a save succeeded or display fabricated data after a failure.
