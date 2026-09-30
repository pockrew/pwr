import { z } from "zod";

import { TunnelParamSchema } from "./tunnel.schema";

/** Management capabilities are independent and always restricted to the key's owning tunnel. */
export const ManagementPermissionSchema = z.enum(["tunnel", "keys", "collections", "endpoints"]);
export type ManagementPermission = z.infer<typeof ManagementPermissionSchema>;
export const ManagementPermissionsSchema = z
  .array(ManagementPermissionSchema)
  .max(4)
  .refine((items) => new Set(items).size === items.length, "Duplicate permissions");
export const ManagedKeyTypeSchema = z.enum(["inbound", "outbound", "admin"]);
export const KeyParamSchema = TunnelParamSchema.extend({ keyId: z.string().min(1).max(128) });
const name = z.string().trim().min(1).max(100);
/** Transport keys carry no management permissions; admin grants must be explicit. */
export const GenerateKeySchema = z.discriminatedUnion("types", [
  z.strictObject({ types: z.literal("inbound"), name }),
  z.strictObject({ types: z.literal("outbound"), name }),
  z.strictObject({
    types: z.literal("admin"),
    name,
    permissions: ManagementPermissionsSchema.refine(
      (items) => items.length > 0,
      "Choose at least one permission",
    ),
  }),
]);
export type GenerateKeyInput = z.infer<typeof GenerateKeySchema>;
/** Stored hashes are never part of the public contract, including generation responses. */
export const ManagedKeySchema = z.strictObject({
  id: z.string().min(1).max(128),
  tunnelId: z.string().min(1).max(64),
  name: z.string(),
  types: ManagedKeyTypeSchema,
  keyPrefix: z.string(),
  permissions: ManagementPermissionsSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime().nullable(),
  deletedAt: z.iso.datetime().nullable(),
});
export type ManagedKey = z.infer<typeof ManagedKeySchema>;
export type ManagedKeyType = z.infer<typeof ManagedKeyTypeSchema>;

export const GeneratedKeySchema = z.strictObject({
  key: ManagedKeySchema,
  token: z.string().min(1),
});
export type GeneratedKey = z.infer<typeof GeneratedKeySchema>;

export const ManagedKeyPageSchema = z.strictObject({
  items: z.array(ManagedKeySchema),
  nextCursor: z.string().nullable(),
});
export type ManagedKeyPage = z.infer<typeof ManagedKeyPageSchema>;
