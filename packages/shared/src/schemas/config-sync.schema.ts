import { z } from "zod";

import { ManagementPageQuerySchema } from "./tunnel-management.schema";

const id = z.string().min(1).max(128);
export const ConfigKindSchema = z.enum(["collection", "endpoint"]);
export type ConfigKind = z.infer<typeof ConfigKindSchema>;

/** Config snapshots contain no credentials or payloads; tombstones prevent resurrection. */
export const ConfigCollectionSchema = z.strictObject({
  kind: z.literal("collection"),
  id,
  slug: z.string().nullable(),
  isActive: z.boolean(),
  deleted: z.boolean(),
});
export const ConfigEndpointSchema = z.strictObject({
  kind: z.literal("endpoint"),
  id,
  collectionId: id,
  pathName: z.string(),
  isActive: z.boolean(),
  isPaused: z.boolean(),
  deleted: z.boolean(),
});
export const ConfigDocumentSchema = z.discriminatedUnion("kind", [
  ConfigCollectionSchema,
  ConfigEndpointSchema,
]);
export type ConfigDocument = z.infer<typeof ConfigDocumentSchema>;
export type ConfigCollection = z.infer<typeof ConfigCollectionSchema>;
export type ConfigEndpoint = z.infer<typeof ConfigEndpointSchema>;

/** Compare the last acknowledged snapshot, not clocks from different machines. */
export const ConfigMutationSchema = z
  .strictObject({
    base: ConfigDocumentSchema.nullable(),
    value: ConfigDocumentSchema,
  })
  .refine(
    ({ base, value }) => !base || (base.id === value.id && base.kind === value.kind),
    "Snapshot identity cannot change",
  );
export type ConfigMutation = z.infer<typeof ConfigMutationSchema>;
export const ConfigSyncQuerySchema = ManagementPageQuerySchema.extend({ kind: ConfigKindSchema });
export type ConfigSyncQuery = z.infer<typeof ConfigSyncQuerySchema>;
export const ConfigPageSchema = z.strictObject({
  items: z.array(ConfigDocumentSchema),
  nextCursor: id.nullable(),
});
export const ConfigMutationResultSchema = z.strictObject({
  status: z.enum(["applied", "conflict"]),
  current: ConfigDocumentSchema.nullable(),
});
export type ConfigMutationResult = z.infer<typeof ConfigMutationResultSchema>;
export const ConfigResolveSchema = z.strictObject({ choice: z.enum(["local", "server"]) });
export type ConfigResolution = z.infer<typeof ConfigResolveSchema>["choice"];
/** Local API exposes both versions of a conflict; credentials are absent from every field. */
export const LocalConfigEntrySchema = z.strictObject({
  value: ConfigDocumentSchema,
  pending: z.boolean(),
  hasConflict: z.boolean(),
  remote: ConfigDocumentSchema.nullable(),
  // Agent-owned target for endpoints; never part of the replicated document.
  localTarget: z.string().nullable(),
});
export type LocalConfigEntry = z.infer<typeof LocalConfigEntrySchema>;
export const LocalConfigPageSchema = z.strictObject({
  items: z.array(LocalConfigEntrySchema),
  nextCursor: id.nullable(),
  sync: z
    .strictObject({
      serverUrl: z.string(),
      slug: z.string(),
      tunnelId: id,
      lastSyncedAt: z.number().nullable(),
      error: z.string().nullable(),
    })
    .nullable(),
});
export type LocalConfigPage = z.infer<typeof LocalConfigPageSchema>;
export const ConfigRecordParamSchema = z.object({
  tunnelId: id,
  kind: ConfigKindSchema,
  id,
});
