import { db } from "@server/db/client";
import { apiKeys, audit_logs } from "@server/db/schemas";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";

/**
 * Persist a management attempt before any handler can mutate config.
 * @param input - Server-authenticated identity and request metadata, with no raw credentials.
 * @returns Nothing after durable insertion; storage errors must block request execution.
 */
export const insertAudit = (input: typeof audit_logs.$inferInsert): void => {
  db.insert(audit_logs).values(input).run();
};

/**
 * Attach the HTTP outcome to an already durable request audit.
 * @param id - Audit identity generated at request entry.
 * @param details - Serialized metadata including the final HTTP status.
 * @returns Nothing; failures propagate so the caller can report an incomplete outcome.
 */
export const completeAudit = (id: string, details: string): void => {
  db.update(audit_logs).set({ details }).where(eq(audit_logs.id, id)).run();
};

/**
 * Page recent audit entries, newest first, optionally scoped to a single tunnel.
 * @param limit - Maximum rows to return.
 * @param tunnelId - Optional tunnel identifier to filter records.
 * @param cursor - ID of the last row of the previous page (exclusive).
 * @returns Up to `limit + 1` rows; the extra row tells the caller another page exists.
 */
export const listAudits = (limit = 50, tunnelId?: string, cursor?: string) => {
  const after = cursor
    ? db
        .select({ id: audit_logs.id, createdAt: audit_logs.createdAt })
        .from(audit_logs)
        .where(eq(audit_logs.id, cursor))
        .get()
    : undefined;
  const tunnelKeys = db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(eq(apiKeys.tunnelId, tunnelId ?? ""));
  return db
    .select()
    .from(audit_logs)
    .where(
      and(
        tunnelId
          ? or(
              and(eq(audit_logs.entityType, "tunnel"), eq(audit_logs.entityId, tunnelId)),
              sql`CASE WHEN json_valid(${audit_logs.details}) = 1 THEN json_extract(${audit_logs.details}, '$.tunnelId') ELSE NULL END = ${tunnelId}`,
              and(eq(audit_logs.entityType, "api_key"), inArray(audit_logs.entityId, tunnelKeys)),
            )
          : undefined,
        after
          ? or(
              lt(audit_logs.createdAt, after.createdAt),
              and(eq(audit_logs.createdAt, after.createdAt), lt(audit_logs.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(audit_logs.createdAt), desc(audit_logs.id))
    .limit(limit + 1)
    .all();
};
