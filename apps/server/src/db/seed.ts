// @server-only
import { db } from "@server/db/client";
import { user } from "@server/db/schemas/auth";
import { collections, endpoints, tunnels } from "@server/db/schemas/tunnels";
import { auth } from "@server/modules/auth/configs";
import { eq } from "drizzle-orm";

import { seedConfig, type DrizzleSeedConfig, type SeedAdminConfig } from "./seed.config";

export type SeedResult = {
  adminCreated: boolean;
  tunnelsCreated: number;
  collectionsCreated: number;
  endpointsCreated: number;
};

/**
 * Ensures the configured admin user exists in the Better Auth database.
 * If missing, registers it through the Better Auth credentials API.
 *
 * @param admin - Target admin user configuration.
 * @returns True if a new admin account was created, false if it already existed.
 */
export const seedAdminUser = async (
  admin: SeedAdminConfig = seedConfig.admin,
): Promise<boolean> => {
  const existing = db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, admin.email.toLowerCase()))
    .get();

  if (existing) {
    return false;
  }

  await auth.api.signUpEmail({
    body: {
      name: admin.name,
      email: admin.email.toLowerCase(),
      password: admin.password,
    },
  });

  return true;
};

/**
 * Idempotently seeds database entities according to the Drizzle seeding configuration.
 * Safe to execute against fresh or existing databases without duplicate entries.
 *
 * @param options - Seeding options (reset flag or custom config overrides).
 * @returns Summary of created records across all seeded tables.
 */
export const seedDatabase = async (options?: {
  reset?: boolean;
  config?: DrizzleSeedConfig;
}): Promise<SeedResult> => {
  const config = options?.config ?? seedConfig;

  // 1. Perform destructive cascade reset if explicitly requested
  if (options?.reset) {
    db.delete(endpoints).run();
    db.delete(collections).run();
    db.delete(tunnels).run();
    db.delete(user).run();
  }

  // 2. Seed administrative identity
  const adminCreated = await seedAdminUser(config.admin);

  // 3. Seed ingress tunnels
  let tunnelsCreated = 0;
  for (const t of config.tunnels) {
    const existing = db.select({ id: tunnels.id }).from(tunnels).where(eq(tunnels.id, t.id)).get();

    if (!existing) {
      db.insert(tunnels)
        .values({
          id: t.id,
          slug: t.slug,
          name: t.name,
          orgId: t.orgId,
          isActive: t.isActive,
        })
        .run();
      tunnelsCreated++;
    }
  }

  // 4. Seed webhook collections
  let collectionsCreated = 0;
  for (const c of config.collections) {
    const existing = db
      .select({ id: collections.id })
      .from(collections)
      .where(eq(collections.id, c.id))
      .get();

    if (!existing) {
      db.insert(collections)
        .values({
          id: c.id,
          tunnelId: c.tunnelId,
          slug: c.slug,
          isActive: c.isActive,
        })
        .run();
      collectionsCreated++;
    }
  }

  // 5. Seed webhook fan-out endpoints
  let endpointsCreated = 0;
  for (const e of config.endpoints) {
    const existing = db
      .select({ id: endpoints.id })
      .from(endpoints)
      .where(eq(endpoints.id, e.id))
      .get();

    if (!existing) {
      db.insert(endpoints)
        .values({
          id: e.id,
          collectionId: e.collectionId,
          pathName: e.pathName,
          isActive: e.isActive,
          isPaused: e.isPaused,
        })
        .run();
      endpointsCreated++;
    }
  }

  return {
    adminCreated,
    tunnelsCreated,
    collectionsCreated,
    endpointsCreated,
  };
};

// Executable entrypoint when invoked via `bun src/db/seed.ts`
if (import.meta.main) {
  const isReset = process.argv.includes("--reset");
  console.log(`🌱 [drizzle-seed] Seeding database${isReset ? " (reset mode)" : ""}...`);
  try {
    const result = await seedDatabase({ reset: isReset });
    console.log("✅ [drizzle-seed] Seeding complete:");
    console.log(`   - Admin account: ${result.adminCreated ? "created" : "already present"}`);
    console.log(`   - Tunnels: ${result.tunnelsCreated} inserted`);
    console.log(`   - Collections: ${result.collectionsCreated} inserted`);
    console.log(`   - Endpoints: ${result.endpointsCreated} inserted`);
    process.exit(0);
  } catch (err) {
    console.error("❌ [drizzle-seed] Seeding failed:", err);
    process.exit(1);
  }
}
