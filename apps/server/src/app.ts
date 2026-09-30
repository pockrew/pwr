// @server-only

import { Hono } from "hono";
import { timeout } from "hono/timeout";

import { auditRoutes } from "./modules/audit/routes";
import { authRoutes } from "./modules/auth/routes";
import { healthRoutes } from "./modules/health/health.routes";
import { ingressRoutes } from "./modules/ingress/routes";
import { logRoutes } from "./modules/logs/routes";
import { relayRoutes, websocket } from "./modules/relays/routes";
import { tunnelManagementRoutes } from "./modules/tunnels/routes";
import { apiNotFound, handleError } from "./platform/error.handlers";
import { loggerMiddleware } from "./platform/logger.middleware";
import { mountFrontend } from "./platform/runtime";
import {
  corsMiddleware,
  createBodyLimitMiddleware,
  requestIdMiddleware,
} from "./platform/securities.middleware";
import type { AppEnv } from "./platform/types";

const MAX_API_BODY_BYTES = 256 * 1024; // Management API only; ingress has its own limit.

export const api = new Hono<AppEnv>()
  .use(createBodyLimitMiddleware(MAX_API_BODY_BYTES))
  .use(timeout(15_000))
  .route("/auth", authRoutes)
  .route("/tunnels", tunnelManagementRoutes)
  .route("/audit", auditRoutes)
  .route("/logs", logRoutes)
  .route("/", healthRoutes)
  .all("*", apiNotFound);

export type ApiType = typeof api;

const ui = mountFrontend("./public");

export const app = new Hono<AppEnv>()
  // Provider ingress includes real OPTIONS requests; preflight handling must not bypass storage.
  .use((c, next) =>
    c.req.path === "/ingress" || c.req.path.startsWith("/ingress/")
      ? next()
      : corsMiddleware(c, next),
  )
  .use(loggerMiddleware)
  .use(requestIdMiddleware)
  .route("/api", api)
  .route("/ingress", ingressRoutes)
  .route("/relay", relayRoutes)
  .route("/", ui)
  .onError(handleError);

export type AppType = typeof app;
export { websocket };
