import { db } from "@server/db/client";
import { collections, endpoints, tunnels } from "@server/db/schemas";
import { and, asc, eq, gt, isNull } from "drizzle-orm";

import type {
  CreateCollectionInput,
  CreateEndpointInput,
  CreateManagedTunnelInput,
  ManagementPageQuery,
  UpdateCollectionInput,
  UpdateEndpointInput,
  UpdateManagedTunnelInput,
} from "@pockrew/pwr-shared/schemas";

/**
 * Find a live tunnel, including disabled tunnels.
 * @param tunnelId - Owning tunnel ID, authorized by the management guard.
 * @returns Tunnel row or undefined.
 * @throws Database failures propagate.
 */
export const findManagedTunnel = (tunnelId: string) =>
  db
    .select()
    .from(tunnels)
    .where(and(eq(tunnels.id, tunnelId), isNull(tunnels.deletedAt)))
    .get();

/**
 * Find one live collection within its owning tunnel.
 * @param tunnelId - Owning tunnel ID, authorized by the management guard.
 * @param collectionId - Collection ID within the requested tunnel.
 * @returns Collection row or undefined.
 * @throws Database failures propagate.
 */
export const findCollection = (tunnelId: string, collectionId: string) =>
  db
    .select()
    .from(collections)
    .where(
      and(
        eq(collections.tunnelId, tunnelId),
        eq(collections.id, collectionId),
        isNull(collections.deletedAt),
      ),
    )
    .get();

/**
 * Read a bounded page with one lookahead row for pagination.
 * @param tunnelId - Owning tunnel ID, authorized by the management guard.
 * @param query - Validated page size and exclusive ID cursor.
 * @returns Live collections ordered by ID.
 * @throws Database failures propagate.
 */
export const listCollections = (tunnelId: string, query: ManagementPageQuery) =>
  db
    .select()
    .from(collections)
    .where(
      and(
        eq(collections.tunnelId, tunnelId),
        isNull(collections.deletedAt),
        query.cursor ? gt(collections.id, query.cursor) : undefined,
      ),
    )
    .orderBy(asc(collections.id))
    .limit(query.limit + 1)
    .all();

/**
 * Insert a collection using the existing database uniqueness constraint.
 * @param tunnelId - Owning tunnel ID, authorized by the management guard.
 * @param input - Validated fields; parent IDs and secrets cannot be supplied.
 * @returns Created row.
 * @throws Duplicate/reserved slugs and other database failures propagate.
 */
export const insertCollection = (tunnelId: string, input: CreateCollectionInput) =>
  db
    .insert(collections)
    .values({ ...input, tunnelId })
    .returning()
    .get();

/**
 * Update live collection fields without changing its parent.
 * @param tunnelId - Owning tunnel ID, authorized by the management guard.
 * @param collectionId - Collection ID within the requested tunnel.
 * @param input - Validated fields; parent IDs and secrets cannot be supplied.
 * @returns Updated row or undefined.
 * @throws Slug conflicts and other database failures propagate.
 */
export const updateCollection = (
  tunnelId: string,
  collectionId: string,
  input: UpdateCollectionInput,
) =>
  db
    .update(collections)
    .set(input)
    .where(
      and(
        eq(collections.tunnelId, tunnelId),
        eq(collections.id, collectionId),
        isNull(collections.deletedAt),
      ),
    )
    .returning()
    .get();

/**
 * Soft-delete the collection and its endpoints atomically, preserving delivery history.
 * @param tunnelId - Owning tunnel ID, authorized by the management guard.
 * @param collectionId - Collection ID within the requested tunnel.
 * @returns Tombstoned row or undefined.
 * @throws Storage failures roll back both updates.
 */
export const deleteCollection = (tunnelId: string, collectionId: string) =>
  db.transaction((tx) => {
    // 1. Verify ownership through the update predicate before touching child endpoints.
    const deletedAt = new Date();
    const row = tx
      .update(collections)
      .set({ isActive: false, deletedAt })
      .where(
        and(
          eq(collections.tunnelId, tunnelId),
          eq(collections.id, collectionId),
          isNull(collections.deletedAt),
        ),
      )
      .returning()
      .get();
    if (!row) return;
    // 2. Tombstone children; never cascade-delete packages that agents may still acknowledge.
    tx.update(endpoints)
      .set({ isActive: false, deletedAt })
      .where(and(eq(endpoints.collectionId, collectionId), isNull(endpoints.deletedAt)))
      .run();
    return row;
  });

/**
 * Find an endpoint through its collection to enforce full parent ownership.
 * @param tunnelId - Owning tunnel ID, authorized by the management guard.
 * @param collectionId - Collection ID within the requested tunnel.
 * @param endpointId - Endpoint ID within the requested collection.
 * @returns Live endpoint or undefined.
 * @throws Database failures propagate.
 */
export const findEndpoint = (tunnelId: string, collectionId: string, endpointId: string) =>
  db
    .select({ endpoint: endpoints })
    .from(endpoints)
    .innerJoin(collections, eq(endpoints.collectionId, collections.id))
    .where(
      and(
        eq(collections.tunnelId, tunnelId),
        eq(collections.id, collectionId),
        isNull(collections.deletedAt),
        eq(endpoints.id, endpointId),
        isNull(endpoints.deletedAt),
      ),
    )
    .get()?.endpoint;

