import { integer, snakeCase, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";

import { timestamps } from "./timestamp.helper";
import { uuid } from "./uuid.helper";

// main tunnels
export const tunnels = snakeCase.table(
  "tunnels",
  {
    id: uuid("id"), // project/collections
    orgId: text().notNull().default("default"),
    slug: text().notNull(),
    name: text().notNull(),

    // allowed providers ips to connect
    allowedProviderIps: text(),
    deniedProviderIps: text(),

    // allowed agent ips to connect
    allowedAgentIps: text(),
    deniedAgentIps: text(),

    isActive: integer({ mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (table) => [uniqueIndex("idx_tunnels_slug").on(table.slug)],
);

export const collections = snakeCase.table(
  "collections",
  {
    id: uuid("id"),
    tunnelId: text()
      .notNull()
      .references(() => tunnels.id, { onDelete: "cascade" }),
    slug: text(),
    isActive: integer({ mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (t) => [unique("unique_collection_tunnelId_name").on(t.tunnelId, t.slug)],
);

// mutiplex endpoints for fanout
export const endpoints = snakeCase.table("endpoints", {
  id: uuid("id"),
  collectionId: text()
    .notNull()
    .references(() => collections.id, { onDelete: "cascade" }), // project/collections
  pathName: text().notNull(), // path name to match, e.g /api/webhook
  isActive: integer({ mode: "boolean" }).notNull().default(true),
  isPaused: integer({ mode: "boolean" }).notNull().default(false),
  ...timestamps,
});
