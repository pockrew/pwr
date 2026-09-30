import { createHash } from "node:crypto";
import { db } from "@server/db/client";
import { apiKeys, tunnels } from "@server/db/schemas";
import { forbiddenError, notFoundError } from "@server/platform/error.handlers";
import type { AppEnv } from "@server/platform/types";
import { and, eq, isNull } from "drizzle-orm";
import { createMiddleware } from "hono/factory";

/**
 * Authenticate transport only: scope x-api-key to :slug and the route's direction.
 * Store SHA-256 hex of the entire randomly generated key for both directions.
 * Management accounts and target secrets never enter this guard.
 */
export const apiKeyGuard = (direction: "inbound" | "outbound") =>
  createMiddleware<AppEnv>(async (c, next) => {
    const key = c.req.header("x-api-key") ?? "";
    if (!key) {
      // Same errors when no tunnel found to prevent user enumerate tunnels
      throw notFoundError();
    }

    const slug = c.req.param("slug");
    if (!slug) throw notFoundError();

    const [record] = await db
      .select({
        id: apiKeys.id,
        prefix: apiKeys.keyPrefix,
        orgId: tunnels.orgId,
        tunnelId: tunnels.id,
      })
      .from(apiKeys)
      .innerJoin(tunnels, eq(apiKeys.tunnelId, tunnels.id))
      .where(
        and(
          isNull(apiKeys.deletedAt),
          eq(apiKeys.types, direction),
          eq(apiKeys.keyHash, createHash("sha256").update(key).digest("hex")),
          eq(tunnels.slug, slug),
          eq(tunnels.isActive, true),
          isNull(tunnels.deletedAt),
        ),
      )
      .limit(1);

    if (!record) {
      throw forbiddenError();
    }

    c.set("actor", {
      id: record.id,
      types: direction === "inbound" ? "provider" : "agents",
      tenantId: record.orgId,
      tunnelId: record.tunnelId,
    });

    await next();
  });
