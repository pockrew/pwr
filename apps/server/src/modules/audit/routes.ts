import { auditRelayManagement } from "@server/modules/audit/middleware";
import { adminGuard } from "@server/modules/auth/guard";
import { forbiddenError, requestIdOf } from "@server/platform/error.handlers";
import type { AppEnv } from "@server/platform/types";
import { requireQueryValidation } from "@server/platform/validator.middleware";
import { Hono } from "hono";
import { z } from "zod";

import { listAudits } from "./repository";

const AuditQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  tunnelId: z.string().min(1).max(64).optional(),
  cursor: z.string().min(1).max(64).optional(),
});

export const auditRoutes = new Hono<AppEnv>()
  .use("*", adminGuard())
  .use("*", auditRelayManagement)
  .get("/", requireQueryValidation(AuditQuerySchema), (c) => {
    const actor = c.get("actor");
    const { limit, tunnelId, cursor } = c.req.valid("query");

    // Non-admin actors (relay keys and CLI keys) are strictly confined to their own tunnel.
    // Reading audit logs of other tunnels is forbidden.
    if (actor.types !== "admin") {
      if (!actor.tunnelId) throw forbiddenError();
      if (tunnelId && tunnelId !== actor.tunnelId) {
        throw forbiddenError();
      }
    }

    const effectiveTunnelId = actor.types === "admin" ? tunnelId : actor.tunnelId;
    const rows = listAudits(limit, effectiveTunnelId, cursor);
    const records = rows.slice(0, limit);

    return c.json({
      data: {
        items: records.map((r) => {
          let parsedDetails: Record<string, unknown> = {};
          try {
            if (r.details) parsedDetails = JSON.parse(r.details);
          } catch {}
          return {
            id: r.id,
            action: r.action,
            entityType: r.entityType,
            entityId: r.entityId,
            details: parsedDetails,
            createdAt: r.createdAt,
          };
        }),
        nextCursor: rows.length > limit ? (records.at(-1)?.id ?? null) : null,
      },
      requestId: requestIdOf(c),
    });
  });
