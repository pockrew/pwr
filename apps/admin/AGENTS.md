# Admin (`@pockrew/pwr-admin`)

Admin is the server management frontend for Better Auth sign-in, tunnels, keys, audit logs, and other server management screens. It does not manage local target secrets or run the relay. Consult `../../docs/ui.md` and `../../docs/api.md` when adding a screen.

## When changing this package

- Call the server API through `src/libs/api-client.ts` and shared contracts. Never import server DB access, services, or runtime secrets into browser code. The admin session determines permissions; UI state does not grant access.
- Show a key only when the creation API returns its token once. Do not persist tokens in localStorage, URLs, logs, or durable state. Make authentication and revocation errors clear.
- An ingress URL must include a real selector (`/:collectionId` or `/target/:path`) for the selected tunnel or endpoint. Do not construct one from the tunnel slug alone.
- Display only audit data scoped by the API to the current actor. Paginate lists beyond their page limit; do not treat the first page as the complete dataset.
- Use the existing theme and `packages/ui` components. Keep management UI concise and do not duplicate Studio's local inspector. Admin routes live under `/admin` and must work when the production server serves static files.
- Show a success toast only after the server succeeds. Use the standard error response envelope; do not turn failures into fabricated success states.

## Verification

Run `bun run --cwd apps/admin typecheck` and `bun run --cwd apps/admin build`. For sign-in, URL, or routing changes, verify both Vite development mode and the production server at `/admin`.
