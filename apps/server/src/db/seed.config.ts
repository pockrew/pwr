// @server-only
import { env } from "@server/platform/env";
import { z } from "zod";

/**
 * Zod schema defining the administrative user seed configuration.
 */
export const SeedAdminConfigSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
  password: z.string().min(8).max(128),
  role: z.literal("admin").default("admin"),
});

/**
 * Zod schema defining an initial ingress tunnel seed configuration.
 */
export const SeedTunnelConfigSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  orgId: z.string().default("default"),
  isActive: z.boolean().default(true),
});

/**
 * Zod schema defining a webhook collection seed configuration.
 */
export const SeedCollectionConfigSchema = z.object({
  id: z.string().min(1),
  tunnelId: z.string().min(1),
  slug: z.string().min(1),
  isActive: z.boolean().default(true),
});

/**
 * Zod schema defining an endpoint seed configuration.
 */
export const SeedEndpointConfigSchema = z.object({
  id: z.string().min(1),
  collectionId: z.string().min(1),
  pathName: z.string().min(1),
  isActive: z.boolean().default(true),
  isPaused: z.boolean().default(false),
});

/**
 * Composite Zod schema for full Drizzle database seeding.
 */
export const DrizzleSeedConfigSchema = z.object({
  admin: SeedAdminConfigSchema,
  tunnels: z.array(SeedTunnelConfigSchema),
  collections: z.array(SeedCollectionConfigSchema),
  endpoints: z.array(SeedEndpointConfigSchema),
});

export type SeedAdminConfig = z.infer<typeof SeedAdminConfigSchema>;
export type SeedTunnelConfig = z.infer<typeof SeedTunnelConfigSchema>;
export type SeedCollectionConfig = z.infer<typeof SeedCollectionConfigSchema>;
export type SeedEndpointConfig = z.infer<typeof SeedEndpointConfigSchema>;
export type DrizzleSeedConfig = z.infer<typeof DrizzleSeedConfigSchema>;

/**
 * Default tunnel seed rows.
 */
export const DEFAULT_SEED_TUNNELS: readonly SeedTunnelConfig[] = [
  {
    id: "default",
    slug: "default",
    name: "Default Ingress",
    orgId: "default",
    isActive: true,
  },
];

/**
 * Default collection seed rows for popular webhook providers.
 */
export const DEFAULT_SEED_COLLECTIONS: readonly SeedCollectionConfig[] = [
  {
    id: "col-stripe",
    tunnelId: "default",
    slug: "stripe",
    isActive: true,
  },
  {
    id: "col-github",
    tunnelId: "default",
    slug: "github",
    isActive: true,
  },
  {
    id: "col-auth",
    tunnelId: "default",
    slug: "auth",
    isActive: true,
  },
  {
    id: "col-clerk",
    tunnelId: "default",
    slug: "clerk",
    isActive: false,
  },
];

/**
 * Default webhook endpoint seed rows.
 */
export const DEFAULT_SEED_ENDPOINTS: readonly SeedEndpointConfig[] = [
  {
    id: "ep-stripe-webhook",
    collectionId: "col-stripe",
    pathName: "/webhook",
    isActive: true,
    isPaused: false,
  },
  {
    id: "ep-stripe-invoices",
    collectionId: "col-stripe",
    pathName: "/invoice-created",
    isActive: true,
    isPaused: false,
  },
  {
    id: "ep-github-events",
    collectionId: "col-github",
    pathName: "/events",
    isActive: true,
    isPaused: false,
  },
  {
    id: "ep-auth-sync",
    collectionId: "col-auth",
    pathName: "/session/sync",
    isActive: true,
    isPaused: false,
  },
];

/**
 * Resolves the active seeding configuration by combining environment variables,
 * configured defaults, and optional runtime overrides.
 *
 * @param overrides - Optional partial overrides for testing or custom seed scenarios.
 * @returns Fully validated and strongly typed DrizzleSeedConfig.
 */
export const getSeedConfig = (overrides?: Partial<DrizzleSeedConfig>): DrizzleSeedConfig => {
  const adminPassword = overrides?.admin?.password ?? env.ADMIN_PASSWORD ?? "admin123456";

  return DrizzleSeedConfigSchema.parse({
    admin: {
      name: overrides?.admin?.name ?? env.ADMIN_NAME,
      email: overrides?.admin?.email ?? env.ADMIN_EMAIL,
      password: adminPassword,
      role: "admin",
    },
    tunnels: overrides?.tunnels ?? DEFAULT_SEED_TUNNELS,
    collections: overrides?.collections ?? DEFAULT_SEED_COLLECTIONS,
    endpoints: overrides?.endpoints ?? DEFAULT_SEED_ENDPOINTS,
  });
};

/**
 * Singleton active Drizzle seeding configuration instance.
 */
export const seedConfig: DrizzleSeedConfig = getSeedConfig();
