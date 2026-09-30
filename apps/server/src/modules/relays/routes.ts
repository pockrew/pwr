import { createIpFilter } from "@core/index";
import { findTunnel } from "@server/modules/ingress/service";
import { requestIdOf, sendError } from "@server/platform/error.handlers";
import { apiKeyGuard } from "@server/platform/guards/api-key.guard";
import { log } from "@server/platform/logger.middleware";
import { resolveClientIp } from "@server/platform/securities.middleware";
import type { AppEnv } from "@server/platform/types";
import { requireParamValidation } from "@server/platform/validator.middleware";
import { Hono } from "hono";
import { upgradeWebSocket, websocket } from "hono/bun";
import { createMiddleware } from "hono/factory";
import z from "zod";

import {
  ErrorCodes,
  RELAY_AGENT_ID_HEADER,
  RELAY_TAKEOVER_HEADER,
} from "@pockrew/pwr-shared/schemas";

import { relayService } from "./service";

export { websocket };

const relaySlugParam = requireParamValidation(
  z.object({
    slug: z.string(),
  }),
);

/** Resolves the tunnel by slug and applies its agent IP allow/deny lists before key auth. */
const relayIpGuard = createMiddleware<AppEnv, "/:slug">(async (c, next) => {
  // find tunnels (the slug param is validated by relaySlugParam first)
  const tunnel = await findTunnel(c.req.param("slug"));

  c.set("actor", {
    ...c.get("actor"),
    tunnelId: tunnel.id,
  });

  if (tunnel.allowedAgentIps || tunnel.deniedAgentIps) {
    const clientIp = resolveClientIp(c);

    const relayIPFilters = createIpFilter({
      allowlist: tunnel.allowedAgentIps?.split(",") || [],
      denylist: tunnel.deniedAgentIps?.split(",") || [],
    });

    if (!relayIPFilters.isAllowed(clientIp)) {
      const requestId = requestIdOf(c);
      log.warn({ event: "request.ip_forbidden", clientIp }, requestId);
      return sendError(c, ErrorCodes.IP_FORBIDDEN, 403);
    }
  }

  await next();
});

export const relayRoutes = new Hono<AppEnv>()
  // Side-effect-free credential check for agents: same IP and key rules as the handshake, but no
  // socket is registered, so it never replaces the tunnel's active agent or releases deliveries.
  .get("/:slug/check", relaySlugParam, relayIpGuard, apiKeyGuard("outbound"), (c) =>
    c.json({ data: { slug: c.req.valid("param").slug }, requestId: requestIdOf(c) }),
  )
  .get(
    "/:slug",
    relaySlugParam,
    relayIpGuard,
    apiKeyGuard("outbound"),
    upgradeWebSocket((c) => {
      const actor = c.get("actor");
      const tunnelId = actor.tunnelId;
      if (!tunnelId) throw new Error("Missing authenticated tunnel");
      return {
        onOpen: (_evt, ws) => {
          if (ws.raw && typeof ws.raw.data === "object" && ws.raw.data !== null) {
            Object.assign(ws.raw.data, { tunnelId, subscribedAt: Date.now() });
            relayService.register(tunnelId, ws.raw, {
              keyId: actor.id,
              resultReceipts: c.req.header("x-relay-result-receipts") === "1",
              acceptDeliveries: c.req.header("x-relay-accept-deliveries") !== "0",
              agentId: c.req.header(RELAY_AGENT_ID_HEADER)?.slice(0, 128),
              takeover: c.req.header(RELAY_TAKEOVER_HEADER) === "1",
            });
          }
        },

        onMessage: (evt, ws) => {
          if (ws.raw) {
            relayService.acknowledge(tunnelId, ws.raw, evt.data);
          }
        },
        onClose: (_evt, ws) => {
          if (ws.raw) {
            relayService.unregister(tunnelId, ws.raw);
          }
        },
      };
    }),
  );
