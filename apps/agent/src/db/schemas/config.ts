import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** The local snapshot is also the durable outbox; no separate queue duplicates config data. */
export const localConfig = sqliteTable(
  "local_config",
  {
    serverUrl: text("server_url").notNull(),
    slug: text("tunnel_slug").notNull(),
    kind: text().notNull(),
    id: text().notNull(),
    data: text().notNull(),
    base: text(),
    dirty: integer({ mode: "boolean" }).notNull().default(false),
    // SQL NULL means no conflict; JSON null means a conflict with an absent remote record.
    conflict: text(),
  },
  (t) => [primaryKey({ columns: [t.serverUrl, t.slug, t.kind, t.id] })],
);

/** Persist binding/progress separately from session aliases, which may be replaced at connect. */
export const localConfigState = sqliteTable(
  "local_config_state",
  {
    serverUrl: text("server_url").notNull(),
    slug: text("tunnel_slug").notNull(),
    tunnelId: text("tunnel_id").notNull(),
    lastSyncedAt: integer("last_synced_at"),
    error: text(),
  },
  (t) => [primaryKey({ columns: [t.serverUrl, t.slug] })],
);
