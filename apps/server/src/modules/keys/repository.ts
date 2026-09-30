import { db } from "@server/db/client";
import { apiKeys } from "@server/db/schemas";
import { and, asc, eq, gt, isNull } from "drizzle-orm";

import type { ManagementPageQuery } from "@pockrew/pwr-shared/schemas";

// Explicit projection prevents hashes from escaping via list, create or revoke responses.
const metadata = {
  id: apiKeys.id,
  tunnelId: apiKeys.tunnelId,
  name: apiKeys.name,
  types: apiKeys.types,
  keyPrefix: apiKeys.keyPrefix,
  permissions: apiKeys.permissions,
  createdAt: apiKeys.createdAt,
  updatedAt: apiKeys.updatedAt,
  deletedAt: apiKeys.deletedAt,
};

/**
 * Read a key only within its authorized owning tunnel.
 * @param tunnelId - Verified tunnel scope.
 * @param keyId - Requested key ID.
 * @returns Live metadata or undefined; storage errors propagate.
 */
export const findKey = (tunnelId: string, keyId: string) =>
  db
    .select(metadata)
    .from(apiKeys)
    .where(and(eq(apiKeys.tunnelId, tunnelId), eq(apiKeys.id, keyId), isNull(apiKeys.deletedAt)))
    .get();

/**
 * List live key metadata with a bounded cursor query, never hashes or raw tokens.
 * @param tunnelId - Verified tunnel scope.
 * @param query - Page size and exclusive ID cursor.
 * @returns Ordered metadata plus one lookahead; storage errors propagate.
 */
export const listKeys = (tunnelId: string, query: ManagementPageQuery) =>
  db
    .select(metadata)
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.tunnelId, tunnelId),
        isNull(apiKeys.deletedAt),
        query.cursor ? gt(apiKeys.id, query.cursor) : undefined,
      ),
    )
    .orderBy(asc(apiKeys.id))
    .limit(query.limit + 1)
    .all();

/**
 * Persist a generated key hash, excluding the token from database storage.
 * @param input - Server-generated fields and validated management permissions.
 * @returns Public metadata; database failures propagate.
 */
export const insertKey = (input: typeof apiKeys.$inferInsert) =>
  db.insert(apiKeys).values(input).returning(metadata).get();

/**
 * Revoke an owned key through the deletedAt marker used by both guards.
 * @param tunnelId - Verified tunnel scope.
 * @param keyId - Key identity already checked by the service.
 * @returns Revoked metadata or undefined; storage errors propagate.
 */
export const revokeKey = (tunnelId: string, keyId: string) =>
  db
    .update(apiKeys)
    .set({ deletedAt: new Date() })
    .where(and(eq(apiKeys.tunnelId, tunnelId), eq(apiKeys.id, keyId), isNull(apiKeys.deletedAt)))
    .returning(metadata)
    .get();
