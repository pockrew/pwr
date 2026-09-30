import { db } from "@server/db/client";
import { collections, endpoints } from "@server/db/schemas";
import { forbiddenError, validationError } from "@server/platform/error.handlers";
import { and, asc, eq, gt } from "drizzle-orm";

import {
  collectionConfig,
  endpointConfig,
  managementPage,
  normalizeEndpointPath,
  sameConfig,
} from "@pockrew/pwr-core";
import {
  CreateCollectionSchema,
  CreateEndpointSchema,
  type ConfigMutation,
  type ConfigMutationResult,
  type ConfigSyncQuery,
} from "@pockrew/pwr-shared/schemas";

/** Read bounded pages including tombstones, so an offline replica learns about deletions. */
export const listConfig = (tunnelId: string, query: ConfigSyncQuery) => {
  if (query.kind === "collection")
    return managementPage(
      db
        .select()
        .from(collections)
        .where(
          and(
            eq(collections.tunnelId, tunnelId),
            query.cursor ? gt(collections.id, query.cursor) : undefined,
          ),
        )
        .orderBy(asc(collections.id))
        .limit(query.limit + 1)
        .all()
        .map(collectionConfig),
      query.limit,
    );
  return managementPage(
    db
      .select({ endpoint: endpoints })
      .from(endpoints)
      .innerJoin(collections, eq(endpoints.collectionId, collections.id))
      .where(
        and(
          eq(collections.tunnelId, tunnelId),
          query.cursor ? gt(endpoints.id, query.cursor) : undefined,
        ),
      )
      .orderBy(asc(endpoints.id))
      .limit(query.limit + 1)
      .all()
      .map(({ endpoint }) => endpointConfig(endpoint)),
    query.limit,
  );
};

/**
 * Apply one compare-and-set mutation atomically. Client UUIDs make retries idempotent.
 * @param tunnelId - Guard-authorized owning tunnel.
 * @param mutation - Last acknowledged snapshot and desired config; secrets are rejected by schema.
 * @returns Current snapshot on success or conflict; DB failures roll back and propagate.
 */
export const applyConfig = (
  tunnelId: string,
  { base, value }: ConfigMutation,
): ConfigMutationResult =>
  db.transaction((tx) => {
    // 1. Check the ID's actual owner before comparing or disclosing any remote fields.
    if (value.kind === "collection") {
      const row = tx.select().from(collections).where(eq(collections.id, value.id)).get();
      if (row && row.tunnelId !== tunnelId) throw forbiddenError();
      const current = row ? collectionConfig(row) : null;
      if (sameConfig(current, value)) return { status: "applied", current };
      if (!sameConfig(current, base) || row?.deletedAt) return { status: "conflict", current };
      // 2. Never revive a deleted ID; retained delivery/replay history still references it.
      if (value.deleted) throw validationError("Local sync supports create/edit only");
      // Historical collections can have a null slug; availability edits must preserve that value.
      const fields = {
        isActive: value.isActive,
        slug:
          value.slug === null && row?.slug === null
            ? null
            : CreateCollectionSchema.shape.slug.parse(value.slug),
      };
      const reserved =
        fields.slug === null
          ? undefined
          : tx
              .select({ id: collections.id })
              .from(collections)
              .where(and(eq(collections.tunnelId, tunnelId), eq(collections.slug, fields.slug)))
              .get();
      if (reserved && reserved.id !== value.id) return { status: "conflict", current };
      const saved = row
        ? tx.update(collections).set(fields).where(eq(collections.id, value.id)).returning().get()
        : tx
            .insert(collections)
            .values({ ...fields, id: value.id, tunnelId })
            .returning()
            .get();
      return { status: "applied", current: collectionConfig(saved) };
    }
    const row = tx.select().from(endpoints).where(eq(endpoints.id, value.id)).get();
    const parent = tx
      .select()
      .from(collections)
      .where(eq(collections.id, value.collectionId))
      .get();
    if (row && row.collectionId !== value.collectionId) throw forbiddenError();
    if (parent && parent.tunnelId !== tunnelId) throw forbiddenError();
    const current = row ? endpointConfig(row) : null;
    if (sameConfig(current, value)) return { status: "applied", current };
    if (!parent || parent.deletedAt || !sameConfig(current, base) || row?.deletedAt)
      return { status: "conflict", current };
    if (value.deleted) throw validationError("Local sync supports create/edit only");
    // 3. Use the same validators/normalizer as ordinary management routes.
    const fields = CreateEndpointSchema.parse({
      pathName: value.pathName,
      isActive: value.isActive,
      isPaused: value.isPaused,
    });
    fields.pathName = normalizeEndpointPath(fields.pathName);
    const saved = row
      ? tx.update(endpoints).set(fields).where(eq(endpoints.id, value.id)).returning().get()
      : tx
          .insert(endpoints)
          .values({ ...fields, id: value.id, collectionId: value.collectionId })
          .returning()
          .get();
    return { status: "applied", current: endpointConfig(saved) };
  });
