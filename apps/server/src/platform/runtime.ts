import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";

import type { AppEnv } from "./types";

const stripPrefix = (prefix: string) => (path: string) =>
  path.startsWith(prefix) ? path.slice(prefix.length) : path;

const serverRoots = new Set(["api", "ingress", "relay"]);

/**
 * Serves immutable assets with 1 year cache.
 * @param root Root directory of static files.
 * @param prefix URL prefix to strip from paths.
 * @returns Hono handler for immutable assets.
 */
export const immutableAssets = (root: string, prefix = "") =>
  serveStatic({
    root,
    rewriteRequestPath: stripPrefix(prefix),
    onFound: (_path, c) => {
      c.header("Cache-Control", "public, max-age=31536000, immutable");
    },
  });

/**
 * Serves static assets with no cache.
 * @param root Root directory of static files.
 * @param prefix URL prefix to strip from paths.
 * @returns Hono handler for static assets.
 */
export const staticFiles = (root: string, prefix = "") =>
  serveStatic({
    root,
    rewriteRequestPath: stripPrefix(prefix),
  });

/**
 * Serves single page application fallback.
 * @param root Root directory of SPA.
 * @returns Hono handler for SPA.
 */
export const spaFallback = (root: string) =>
  serveStatic({
    root,
    path: "index.html",
    onFound: (_path, c) => {
      c.header("Cache-Control", "no-cache");
    },
  });

/**
 * Resolves the absolute directory path of the Admin SPA build.
 * Checks explicit parameter, ADMIN_DIST_DIR environment variable,
 * or relative to import.meta.dir and workspace directories.
 *
 * @param explicitRoot - Optional explicit directory path.
 * @returns Resolved directory containing index.html, or default public path.
 */
export const resolvePublicDir = (explicitRoot?: string): string => {
  if (explicitRoot) {
    const direct = resolve(explicitRoot);
    if (existsSync(resolve(direct, "index.html"))) {
      return direct;
    }
  }

  const envDist = process.env["ADMIN_DIST_DIR"];
  if (envDist) {
    const direct = resolve(envDist);
    if (existsSync(resolve(direct, "index.html"))) {
      return direct;
    }
  }

  const candidates = [
    resolve(import.meta.dir, "../../public"),
    resolve(process.cwd(), "apps/server/public"),
    resolve(process.cwd(), "public"),
  ];

  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, "index.html"))) {
      return candidate;
    }
  }

  return resolve(import.meta.dir, "../../public");
};

/**
 * Mounts frontend routes for the Admin SPA.
 * Never intercepts backend API, Ingress, or Relay routes.
 *
 * @param root Optional root directory of SPA.
 * @returns Hono application.
 */
export const mountFrontend = (root?: string) => {
  const ui = new Hono<AppEnv>();
  const targetDir = resolvePublicDir(root);

  // If index.html is absent, return an unmounted router so backend requests pass through unharmed.
  if (!existsSync(resolve(targetDir, "index.html"))) {
    return ui;
  }

  const immutableAdmin = immutableAssets(targetDir, "/admin");
  const immutableRoot = immutableAssets(targetDir);
  const staticAdmin = staticFiles(targetDir, "/admin");
  const staticRoot = staticFiles(targetDir);
  const spa = spaFallback(targetDir);

  return (
    ui
      // 1. Explicitly ignore backend API, Ingress, and Relay routes
      .use("*", (c, next) => {
        const rootSegment = c.req.path.split("/")[1] ?? "";
        if (serverRoots.has(rootSegment)) {
          return next();
        }
        return next();
      })
      // 2. Redirect root / to /admin/ where Admin SPA is mounted
      .get("/", (c) => c.redirect("/admin/"))
      // 3. Serve immutable compiled assets for both /admin/assets/* and /assets/*
      .use("/admin/assets/*", immutableAdmin)
      .use("/assets/*", immutableRoot)
      // 4. Serve favicon and icons
      .use("/admin/favicon.ico", staticAdmin)
      .use("/favicon.ico", staticRoot)
      // 5. Serve static files under /admin/*
      .use("/admin/*", staticAdmin)
      .use("/*", staticRoot)
      // 6. Navigation fallback for /admin routes
      .get("/admin", (c) => c.redirect("/admin/"))
      .get("/admin/*", spa)
      // 7. General navigation fallback for HTML page requests (non-file, non-server-root)
      .get("*", async (c, next) => {
        const rootSegment = c.req.path.split("/")[1] ?? "";
        if (serverRoots.has(rootSegment)) {
          return next();
        }
        const hasExtension = c.req.path.split("/").at(-1)?.includes(".");
        const isHtml = c.req.header("accept")?.includes("text/html");
        if (hasExtension || !isHtml) {
          return next();
        }
        return (await spa(c, next)) ?? c.res;
      })
  );
};
