import { createHash } from "node:crypto";
import { db } from "@server/db/client";
import { apiKeys, tunnels } from "@server/db/schemas";
import { env } from "@server/platform/env";
import { forbiddenError } from "@server/platform/error.handlers";
import type { AppEnv } from "@server/platform/types";
import { and, eq, isNull } from "drizzle-orm";
import { createMiddleware } from "hono/factory";

import {
  ManagementPermissionsSchema,
  type ManagementPermission,
} from "@pockrew/pwr-shared/schemas";

import { auth } from "./configs";

/**
 * Authenticate management using the account, a scoped CLI key or an outbound relay key.
 * @param options - sessionOnly restricts an account-only operation to session authentication.
 * @returns Middleware that sets the verified actor and rejects cross-origin cookie writes.
 * @throws 403 for missing/revoked credentials, untrusted origins or deleted key owners.
 */
export const adminGuard = ({ sessionOnly = false } = {}) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const authorization = c.req.header("authorization");
    const relayKey = c.req.header("x-api-key");
    if (relayKey !== undefined) {
      // Relay credentials keep their transport identity and receive only two fixed capabilities.
      if (authorization !== undefined || sessionOnly || !relayKey) throw forbiddenError();
      const key = db
        .select({ id: apiKeys.id, name: apiKeys.name, tunnelId: tunnels.id, orgId: tunnels.orgId })
        .from(apiKeys)
        .innerJoin(tunnels, eq(apiKeys.tunnelId, tunnels.id))
        .where(
          and(
            eq(apiKeys.keyHash, createHash("sha256").update(relayKey).digest("hex")),
            eq(apiKeys.types, "outbound"),
            isNull(apiKeys.deletedAt),
            isNull(tunnels.deletedAt),
            eq(tunnels.isActive, true),
          ),
        )
        .get();
      if (!key) throw forbiddenError();
      c.set("actor", {
        id: key.id,
        keyName: key.name,
        types: "agents",
        tunnelId: key.tunnelId,
        tenantId: key.orgId,
        permissions: ["collections", "endpoints"],
      });
      await next();
      return;
    }
    if (!authorization) {
      // 1. Read the current session from storage, including revocation.
      const session = await auth.api.getSession({
        headers: c.req.raw.headers,
        query: { disableCookieCache: true },
      });
      if (
        !session?.user ||
        session.user.email.toLowerCase() !== env.ADMIN_EMAIL ||
        session.user.role !== "admin"
      ) {
        throw forbiddenError();
      }

      // Better Auth protects its own endpoints; custom cookie mutations need the same boundary.
      const origin = c.req.header("origin");
      const allowedOrigins = [
        new URL(env.PUBLIC_URL).origin,
        ...(env.NODE_ENV === "development"
          ? [
              "http://localhost:15175",
              "http://127.0.0.1:15175",
              "http://localhost:15174",
              "http://127.0.0.1:15174",
            ]
          : []),
      ];

      if (
        !["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
        (!origin || !allowedOrigins.includes(origin))
      ) {
        throw forbiddenError("Untrusted management origin");
      }

      c.set("actor", {
        id: session.user.id,
        types: "admin",
        tenantId: session.user.orgId ?? "",
      });

      await next();
      return;
    }

    if (sessionOnly) {
      throw forbiddenError();
    }

    // 2. Bearer credentials remain admin-only; CLI keys use Argon2id.

    const match = /^Bearer ([\w-]{36})\.([A-Za-z0-9_-]{43})$/i.exec(authorization);
    const id = match?.[1];
    if (!id) throw forbiddenError();
    const [key] = await db
      .select({
        id: apiKeys.id,
        keyHash: apiKeys.keyHash,
        permissions: apiKeys.permissions,
        orgId: tunnels.orgId,
        tunnelId: tunnels.id,
      })
      .from(apiKeys)
      .innerJoin(tunnels, eq(apiKeys.tunnelId, tunnels.id))
      .where(
        and(
          isNull(apiKeys.deletedAt),
          isNull(tunnels.deletedAt),
          eq(apiKeys.id, id),
          eq(apiKeys.types, "admin"),
        ),
      )
      .limit(1);
    const token = authorization.slice(7);
    if (
      !key ||
      !key.keyHash.startsWith("$argon2id$") ||
      !(await Bun.password.verify(token, key.keyHash).catch(() => false))
    ) {
      throw forbiddenError();
    }

    const permissions = ManagementPermissionsSchema.safeParse(key.permissions);
    if (!permissions.success) throw forbiddenError();
    c.set("actor", {
      id: key.id,
      types: "cli",
      tenantId: key.orgId,
      tunnelId: key.tunnelId,
      permissions: permissions.data,
    });

    await next();
  });

/**
 * Enforce one management capability after authentication; tunnel ownership is checked separately.
 * @param permission - Capability needed by this route, for both reads and writes.
 * @returns Middleware allowing the account, explicit CLI grants or fixed relay capabilities.
 * @throws 403 for absent permissions or non-management identities.
 */
export const requireManagementPermission = (permission: ManagementPermission) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const actor = c.get("actor");
    if (
      actor.types !== "admin" &&
      ((actor.types !== "cli" && actor.types !== "agents") ||
        !actor.permissions?.includes(permission))
    )
      throw forbiddenError();
    await next();
  });
