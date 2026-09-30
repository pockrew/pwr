import { configRoutes } from "@agent/modules/config/routes";
import { logRoutes } from "@agent/modules/logs/routes";
import { mcpRoutes } from "@agent/modules/mcp/routes";
import { proxyRoutes } from "@agent/modules/proxy/routes";
import { relayRoutes } from "@agent/modules/relays/routes";
import { tunnelManager } from "@agent/modules/relays/service";
import { streamRoutes } from "@agent/modules/relays/stream.routes";
import { getStorageStatus } from "@agent/modules/storage/retention.service";
import { storageRoutes } from "@agent/modules/storage/routes";
import { updateRoutes } from "@agent/modules/updates/routes";
import {
  handleLocalError,
  localNotFound,
  requestIdOf,
  sendData,
} from "@agent/platform/error.handlers";
import { requestLifecycle } from "@agent/platform/lifecycle";
import { localAccessMiddleware, localCorsMiddleware } from "@agent/platform/local-access";
import { localAuthMiddleware, sessionLoginHandler } from "@agent/platform/local-auth";
import { apiRoots, mountFrontend } from "@agent/platform/runtime";
import { withContext } from "@logtape/logtape";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

import { PWR_VERSION } from "@pockrew/pwr-shared/libs";

const startTime = Date.now();

export const apiRouter = new Hono()
  .get("/health", (c) => {
    const tunnels = tunnelManager.getTunnels();
    const storage = getStorageStatus();
    return c.json({
      data: {
        status: storage.state === "blocked" ? "storage_blocked" : "ok",
        version: PWR_VERSION,
        storage,
        uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
        activeTunnelsCount: tunnels.filter((t) => t.status === "connected").length,
        totalTunnelsCount: tunnels.length,
      },
      requestId: requestIdOf(c),
    });
  })
  .post("/agent/stop", async (c) => sendData(c, await requestLifecycle("stop")))
  .post("/agent/restart", async (c) => sendData(c, await requestLifecycle("restart")))
  .route("/", relayRoutes)
  .route("/", configRoutes)
  .route("/", streamRoutes)
  .route("/", proxyRoutes)
  .route("/", storageRoutes)
  .route("/", logRoutes)
  .route("/", updateRoutes)
  .route("/", mcpRoutes);

/** Local API first; static production Studio is mounted last and shares the local-access guard. */
export const app = new Hono()
  .use(
    createMiddleware(async (c, next) => {
      const id = crypto.randomUUID();
      c.set("requestId", id);
      // Every log record written while handling this request carries its ID.
      await withContext({ requestId: id }, next);
      c.header("x-request-id", id);
    }),
  )
  .use(localAccessMiddleware)
  .use(localCorsMiddleware)
  .use(
    bodyLimit({
      maxSize: 256 * 1024,
      onError: () => {
        throw new HTTPException(413);
      },
    }),
  )
  .get("/auth", sessionLoginHandler)
  // Every API root needs the local token; liveness and static Studio assets do not.
  .use(async (c, next) => {
    const [first, second] = c.req.path.split("/").filter(Boolean);
    const root = first === "api" ? second : first;
    if (!root || !apiRoots.has(root) || root === "health") return next();
    return localAuthMiddleware(c, next);
  })
  .route("/api", apiRouter)
  .route("/", apiRouter)
  .route("/", mountFrontend())
  .notFound(localNotFound)
  .onError(handleLocalError);

export type AgentAppType = typeof app;
export type AgentApiType = typeof apiRouter;
