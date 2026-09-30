// Replaced at release build time by scripts/release.ts with `with { type: "file" }` imports of
// the Studio build, so the compiled pwr-agent binary serves Studio without files beside it.
// Empty in development and tests, where Studio is served from disk (or Vite).

/** URL path (e.g. "/index.html", "/assets/app.js") to embedded file path. */
export const embeddedStudio: Record<string, string> = {};
