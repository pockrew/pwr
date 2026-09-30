import { SQLiteError } from "bun:sqlite";
import { relayService } from "@server/modules/relays/service";
import { AppError, forbiddenError, notFoundError } from "@server/platform/error.handlers";
import type { Actor } from "@server/platform/types";
import { DrizzleQueryError } from "drizzle-orm";

import { managementPage, normalizeEndpointPath } from "@pockrew/pwr-core";
import type {
  CreateCollectionInput,
  CreateEndpointInput,
  CreateManagedTunnelInput,
  ManagementPageQuery,
  UpdateCollectionInput,
  UpdateEndpointInput,
  UpdateManagedTunnelInput,
} from "@pockrew/pwr-shared/schemas";

import * as repository from "./repository";

/**
 * Enforce the management boundary before resource lookup; CLI/relay keys belong to exactly one tunnel.
 * @param actor - Identity set by the existing admin guard.
 * @param tunnelId - Requested tunnel ID, including disabled tunnels.
 * @returns Nothing after successful scope validation.
 * @throws 403 for provider/wrong-tunnel credentials; 404 for absent/deleted tunnels.
 */
export const requireManagedTunnel = (actor: Actor, tunnelId: string): void => {
  // 1. Account management remains global; no organization feature is introduced.
  if (
    actor.types !== "admin" &&
    ((actor.types !== "cli" && actor.types !== "agents") || actor.tunnelId !== tunnelId)
  )
    throw forbiddenError();
  // 2. Disabled tunnels can still be configured, but deleted parents cannot gain new children.
  if (!repository.findManagedTunnel(tunnelId)) throw notFoundError();
};

/** Translate only the known slug uniqueness constraint; unrelated storage errors must propagate. */
const writeUniqueSlug = <T>(write: () => T): T => {
  try {
    return write();
  } catch (error) {
    const cause = error instanceof DrizzleQueryError ? error.cause : error;
    if (cause instanceof SQLiteError && cause.errno === 2067)
      throw new AppError(409, "VALIDATION_ERROR", "Slug is already reserved");
    throw error;
  }
};

/**
 * Read one collection without exposing another tunnel’s data.
 * @param tunnelId - Owning tunnel ID, authorized by the management guard.
 * @param collectionId - Collection ID within the requested tunnel.
 * @returns Live collection.
 * @throws 404 for absent/deleted or wrong-parent records; storage errors propagate.
 */
export const getCollection = (tunnelId: string, collectionId: string) => {
  const row = repository.findCollection(tunnelId, collectionId);
  if (!row) throw notFoundError();
  return row;
};
/**
 * List live collections in an authorized tunnel.
 * @param tunnelId - Owning tunnel ID, authorized by the management guard.
 * @param query - Validated page size and exclusive ID cursor.
 * @returns Bounded cursor page.
 * @throws Storage errors propagate.
 */
export const listCollections = (tunnelId: string, query: ManagementPageQuery) =>
  managementPage(repository.listCollections(tunnelId, query), query.limit);
/**
 * Create collection metadata in an authorized tunnel.
 * @param tunnelId - Owning tunnel ID, authorized by the management guard.
 * @param input - Validated fields; parent IDs and secrets cannot be supplied.
 * @returns New collection.
 * @throws 409 for duplicate/reserved slugs; other storage errors propagate.
 */
export const createCollection = (tunnelId: string, input: CreateCollectionInput) =>
  writeUniqueSlug(() => repository.insertCollection(tunnelId, input));

/**
 * Update availability or metadata, then dispatch existing pending work.
 * @param tunnelId - Owning tunnel ID, authorized by the management guard.
 * @param collectionId - Collection ID within the requested tunnel.
 * @param input - Validated fields; parent IDs and secrets cannot be supplied.
 * @returns Updated collection.
 * @throws 404 if absent, 409 on a reserved slug; other storage errors propagate.
 */
