import { db } from "@agent/db/client";
import {
  getEndpointTarget,
  setEndpointSecret,
  setEndpointTarget,
} from "@agent/modules/relays/credentials.repository";
import { HTTPException } from "hono/http-exception";

import { normalizeEndpointPath } from "@pockrew/pwr-core";
import {
  ConfigCollectionSchema,
  ConfigEndpointSchema,
  type ConfigEndpoint,
  type CreateCollectionInput,
  type CreateLocalEndpointInput,
  type LocalEndpointCredential,
  type RelayScope,
  type UpdateCollectionInput,
  type UpdateLocalEndpointInput,
} from "@pockrew/pwr-shared/schemas";

import { getConfig, saveConfig } from "./repository";

/**
 * Write the local-only secret and target of one endpoint, secret first. Callers run this inside
 * their transaction: a drain can never observe a new target without the secret sent alongside it.
 */
const saveLocalTransport = (
  scope: RelayScope,
  endpointId: string,
  secret: LocalEndpointCredential | null | undefined,
  localTarget: string | null | undefined,
): void => {
  if (secret !== undefined)
    setEndpointSecret(scope, endpointId, secret?.secret ?? null, secret?.headerName);
  if (localTarget !== undefined) setEndpointTarget(scope, endpointId, localTarget);
};

/**
 * Read a live local collection, including pending/conflicting offline versions.
 * @param scope - Saved server/slug boundary.
 * @param id - Stable collection ID.
 * @returns Local snapshot; throws 404 for absent/deleted IDs, propagates storage errors.
 */
export const getCollection = (scope: RelayScope, id: string) => {
  const value = getConfig(scope, "collection", id)?.value;
  if (!value || value.kind !== "collection" || value.deleted) throw new HTTPException(404);
  return value;
};

/**
 * Read an endpoint through its local parent.
 * @param scope - Saved server/slug boundary.
 * @param collectionId - Owning local collection.
 * @param id - Stable endpoint ID.
 * @returns Local snapshot; throws 404 for absent/deleted/wrong-parent IDs or propagates DB errors.
 */
export const getEndpoint = (scope: RelayScope, collectionId: string, id: string) => {
  getCollection(scope, collectionId);
  const value = getConfig(scope, "endpoint", id)?.value;
  if (!value || value.kind !== "endpoint" || value.deleted || value.collectionId !== collectionId)
    throw new HTTPException(404);
  return value;
};

/** Local API view of an endpoint: the replicated document plus its agent-owned target. */
export type LocalEndpointView = ConfigEndpoint & { localTarget: string | null };

/** Attach the agent-owned target to a replicated endpoint snapshot. */
export const withLocalTarget = (scope: RelayScope, value: ConfigEndpoint): LocalEndpointView => ({
  ...value,
  localTarget: getEndpointTarget(scope, value.id),
});

/**
 * Create a collection without contacting the server.
 * @param scope - Saved server/slug boundary.
 * @param input - Validated collection fields from the shared create schema.
 * @returns Committed local snapshot and UUID; validation/storage failures propagate.
 */
export const createCollection = (scope: RelayScope, input: CreateCollectionInput) => {
  const value = { ...input, kind: "collection", id: crypto.randomUUID(), deleted: false };
  // Validate the snapshot before committing its UUID and pending flag together.
  const saved = ConfigCollectionSchema.parse(value);
  saveConfig(scope, saved);
  return saved;
};

/**
 * Save a collection edit while preserving its last acknowledged server baseline.
 * @param scope - Saved server/slug boundary.
 * @param id - Stable collection ID.
 * @param input - Validated patch; omitted fields remain unchanged.
 * @returns Committed local snapshot; missing/invalid data or storage failures propagate.
 */
export const updateCollection = (scope: RelayScope, id: string, input: UpdateCollectionInput) => {
  const value = ConfigCollectionSchema.parse({ ...getCollection(scope, id), ...input });
  saveConfig(scope, value);
  return value;
};

/**
 * Create an endpoint under a local collection; target and secret have local-only owners.
 * @param scope - Saved server/slug boundary.
 * @param collectionId - Existing local collection, including an unsynced parent.
 * @param input - Validated routing fields plus an optional agent-owned target and secret.
 * @returns Committed UUID/snapshot with its target; invalid parents or storage failures propagate.
 */
export const createEndpoint = (
  scope: RelayScope,
  collectionId: string,
  { localTarget, secret, ...input }: CreateLocalEndpointInput,
): LocalEndpointView => {
  // 1. Validate the local parent before generating an endpoint identity.
  getCollection(scope, collectionId);
  const value = ConfigEndpointSchema.parse({
    ...input,
    kind: "endpoint",
    collectionId,
    id: crypto.randomUUID(),
    deleted: false,
    pathName: normalizeEndpointPath(input.pathName),
  });
  // 2. The replicated document and its local target/secret commit together.
  db.transaction(() => {
    saveConfig(scope, value);
    saveLocalTransport(scope, value.id, secret, localTarget);
  });
  return withLocalTarget(scope, value);
};

/**
 * Update endpoint config locally; pending and future deliveries use the resulting target.
 * @param scope - Saved server/slug boundary.
 * @param collectionId - Owning local collection; cannot be changed by a patch.
 * @param id - Stable endpoint ID.
 * @param input - Validated patch; omitted fields remain unchanged, `null` target/secret clears it.
 * @returns Committed snapshot; invalid parents, validation or storage failures propagate.
 */
export const updateEndpoint = (
  scope: RelayScope,
  collectionId: string,
  id: string,
  { localTarget, secret, ...input }: UpdateLocalEndpointInput,
): LocalEndpointView => {
  const current = getEndpoint(scope, collectionId, id);
  db.transaction(() => {
    // A target-only edit is local state and must not create a pending server mutation.
    if (Object.keys(input).length > 0)
      saveConfig(
        scope,
        ConfigEndpointSchema.parse({
          ...current,
          ...input,
          ...(input.pathName === undefined
            ? {}
            : { pathName: normalizeEndpointPath(input.pathName) }),
        }),
      );
    saveLocalTransport(scope, id, secret, localTarget);
  });
  return withLocalTarget(scope, getEndpoint(scope, collectionId, id));
};
