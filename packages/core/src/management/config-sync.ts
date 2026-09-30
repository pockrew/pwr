import {
  ConfigDocumentSchema,
  type ConfigDocument,
  type ConfigEndpoint,
} from "@pockrew/pwr-shared/schemas";

/** Compare canonical config fields only; timestamps and object key order are irrelevant. */
export const sameConfig = (left: ConfigDocument | null, right: ConfigDocument | null): boolean =>
  JSON.stringify(left === null ? null : ConfigDocumentSchema.parse(left)) ===
  JSON.stringify(right === null ? null : ConfigDocumentSchema.parse(right));

/** Convert a stored collection to its credential-free replication snapshot. */
export const collectionConfig = (row: {
  id: string;
  slug: string | null;
  isActive: boolean;
  deletedAt: Date | null;
}): ConfigDocument => ({
  kind: "collection",
  id: row.id,
  slug: row.slug,
  isActive: row.isActive,
  deleted: row.deletedAt !== null,
});

/** Convert a stored endpoint to replication fields without payload or secret access. */
export const endpointConfig = (row: {
  id: string;
  collectionId: string;
  pathName: string;
  isActive: boolean;
  isPaused: boolean;
  deletedAt: Date | null;
}): ConfigEndpoint => ({
  kind: "endpoint",
  id: row.id,
  collectionId: row.collectionId,
  pathName: row.pathName,
  isActive: row.isActive,
  isPaused: row.isPaused,
  deleted: row.deletedAt !== null,
});
