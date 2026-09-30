import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";

import { migrateAgentDatabase } from "./migrate";
import { localRelayKeys } from "./schemas";

test("fresh migration creates the relay schema once and can run again without changing data", () => {
  using raw = new Database(":memory:");
  migrateAgentDatabase(raw);
  const tables = raw
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'local_%'",
    )
    .all()
    .map((row) => row.name);
  expect(tables).toContain("local_endpoint_targets");
  raw.run("INSERT INTO local_relay_keys VALUES ('http://server', 'slug', 'local-key')");
  migrateAgentDatabase(raw);
  expect(raw.query("SELECT * FROM __drizzle_migrations").all()).toHaveLength(1);
  expect(drizzle({ client: raw }).select().from(localRelayKeys).get()?.apiKey).toBe("local-key");
});
