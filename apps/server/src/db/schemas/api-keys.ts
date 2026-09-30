import { snakeCase, text } from "drizzle-orm/sqlite-core";

import type { ManagedKeyType, ManagementPermission } from "@pockrew/pwr-shared/schemas";

import { timestamps } from "./timestamp.helper";
import { tunnels } from "./tunnels";
import { uuid } from "./uuid.helper";

export const apiKeys = snakeCase.table("api_keys", {
  id: uuid("id"),
  keyHash: text().notNull().unique(),
  keyPrefix: text().notNull(),
  tunnelId: text()
    .notNull()
    .references(() => tunnels.id),
  name: text().notNull(),
  types: text().notNull().$type<ManagedKeyType>(), // inbound, outbound, admin
  permissions: text({ mode: "json" }).$type<ManagementPermission[]>().notNull().default([]),
  ...timestamps,
});
