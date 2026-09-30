import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";

import { embeddedStudio } from "./studio-assets";

// Bun compile replaces direct process.env.NODE_ENV reads with the build-time value.
// Read through the environment object so the installed binary still selects its runtime mode.
const runtimeEnv = process.env;

/**
 * Resolve a production Studio build without depending on the caller's working directory.
 * @returns Explicit STUDIO_DIST_DIR, packaged sibling studio/, or the workspace Studio dist.
 * @throws If an explicit build directory is invalid, avoiding an accidental stale fallback.
 */
export const resolveStudioDist = (): string | undefined => {
  const explicit = process.env["STUDIO_DIST_DIR"];
  if (explicit) {
    const root = resolve(explicit);
    if (!existsSync(resolve(root, "index.html")))
      throw new Error("STUDIO_DIST_DIR must contain a Studio build (index.html)");
    return root;
  }
  return [
    resolve(dirname(process.execPath), "studio"),
    resolve(import.meta.dir, "../../../studio/dist"),
  ].find((root) => existsSync(resolve(root, "index.html")));
};

// These paths belong to the daemon, even when no matching method/handler exists.
export const apiRoots = new Set([
  "api",
  "agent",
  "health",
  "logs",
  "tunnels",
  "requests",
  "replay",
  "events",
  "proxy",
  "retention",
  "maintenance",
  "mcp",
  "updates",
]);

/**
 * Mount production static files after API routes. Development/test never load a Studio build.
 * @param mode - NODE_ENV, or production for a standalone binary; Vite owns development HTML/HMR.
 * @param root - Optional explicit root for a packaged build or isolated test.
 * @returns Static router; absent builds/API paths/missing assets return 404 instead of HTML.
 */
export const mountFrontend = (mode = runtimeEnv["NODE_ENV"] ?? "production", root?: string) => {
  const ui = new Hono();
  if (mode !== "production") return ui;
  if (!root && Object.keys(embeddedStudio).length > 0) return mountEmbeddedStudio(ui);
  const directory = root ?? resolveStudioDist();
  if (!directory) return ui;
  const files = serveStatic({
    root: directory,
    onFound: (_path, c) => {
      c.header(
        "Cache-Control",
        c.req.path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      );
    },
  });
  const spa = serveStatic({
    root: directory,
    path: "index.html",
    onFound: (_path, c) => c.header("Cache-Control", "no-cache"),
  });
  return (
    ui
      // 1. Never mask an unknown API with the SPA entry page.
      .get("*", (c, next) => (apiRoots.has(c.req.path.split("/")[1] ?? "") ? c.notFound() : next()))
      .get("/assets/*", files, (c) => c.notFound())
      // 2. Serve real files first. Missing assets stay 404; only navigation gets the SPA fallback.
      .get("*", files, async (c, next) => {
        if (
          c.req.path.split("/").at(-1)?.includes(".") ||
          !c.req.header("accept")?.includes("text/html")
        )
          return c.notFound();
        return (await spa(c, next)) ?? c.res;
      })
  );
};

/** Serve an embedded file with the same cache policy as the on-disk build. */
const embeddedResponse = (path: string, embedded: string): Response => {
  const file = Bun.file(embedded);
  return new Response(file, {
    headers: {
      "content-type": file.type,
      "cache-control": path.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    },
  });
};

/**
 * Serve Studio from files embedded in the compiled binary, with the same routing rules as the
 * on-disk build: API roots are never masked, missing assets 404, navigation gets index.html.
 */
const mountEmbeddedStudio = (ui: Hono): Hono =>
  ui.get("*", (c) => {
    const path = c.req.path === "/" ? "/index.html" : c.req.path;
    if (apiRoots.has(path.split("/")[1] ?? "")) return c.notFound();
    const embedded = embeddedStudio[path];
    if (embedded) return embeddedResponse(path, embedded);
    const index = embeddedStudio["/index.html"];
    if (
      !index ||
      path.startsWith("/assets/") ||
      path.split("/").at(-1)?.includes(".") ||
      !c.req.header("accept")?.includes("text/html")
    )
      return c.notFound();
    return embeddedResponse("/index.html", index);
  });
