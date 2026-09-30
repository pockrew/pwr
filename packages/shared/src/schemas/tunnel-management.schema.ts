import { z } from "zod";

import { LocalEndpointCredentialSchema } from "./relay.schema";
import { TunnelParamSchema } from "./tunnel.schema";

const id = z.string().min(1).max(128);
const slug = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);

/** Parent IDs belong in the URL; clients cannot move resources or supply target secrets. */
export const CollectionParamSchema = TunnelParamSchema.extend({ collectionId: id });
export const EndpointParamSchema = CollectionParamSchema.extend({ endpointId: id });
export const ManagementPageQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: id.optional(),
});
export type ManagementPageQuery = z.infer<typeof ManagementPageQuerySchema>;

export const CreateCollectionSchema = z.strictObject({ slug, isActive: z.boolean().default(true) });
// PATCH must not apply create defaults to omitted availability flags.
export const UpdateCollectionSchema = CreateCollectionSchema.partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, "At least one change is required");
export type CreateCollectionInput = z.infer<typeof CreateCollectionSchema>;
export type UpdateCollectionInput = z.infer<typeof UpdateCollectionSchema>;

/** HTTP paths are literal routing selectors, not globs, queries, fragments or dot-segment URLs. */
export const EndpointPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .regex(/^\/?[^\s\\?#%/]+(?:\/[^\s\\?#%/]+)*$/)
  .refine(
    (value) => value.split("/").every((segment) => segment !== "." && segment !== ".."),
    "Dot segments are not routing paths",
  );
// normalize uses Zod's URL parser so alternative spellings cannot hide userinfo or a fragment.
export const EndpointTargetSchema = z
  .url({ protocol: /^https?$/, normalize: true })
  .max(4096)
  .refine(
    (value) => !/^https?:\/\/[^/]*@/i.test(value) && !value.includes("#"),
    "Target credentials belong in the local agent",
  );
/** Server endpoints are routing only; the target URL is agent-owned and never replicated. */
export const CreateEndpointSchema = z.strictObject({
  pathName: EndpointPathSchema,
  isActive: z.boolean().default(true),
  isPaused: z.boolean().default(false),
});
export const UpdateEndpointSchema = CreateEndpointSchema.partial()
  .extend({ isActive: z.boolean().optional(), isPaused: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, "At least one change is required");
export type CreateEndpointInput = z.infer<typeof CreateEndpointSchema>;
export type UpdateEndpointInput = z.infer<typeof UpdateEndpointSchema>;

/**
 * Agent endpoint edits may also set the local-only target and secret; `null` clears either. Both
 * commit together, so held deliveries released by a new target never go out without its secret.
 */
export const CreateLocalEndpointSchema = CreateEndpointSchema.extend({
  localTarget: EndpointTargetSchema.optional(),
  secret: LocalEndpointCredentialSchema.optional(),
});
export const UpdateLocalEndpointSchema = CreateEndpointSchema.partial()
  .extend({
    isActive: z.boolean().optional(),
    isPaused: z.boolean().optional(),
    localTarget: EndpointTargetSchema.nullable().optional(),
    secret: LocalEndpointCredentialSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one change is required");
export type CreateLocalEndpointInput = z.infer<typeof CreateLocalEndpointSchema>;
export type UpdateLocalEndpointInput = z.infer<typeof UpdateLocalEndpointSchema>;

const timestamps = {
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime().nullable(),
  deletedAt: z.iso.datetime().nullable(),
};
/** Response contracts retain nullable slugs from existing collections. */
export const ManagedCollectionSchema = z.strictObject({
  id,
  tunnelId: id,
  slug: z.string().nullable(),
  isActive: z.boolean(),
  ...timestamps,
});
export const ManagedEndpointSchema = z.strictObject({
  id,
  collectionId: id,
  pathName: z.string(),
  isActive: z.boolean(),
  isPaused: z.boolean(),
  ...timestamps,
});
export type ManagedCollection = z.infer<typeof ManagedCollectionSchema>;
export type ManagedEndpoint = z.infer<typeof ManagedEndpointSchema>;

/** Lists use an exclusive ID cursor and bounded pages, never an unbounded config dump. */
export const ManagedCollectionPageSchema = z.strictObject({
  items: z.array(ManagedCollectionSchema),
  nextCursor: id.nullable(),
});
export const ManagedEndpointPageSchema = z.strictObject({
  items: z.array(ManagedEndpointSchema),
  nextCursor: id.nullable(),
});

/** Tunnel creation belongs to the account; updates cannot change IDs or organization ownership. */
export const CreateManagedTunnelSchema = z.strictObject({
  slug,
  name: z.string().trim().min(1).max(100),
  isActive: z.boolean().default(true),
});
export const UpdateManagedTunnelSchema = CreateManagedTunnelSchema.partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, "At least one change is required");
export type CreateManagedTunnelInput = z.infer<typeof CreateManagedTunnelSchema>;
export type UpdateManagedTunnelInput = z.infer<typeof UpdateManagedTunnelSchema>;
/** Provider signature schemes a tunnel can require instead of the x-api-key header. */
export const SigningProviderSchema = z.enum([
  "github",
  "stripe",
  "standard_webhooks",
  "shopify",
  "slack",
  "hmac",
]);
export type SigningProvider = z.infer<typeof SigningProviderSchema>;

/**
 * A custom HMAC over the raw body, for providers that sign that way (Linear, Typeform,
 * Intercom…): the header carrying it, the hash, how the digest is encoded, and a fixed prefix.
 */
export const HmacSigningOptionsSchema = z.strictObject({
  header: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[!#$%&'*+.^_`|~0-9a-z-]{1,100}$/, "Use a valid HTTP header name"),
  algorithm: z.enum(["sha256", "sha1", "sha512"]),
  encoding: z.enum(["hex", "base64"]),
  prefix: z.string().max(32).default(""),
});
export type HmacSigningOptions = z.infer<typeof HmacSigningOptionsSchema>;

const signingSecret = z.string().min(1).max(1024);

/** A signed ingress mode replaces API-key ingress for this tunnel. */
export const SetIngressSigningSchema = z.discriminatedUnion("provider", [
  z.strictObject({
    provider: SigningProviderSchema.exclude(["hmac", "standard_webhooks"]),
    secret: signingSecret,
  }),
  z.strictObject({
    provider: z.literal("standard_webhooks"),
    // `whsec_` + base64 key, as issued by Svix-based providers (Clerk, Resend…).
    secret: signingSecret.regex(
      /^(whsec_)?[A-Za-z0-9+/]+={0,2}$/,
      "Use the whsec_… signing secret",
    ),
  }),
  z.strictObject({
    provider: z.literal("hmac"),
    // Omitted: keep the saved custom HMAC secret and change only the options.
    secret: signingSecret.optional(),
    options: HmacSigningOptionsSchema,
  }),
]);
export type SetIngressSigningInput = z.infer<typeof SetIngressSigningSchema>;

/** Ingress authentication of a tunnel as returned to management; never includes the secret. */
export interface IngressSigningStatus {
  provider: "api_key" | SigningProvider;
  configured: boolean;
  options: HmacSigningOptions | null;
  /** False until the server has WEBHOOK_SIGNING_ENCRYPTION_KEY; signed modes cannot be saved. */
  available: boolean;
}
export const ManagedTunnelSchema = z.strictObject({
  id,
  orgId: z.string(),
  slug: z.string(),
  name: z.string(),
  allowedProviderIps: z.string().nullable(),
  deniedProviderIps: z.string().nullable(),
  allowedAgentIps: z.string().nullable(),
  deniedAgentIps: z.string().nullable(),
  isActive: z.boolean(),
  ...timestamps,
});
export const ManagedTunnelPageSchema = z.strictObject({
  items: z.array(ManagedTunnelSchema),
  nextCursor: id.nullable(),
});
export type ManagedTunnel = z.infer<typeof ManagedTunnelSchema>;
export type ManagedTunnelPage = z.infer<typeof ManagedTunnelPageSchema>;

/** Read-only queue visibility; blocked includes paused, inactive and deleted target config. */
export const DeliveryBacklogStatusSchema = z.strictObject({
  unpreparedEvents: z.number().int().nonnegative(),
  unmatchedEvents: z.number().int().nonnegative(),
  pendingDeliveries: z.number().int().nonnegative(),
  blockedDeliveries: z.number().int().nonnegative(),
});
