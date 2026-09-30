# UI: Admin and Studio

Both frontends use the existing theme and components in `packages/ui`; do not change core flows solely for UI needs. The intended direction combines concise configuration navigation and tables like Supabase Studio with clear request, response, delivery, and replay inspection like Postman. Do not add an analytics dashboard or request builder before release.

## Admin: server client

Admin uses Better Auth cookies and calls the server's `/api/*` routes. Browser routes include `/admin/login`, `/admin` (tunnel list), `/admin/tunnels/:tunnelId` (detail with delivery status, ingress auth, collections/endpoints), `/admin/tunnels/:tunnelId/keys`, `/admin/audit`, and `/admin/logs`. Users can create, update, and delete tunnels; configure ingress signing; manage keys, collections, and endpoints; view audit records and server logs; and page through lists.

Tunnel detail shows delivery status counts, ingress authentication (API key or signed: GitHub, Stripe, standard webhooks, Shopify, Slack, custom HMAC; a saved custom HMAC secret can be kept while its options change, and signed modes are disabled until the server has `WEBHOOK_SIGNING_ENCRYPTION_KEY`), and collections/endpoints with ingress URLs, pause/resume, and delete. Routes are compact: one tunnel detail page for all settings and management. Management UI uses tunnel IDs; public ingress/relay URLs use slugs. An ingress URL includes `/:collectionId` or `/target/:path`. Soft-deleted collections/endpoints are removed on the agent's next sync.

Admin does not read or store target secrets, execute local replay, or configure agent proxy/retention. A newly issued token is shown only once; never put it in a URL, log, or localStorage. Only the admin account may issue or revoke management keys.

## Studio: local agent client

Studio has `/` (requests), `/endpoints`, `/settings`, and `/compare` routes. The authoritative data source is the agent's local API/SQLite and SSE; the CLI and MCP see the same data. Original requests are read-only; live deliveries and individual replays are separate records. When an event fans out to multiple endpoints, replay must select a specific delivery and endpoint. Tunnel settings pause/resume deliveries, disconnect, and take over a tunnel from another agent. Show `completedAt` and `reportedAt` separately to distinguish a local result from server commit confirmation.

Local collections and endpoints can be edited while the server is offline and show `pending`/`conflict` states; users choose to keep local or take server changes (not via timestamps). The request inspector has a Deliveries tab listing each endpoint delivery and replay with target, HTTP result, latency, and server confirmation. Target URLs and secrets are entered only through the Agent API (agent-owned, never synced); read-only views show `configured` status and header name. Offline replay uses the locally stored payload; target failures or disk pressure are reported accurately.

Keep localStorage for presentation preferences such as theme, panel width, or filters. Do not use it as a database for requests, config, or secrets; do not call local targets directly from the browser or report fabricated success when the agent is unreachable.

## Logo and theme

The original `logo.png` was cropped **without changing its pixels** into `logo-icon.png`, `logo-mark.png`, and `logo-wordmark.png` in `apps/admin/public/assets` and `apps/studio/public/assets`. The PNGs preserve transparent alpha on the outer canvas; the logo's colors and shapes were not changed. The brown background inside the icon remains part of the artwork. The dark mark and wordmark need a sufficiently light surface on a dark theme; do not recolor the assets to solve contrast.

Prefer the existing `background`, `surface`, `border`, `foreground`, and `muted` tokens. Pair status colors with text or icons and preserve focus and keyboard navigation. On narrow screens, switch between list and detail views; do not force multiple columns or add motion that does not serve the primary task.