export const updateCollection = (
  tunnelId: string,
  collectionId: string,
  input: UpdateCollectionInput,
) => {
  // 1. Keep the original ID and existing delivery references.
  const row = writeUniqueSlug(() => repository.updateCollection(tunnelId, collectionId, input));
  if (!row) throw notFoundError();
  // 2. Re-enabling takes effect for an already connected agent, without requiring reconnect.
  relayService.send(tunnelId);
  return row;
};
/**
 * Delete a collection and its children without deleting audit records.
 * @param tunnelId - Owning tunnel ID, authorized by the management guard.
 * @param collectionId - Collection ID within the requested tunnel.
 * @returns Tombstoned collection.
 * @throws 404 if absent; storage errors roll back the entire deletion.
 */
export const deleteCollection = (tunnelId: string, collectionId: string) => {
  const row = repository.deleteCollection(tunnelId, collectionId);
  if (!row) throw notFoundError();
  return row;
};

/**
 * Read an endpoint within the full tunnel/collection hierarchy.
 * @param tunnelId - Owning tunnel ID, authorized by the management guard.
 * @param collectionId - Collection ID within the requested tunnel.
 * @param endpointId - Endpoint ID within the requested collection.
 * @returns Live endpoint.
 * @throws 404 for absent/deleted or wrong-parent records; storage errors propagate.
 */
export const getEndpoint = (tunnelId: string, collectionId: string, endpointId: string) => {
  const row = repository.findEndpoint(tunnelId, collectionId, endpointId);
  if (!row) throw notFoundError();
  return row;
};
/**
 * List endpoints after verifying the parent collection.
 * @param tunnelId - Owning tunnel ID, authorized by the management guard.
 * @param collectionId - Collection ID within the requested tunnel.
 * @param query - Validated page size and exclusive ID cursor.
 * @returns Bounded cursor page.
 * @throws 404 for a missing/deleted parent; storage errors propagate.
 */
export const listEndpoints = (
  tunnelId: string,
  collectionId: string,
  query: ManagementPageQuery,
) => {
  // 1. A missing parent is a 404, not a misleading empty list.
  getCollection(tunnelId, collectionId);
  // 2. Trim the bounded lookahead row to compute the next cursor.
  return managementPage(repository.listEndpoints(tunnelId, collectionId, query), query.limit);
};
/**
 * Create a routing target; identical paths are valid fanout destinations.
 * @param tunnelId - Owning tunnel ID, authorized by the management guard.
 * @param collectionId - Collection ID within the requested tunnel.
 * @param input - Validated fields; parent IDs and secrets cannot be supplied.
 * @returns Endpoint with a canonical path.
 * @throws 404 for a missing/deleted parent; storage errors propagate.
 */
export const createEndpoint = (
  tunnelId: string,
  collectionId: string,
  input: CreateEndpointInput,
) => {
  // 1. Reject deleted/wrong-tunnel collections before inserting a child.
  getCollection(tunnelId, collectionId);
  // 2. Canonicalize only routing config, never provider payloads or headers.
  return repository.insertEndpoint(collectionId, {
    ...input,
    pathName: normalizeEndpointPath(input.pathName),
  });
};
/**
 * Update endpoint config, then dispatch pending work after resume/enable.
 * @param tunnelId - Owning tunnel ID, authorized by the management guard.
 * @param collectionId - Collection ID within the requested tunnel.
 * @param endpointId - Endpoint ID within the requested collection.
 * @param input - Validated fields; parent IDs and secrets cannot be supplied.
 * @returns Updated endpoint.
 * @throws 404 for absent/deleted or wrong-parent records; storage errors propagate.
 */
