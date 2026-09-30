import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { env } from "@server/platform/env";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

const dbDir = dirname(env.DB_FILE_NAME);
if (dbDir && dbDir !== "." && !existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

export const sqliteClient = new Database(env.DB_FILE_NAME, { create: true });
sqliteClient.run("PRAGMA journal_mode = WAL;");
// FULL: a provider gets 200 only after the event is durable, including across power loss.
sqliteClient.run("PRAGMA synchronous = FULL;");
sqliteClient.run("PRAGMA foreign_keys = ON;");
sqliteClient.run("PRAGMA busy_timeout = 5000;");

export const db = drizzle({ client: sqliteClient });

// 1. Resolve migrations directory path (apps/server/src/db/migrations)
const currentDir = import.meta.dir || dirname(new URL(import.meta.url).pathname);
const migrationsFolder = currentDir.startsWith("/data:text")
  ? resolve(process.cwd(), "src/db/migrations")
  : resolve(currentDir, "migrations");

// 2. Execute Drizzle schema migrations automatically upon startup
try {
  if (!existsSync(migrationsFolder)) {
    throw new Error(`Missing database migrations: ${migrationsFolder}`);
  }
  migrate(db, { migrationsFolder });
} catch (err) {
  sqliteClient.close();
  throw new Error("Database migration failed; server startup aborted", { cause: err });
}

/**
 * Validates database connectivity and read health.
 *
 * @returns True if database executes SELECT 1, false otherwise.
 */
export const health = async (): Promise<boolean> => {
  try {
    await db.get(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
};
