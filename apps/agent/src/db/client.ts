import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { agentDbFile } from "@agent/platform/data-dir";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

import { migrateAgentDatabase } from "./migrate";

/**
 * Opens local persistence using the same Bun SQLite/Drizzle split as the server.
 * @param filename - Local file path, or :memory: for isolated migration tests.
 * @returns Raw connection for lifecycle/legacy adapters and the typed Drizzle query client.
 * @throws On permissions, open or migration failure; an unsuccessful open closes its connection.
 */
export const openAgentDatabase = (filename: string) => {
  // 1. Restrict local credentials to the current OS account. The umask also covers the -wal/-shm
  // files SQLite creates later, which a one-off chmod before WAL would miss.
  process.umask(0o077);
  if (filename !== ":memory:") {
    mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    chmodSync(dirname(filename), 0o700);
  }
  const localDb = new Database(filename, { create: true });
  try {
    // 2. Incremental vacuum only takes effect on a fresh file; retention reclaims pages in small
    // steps instead of rewriting the whole DB.
    localDb.run("PRAGMA auto_vacuum = INCREMENTAL;");
    // 3. Keep existing WAL/cache settings; all schema changes are owned by the migration journal.
    localDb.run("PRAGMA journal_mode = WAL;");
    localDb.run("PRAGMA synchronous = NORMAL;");
    localDb.run("PRAGMA foreign_keys = ON;");
    localDb.run("PRAGMA cache_size = -2000;");
    localDb.run("PRAGMA busy_timeout = 5000;");
    migrateAgentDatabase(localDb);
    // 4. Files that predate the umask (older installs) are tightened after WAL exists.
    if (filename !== ":memory:") {
      for (const path of [filename, `${filename}-wal`, `${filename}-shm`]) {
        if (existsSync(path)) chmodSync(path, 0o600);
      }
    }
    return { localDb, db: drizzle({ client: localDb }) };
  } catch (cause) {
    localDb.close();
    throw new Error("Agent database migration failed; startup aborted", { cause });
  }
};

export const { localDb, db } = openAgentDatabase(agentDbFile);
