# UI (`@pockrew/pwr-ui`)

This package contains shared Solid components, icons, utilities, and theme styles for Admin and Studio. It has no knowledge of server or agent APIs or app-specific business state.

## When changing this package

- Put primitives in `src/core`, icons in `src/icons`, utilities in `src/libs`, and design tokens in `src/styles.css`. Export only APIs that are actually used through the entry points in `package.json`.
- Components receive props and callbacks; they do not fetch data, read cookies or localStorage, or import app services. Keep screen-specific logic in the relevant Admin or Studio app.
- Use the current theme and tokens, preserving light/dark modes, focus, keyboard behavior, labels, and disabled/error states. Check both frontends after changing a shared component.
- Do not put API keys, target secrets, webhook payloads, or persistence in shared components. This package only presents data supplied by its callers.
- Avoid dependencies or variants needed by only one screen; keep a component local to its app until there is a real reuse case.

## Verification

Run `bun run --cwd packages/ui typecheck`, `bun run --cwd apps/admin build`, and `bun run --cwd apps/studio build`. For visual changes, inspect the component in Admin and Studio under both themes.