/**
 * Read a bounded endpoint page through the owning collection.
 * @param tunnelId - Owning tunnel ID, authorized by the management guard.
 * @param collectionId - Collection ID within the requested tunnel.
 * @param query - Validated page size and exclusive ID cursor.
 * @returns Live endpoints ordered by ID, including one lookahead row.
 * @throws Database failures propagate.
 */
export const listEndpoints = (tunnelId: string, collectionId: string, query: ManagementPageQuery) =>
  db
    .select({ endpoint: endpoints })
    .from(endpoints)
    .innerJoin(collections, eq(endpoints.collectionId, collections.id))
    .where(
      and(
        eq(collections.tunnelId, tunnelId),
        eq(collections.id, collectionId),
        isNull(collections.deletedAt),
        isNull(endpoints.deletedAt),
        query.cursor ? gt(endpoints.id, query.cursor) : undefined,
      ),
    )
    .orderBy(asc(endpoints.id))
    .limit(query.limit + 1)
    .all()
    .map((row) => row.endpoint);

/**
 * Insert an endpoint after the service verifies its parent.
 * @param collectionId - Collection ID within the requested tunnel.
 * @param input - Validated fields; parent IDs and secrets cannot be supplied.
 * @returns Created endpoint.
 * @throws Database failures propagate.
 */
export const insertEndpoint = (collectionId: string, input: CreateEndpointInput) =>
  db
    .insert(endpoints)
    .values({ ...input, collectionId })
    .returning()
    .get();

/**
 * Update an endpoint after the service verifies tunnel/collection ownership.
 * @param collectionId - Collection ID within the requested tunnel.
 * @param endpointId - Endpoint ID within the requested collection.
 * @param input - Validated fields; parent IDs and secrets cannot be supplied.
 * @returns Updated row or undefined.
 * @throws Database failures propagate.
 */
export const updateEndpoint = (
  collectionId: string,
  endpointId: string,
  input: UpdateEndpointInput,
) =>
  db
    .update(endpoints)
    .set(input)
    .where(
      and(
        eq(endpoints.collectionId, collectionId),
        eq(endpoints.id, endpointId),
        isNull(endpoints.deletedAt),
      ),
    )
    .returning()
    .get();

/**
 * Tombstone an endpoint while retaining receipt/replay references.
 * @param collectionId - Collection ID within the requested tunnel.
 * @param endpointId - Endpoint ID within the requested collection.
 * @returns Tombstoned row or undefined.
 * @throws Database failures propagate.
 */
export const deleteEndpoint = (collectionId: string, endpointId: string) =>
  db
    .update(endpoints)
    .set({ isActive: false, deletedAt: new Date() })
    .where(
      and(
        eq(endpoints.collectionId, collectionId),
        eq(endpoints.id, endpointId),
        isNull(endpoints.deletedAt),
      ),
    )
    .returning()
    .get();

/**
 * Insert a tunnel owned by the single admin account's default namespace.
 * @param input - Validated slug/name/availability; ownership cannot be injected.
 * @returns New tunnel; unique slug or storage failures propagate.
 */
export const insertTunnel = (input: CreateManagedTunnelInput) =>
  db
    .insert(tunnels)
    .values({ ...input, id: crypto.randomUUID() })
    .returning()
    .get();

/**
 * List live tunnels, restricted to the CLI's one tunnel when applicable.
 * @param query - Bounded page size and exclusive ID cursor.
 * @param tunnelId - Omit for the account; CLI callers must supply their scope.
 * @returns Ordered rows including one pagination lookahead; storage failures propagate.
 */
export const listTunnels = (query: ManagementPageQuery, tunnelId?: string) =>
  db
    .select()
    .from(tunnels)
    .where(
      and(
        isNull(tunnels.deletedAt),
        tunnelId ? eq(tunnels.id, tunnelId) : undefined,
        query.cursor ? gt(tunnels.id, query.cursor) : undefined,
      ),
    )
    .orderBy(asc(tunnels.id))
    .limit(query.limit + 1)
    .all();

/**
 * Update one live tunnel without changing ownership or its ID.
 * @param tunnelId - Authorized tunnel identity.
 * @param input - Validated fields.
 * @returns Updated row or undefined; slug conflicts/storage failures propagate.
 */
export const updateTunnel = (tunnelId: string, input: UpdateManagedTunnelInput) =>
  db
    .update(tunnels)
    .set(input)
    .where(and(eq(tunnels.id, tunnelId), isNull(tunnels.deletedAt)))
    .returning()
    .get();

/**
 * Tombstone the parent; guards reject its keys and children without destroying history.
 * @param tunnelId - Authorized tunnel identity.
 * @returns Tombstoned row or undefined; storage failures propagate.
 */
export const deleteTunnel = (tunnelId: string) =>
  db
    .update(tunnels)
    .set({ isActive: false, deletedAt: new Date() })
    .where(and(eq(tunnels.id, tunnelId), isNull(tunnels.deletedAt)))
    .returning()
    .get();
