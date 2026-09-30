import { integer, snakeCase, text } from "drizzle-orm/sqlite-core";

/** Server settings edited in Admin, one JSON document per key (e.g. `logs`). */
export const server_settings = snakeCase.table("server_settings", {
  key: text().primaryKey(),
  value: text().notNull(),
  updatedAt: integer({ mode: "timestamp" })
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date())
    .notNull(),
});
