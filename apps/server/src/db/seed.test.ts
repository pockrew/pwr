import { beforeEach, describe, expect, test } from "bun:test";

process.env["BETTER_AUTH_SECRET"] = "seed-test-secret-at-least-32-characters-long-safe";
process.env["ADMIN_EMAIL"] = "seed-test-admin@example.com";
process.env["ADMIN_PASSWORD"] = "seed-test-password-123";
process.env["ADMIN_NAME"] = "Seed Administrator";

const { db } = await import("@server/db/client");
const { account, user } = await import("@server/db/schemas/auth");
const { collections, endpoints, tunnels } = await import("@server/db/schemas/tunnels");
const { env } = await import("@server/platform/env");
const { getSeedConfig, seedConfig } = await import("./seed.config");
const { seedDatabase } = await import("./seed");

describe("Drizzle Database Seeding", () => {
  beforeEach(() => {
    db.delete(endpoints).run();
    db.delete(collections).run();
    db.delete(tunnels).run();
    db.delete(user).run();
  });

  test("seedConfig resolves strongly-typed configuration with environment defaults", () => {
    expect(seedConfig.admin.email).toBe(env.ADMIN_EMAIL);
    expect(seedConfig.admin.name).toBe(env.ADMIN_NAME);
    expect(seedConfig.tunnels.length).toBeGreaterThan(0);
    expect(seedConfig.collections.length).toBeGreaterThan(0);
    expect(seedConfig.endpoints.length).toBeGreaterThan(0);
  });

  test("getSeedConfig supports runtime configuration overrides", () => {
    const custom = getSeedConfig({
      admin: {
        name: "Custom Admin",
        email: "custom@example.com",
        password: "custom-password-123",
        role: "admin",
      },
      tunnels: [
        {
          id: "custom-tunnel",
          slug: "custom",
          name: "Custom Ingress",
          orgId: "custom-org",
          isActive: true,
        },
      ],
    });

    expect(custom.admin.name).toBe("Custom Admin");
    expect(custom.admin.email).toBe("custom@example.com");
    expect(custom.tunnels).toHaveLength(1);
    expect(custom.tunnels[0]?.id).toBe("custom-tunnel");
  });

  test("seedDatabase creates admin user, tunnels, collections, and endpoints", async () => {
    const result = await seedDatabase();

    expect(result.adminCreated).toBe(true);
    expect(result.tunnelsCreated).toBeGreaterThan(0);
    expect(result.collectionsCreated).toBeGreaterThan(0);
    expect(result.endpointsCreated).toBeGreaterThan(0);

    const users = db.select().from(user).all();
    expect(users).toHaveLength(1);
    expect(users[0]?.email).toBe(env.ADMIN_EMAIL);
    expect(users[0]?.name).toBe(env.ADMIN_NAME);

    const accounts = db.select().from(account).all();
    expect(accounts).toHaveLength(1);

    const tunnelRows = db.select().from(tunnels).all();
    expect(tunnelRows.length).toBeGreaterThan(0);

    const collectionRows = db.select().from(collections).all();
    expect(collectionRows.length).toBeGreaterThan(0);

    const endpointRows = db.select().from(endpoints).all();
    expect(endpointRows.length).toBeGreaterThan(0);
  });

  test("seedDatabase is idempotent on consecutive executions", async () => {
    const firstResult = await seedDatabase();
    expect(firstResult.adminCreated).toBe(true);

    const secondResult = await seedDatabase();
    expect(secondResult.adminCreated).toBe(false);
    expect(secondResult.tunnelsCreated).toBe(0);
    expect(secondResult.collectionsCreated).toBe(0);
    expect(secondResult.endpointsCreated).toBe(0);

    const users = db.select().from(user).all();
    expect(users).toHaveLength(1);
  });

  test("seedDatabase with reset cleans existing state and reseeds", async () => {
    await seedDatabase();
    const result = await seedDatabase({ reset: true });

    expect(result.adminCreated).toBe(true);
    expect(result.tunnelsCreated).toBeGreaterThan(0);
    expect(result.collectionsCreated).toBeGreaterThan(0);
    expect(result.endpointsCreated).toBeGreaterThan(0);

    const users = db.select().from(user).all();
    expect(users).toHaveLength(1);
  });
});
