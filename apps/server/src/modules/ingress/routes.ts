import { createIpFilter } from "@core/index";
import { env } from "@server/platform/env";
import {
  forbiddenError,
  notFoundError,
  requestIdOf,
  sendError,
} from "@server/platform/error.handlers";
import { apiKeyGuard } from "@server/platform/guards/api-key.guard";
import { log } from "@server/platform/logger.middleware";
import {
  createBodyLimitMiddleware,
  ingressIpRateLimitMiddleware,
  resolveClientIp,
} from "@server/platform/securities.middleware";
import type { AppEnv } from "@server/platform/types";
import { Hono } from "hono";

import { ErrorCodes, HttpMethodSchema } from "@pockrew/pwr-shared/schemas";

import { findTunnel, ingress } from "./service";
import { signingConfig } from "./signing";

export const ingressRoutes = new Hono<AppEnv>()
  .use(
    "/:slug/*",
    // Per-IP burst limit first: it also throttles probing for unknown slugs.
    ingressIpRateLimitMiddleware,
    createBodyLimitMiddleware(env.MAX_INGRESS_PAYLOAD_BYTES),
    async (c, next) => {
      // Unknown methods cannot be represented by RelayPackageSchema and would poison a pending batch.
      if (!HttpMethodSchema.safeParse(c.req.method).success)
        return sendError(c, ErrorCodes.VALIDATION_ERROR, 400);
      await next();
    },
    async (c, next) => {
      const slug = c.req.param("slug");
      if (!slug) throw notFoundError();

      // find tunnels
      const tunnel = await findTunnel(slug);

      c.set("actor", {
        id: tunnel.id,
        types: "provider",
        tenantId: tunnel.orgId,
        tunnelId: tunnel.id,
      });

      if (tunnel.allowedProviderIps || tunnel.deniedProviderIps) {
        const clientIp = resolveClientIp(c);

        const ingressIPFilters = createIpFilter({
          allowlist: tunnel.allowedProviderIps?.split(",") || [],
          denylist: tunnel.deniedProviderIps?.split(",") || [],
        });

        if (!ingressIPFilters.isAllowed(clientIp)) {
          const requestId = requestIdOf(c);
          log.warn({ event: "request.ip_forbidden", clientIp }, requestId);
          return sendError(c, ErrorCodes.IP_FORBIDDEN, 403);
        }
      }

      await next();
    },
    async (c, next) => {
      // Signed tunnels use the provider signature; legacy tunnels still require the scoped API key.
      const tunnelId = c.get("actor").tunnelId;
      if (!tunnelId) throw forbiddenError();
      const config = signingConfig(tunnelId);
      if (config) {
        c.set("ingressSigning", config);
        await next();
      } else {
        await apiKeyGuard("inbound")(c, next);
      }
    },
  )
  .all("/:slug/target/:path{.+}", async (c) => {
    const tunnelId = c.get("actor").tunnelId;
    if (!tunnelId) throw forbiddenError();
    const path = c.req.param("path");
    return ingress(c, {
      tunnelId,
      endpointPath: path,
    });
  })
  .all("/:slug/:collections", async (c) => {
    const tunnelId = c.get("actor").tunnelId;
    if (!tunnelId) throw forbiddenError();
    const collectionId = c.req.param("collections");

    return ingress(c, {
      tunnelId,
      collectionId: collectionId,
    });
  });
