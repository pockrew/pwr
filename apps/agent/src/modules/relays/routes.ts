import { configScope } from "@agent/modules/config/repository";
import {
  getRequest,
  listDeliveries,
  listRequests,
  replayRequest,
} from "@agent/modules/storage/service";
import { sendData } from "@agent/platform/error.handlers";
import { requireValidation } from "@agent/platform/validator.middleware";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  AgentDeliveryListSchema,
  AgentRelayConnectSchema,
  AgentRelayDrainSchema,
  AgentRelayKeySchema,
  AgentRelayTestSchema,
  AgentReplayRequestSchema,
  AgentRequestIdSchema,
  AgentRequestListSchema,
  AgentRequestScopeQuerySchema,
  AgentTunnelIdSchema,
} from "@pockrew/pwr-shared/schemas";

import { checkRelayKey } from "./client";
import { deleteRelayKey, relayApiKey, relayKeyStatus } from "./credentials.repository";
import { tunnelManager } from "./service";

/** Local relay HTTP edge. Existing local-access middleware is applied by app.ts before mounting. */
export const relayRoutes = new Hono()
  .get("/tunnels", (c) => sendData(c, { tunnels: tunnelManager.getTunnels() }))
  .post("/tunnels/connect", requireValidation("json", AgentRelayConnectSchema), (c) => {
    const body = c.req.valid("json");
    tunnelManager.connect(body);
    return sendData(c, { tunnelId: body.tunnelId, status: "connecting" });
  })
  // Checks a key before connecting; the key is not stored.
  .post("/tunnels/test", requireValidation("json", AgentRelayTestSchema), async (c) =>
    sendData(c, await checkRelayKey(c.req.valid("json"))),
  )
  .post("/tunnels/disconnect", requireValidation("json", AgentTunnelIdSchema), (c) => {
    const { tunnelId } = c.req.valid("json");
    tunnelManager.disconnect(tunnelId);
    return sendData(c, { tunnelId, status: "disconnected" });
  })
  .post("/tunnels/:tunnelId/pause", requireValidation("param", AgentTunnelIdSchema), (c) => {
    const { tunnelId } = c.req.valid("param");
    if (!tunnelManager.pauseTunnel(tunnelId)) throw new HTTPException(404);
    return sendData(c, { tunnelId, isPaused: true });
  })
  .post(
    "/tunnels/:tunnelId/resume",
    requireValidation("param", AgentTunnelIdSchema),
    requireValidation("json", AgentRelayDrainSchema),
    async (c) => {
      const { tunnelId } = c.req.valid("param");
      const drainResult = await tunnelManager.resumeTunnel(tunnelId, c.req.valid("json"));
      if (!drainResult) throw new HTTPException(404);
      return sendData(c, { tunnelId, isPaused: false, drainResult });
    },
  )
  .post(
    "/tunnels/:tunnelId/drain",
    requireValidation("param", AgentTunnelIdSchema),
    requireValidation("json", AgentRelayDrainSchema),
    async (c) => {
      const { tunnelId } = c.req.valid("param");
      if (!tunnelManager.getTunnel(tunnelId)) throw new HTTPException(404);
      const drainResult = await tunnelManager.drainTunnel(tunnelId, c.req.valid("json"));
      return sendData(c, { tunnelId, drainResult });
    },
  )
  .get("/tunnels/:tunnelId", requireValidation("param", AgentTunnelIdSchema), (c) => {
    const tunnel = tunnelManager.getTunnel(c.req.valid("param").tunnelId);
    if (!tunnel) throw new HTTPException(404);
    return sendData(c, { tunnel });
  })
  .get("/tunnels/:tunnelId/relay-key", requireValidation("param", AgentTunnelIdSchema), (c) =>
    sendData(c, relayKeyStatus(configScope(c.req.valid("param").tunnelId))),
  )
  .put(
    "/tunnels/:tunnelId/relay-key",
    requireValidation("param", AgentTunnelIdSchema),
    requireValidation("json", AgentRelayKeySchema),
    (c) => {
      const scope = configScope(c.req.valid("param").tunnelId);
      relayApiKey(scope, c.req.valid("json").apiKey);
      return sendData(c, relayKeyStatus(scope));
    },
  )
  .delete("/tunnels/:tunnelId/relay-key", requireValidation("param", AgentTunnelIdSchema), (c) => {
    const id = c.req.valid("param").tunnelId;
    const scope = configScope(id);
    // Disable restore/reconnect before removing the transport credential; received work stays local.
    tunnelManager.disconnect(id);
    deleteRelayKey(scope);
    return sendData(c, relayKeyStatus(scope));
  })
  .get("/requests", requireValidation("query", AgentRequestListSchema), (c) =>
    sendData(c, listRequests(c.req.valid("query"))),
  )
  .get(
    "/requests/:id",
    requireValidation("param", AgentRequestIdSchema),
    requireValidation("query", AgentRequestScopeQuerySchema),
    (c) => sendData(c, getRequest(c.req.valid("param").id, c.req.valid("query"))),
  )
  .get(
    "/requests/:id/deliveries",
    requireValidation("param", AgentRequestIdSchema),
    requireValidation("query", AgentDeliveryListSchema),
    (c) => sendData(c, listDeliveries(c.req.valid("param").id, c.req.valid("query"))),
  )
  .post(
    "/replay/:id",
    requireValidation("param", AgentRequestIdSchema),
    requireValidation("json", AgentReplayRequestSchema),
    requireValidation("query", AgentRequestScopeQuerySchema),
    async (c) => {
      // Source IDs select one endpoint; every accepted replay gets a distinct persisted ID.
      const delivery = await replayRequest(c.req.valid("param").id, c.req.valid("query"));
      return sendData(c, { delivery });
    },
  );
