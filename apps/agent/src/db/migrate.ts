import type { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

// Bun embeds the SQL in compiled agents; migrations do not depend on the launch directory.
import baseline from "./migrations/20260925170218_v0_1_baseline/migration.sql" with { type: "text" };

/**
 * Applies the versioned Drizzle journal to the local database.
 * @param raw - Open local SQLite connection; no network or target execution occurs.
 * @throws On an incompatible schema/failed statement. Drizzle rolls back migration statements.
 */
export const migrateAgentDatabase = (raw: Database): void => {
  // Later versions append entries here; already applied migrations are never rerun.
  migrate(drizzle({ client: raw }), {
    migrationsJournal: [
      {
        name: "20260925170218_v0_1_baseline",
        timestamp: Date.UTC(2026, 8, 25, 17, 2, 18),
        sql: baseline,
      },
    ],
  });
};