export const updateEndpoint = (
  tunnelId: string,
  collectionId: string,
  endpointId: string,
  input: UpdateEndpointInput,
) => {
  // 1. Match the entire hierarchy before changing target config.
  getEndpoint(tunnelId, collectionId, endpointId);
  const changes = {
    ...input,
    ...(input.pathName === undefined ? {} : { pathName: normalizeEndpointPath(input.pathName) }),
  };
  const row = repository.updateEndpoint(collectionId, endpointId, changes);
  if (!row) throw notFoundError();
  // 2. A paused package is still pending; resume must not wait for another ingress or reconnect.
  relayService.send(tunnelId);
  return row;
};
/**
 * Soft-delete an endpoint while preserving pending and completed history.
 * @param tunnelId - Owning tunnel ID, authorized by the management guard.
 * @param collectionId - Collection ID within the requested tunnel.
 * @param endpointId - Endpoint ID within the requested collection.
 * @returns Tombstoned endpoint.
 * @throws 404 for absent/deleted or wrong-parent records; storage errors propagate.
 */
export const deleteEndpoint = (tunnelId: string, collectionId: string, endpointId: string) => {
  // 1. Check the complete hierarchy before the narrower write predicate.
  getEndpoint(tunnelId, collectionId, endpointId);
  // 2. Keep the row available to late ACKs and replay history.
  const row = repository.deleteEndpoint(collectionId, endpointId);
  if (!row) throw notFoundError();
  return row;
};

/**
 * Create a tunnel using the account, never an existing tunnel's delegated key.
 * @param actor - Authenticated management identity.
 * @param input - Validated creation fields.
 * @returns New tunnel; throws 403 for CLI keys or 409 for a reserved slug.
 */
export const createTunnel = (actor: Actor, input: CreateManagedTunnelInput) => {
  if (actor.types !== "admin") throw forbiddenError();
  return writeUniqueSlug(() => repository.insertTunnel(input));
};

/**
 * Return a bounded tunnel page without exposing other tunnels to a CLI key.
 * @param actor - Authenticated account or scoped CLI identity with tunnel permission.
 * @param query - Validated pagination.
 * @returns Cursor page; throws 403 for unscoped identities, storage errors propagate.
 */
export const listTunnels = (actor: Actor, query: ManagementPageQuery) => {
  if (actor.types !== "admin" && (actor.types !== "cli" || !actor.tunnelId)) throw forbiddenError();
  return managementPage(
    repository.listTunnels(query, actor.types === "admin" ? undefined : actor.tunnelId),
    query.limit,
  );
};

/**
 * Read a live tunnel after verifying management ownership.
 * @param actor - Authenticated account or scoped CLI key.
 * @param tunnelId - Requested tunnel.
 * @returns Tunnel row; throws 403/404 on a scope/missing-resource failure.
 */
export const getTunnel = (actor: Actor, tunnelId: string) => {
  requireManagedTunnel(actor, tunnelId);
  return repository.findManagedTunnel(tunnelId);
};

/**
 * Update tunnel config and invalidate the current relay when its address/availability changes.
 * @param tunnelId - Authorized live tunnel.
 * @param input - Validated partial fields.
 * @returns Updated tunnel; throws 404/409 on missing/reserved slug, storage errors propagate.
 */
export const updateTunnel = (tunnelId: string, input: UpdateManagedTunnelInput) => {
  // 1. Persist the change before invalidating an authenticated socket.
  const row = writeUniqueSlug(() => repository.updateTunnel(tunnelId, input));
  if (!row) throw notFoundError();
  // 2. A disabled or renamed tunnel must not keep forwarding on an old connection.
  if (!row.isActive || input.slug !== undefined)
    relayService.closeTunnel(tunnelId, "Tunnel configuration changed");
  return row;
};

/**
 * Soft-delete a tunnel and stop its active relay; payload/delivery history remains in storage.
 * @param tunnelId - Authorized live tunnel.
 * @returns Tombstoned row; throws 404 if missing, storage errors propagate.
 */
export const deleteTunnel = (tunnelId: string) => {
  // 1. Parent tombstone immediately invalidates future auth and resource lookups.
  const row = repository.deleteTunnel(tunnelId);
  if (!row) throw notFoundError();
  // 2. Invalidate the current socket and leave unreceived work pending.
  relayService.closeTunnel(tunnelId, "Tunnel deleted");
  return row;
};
