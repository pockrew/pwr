// @server-only
import { integer } from "drizzle-orm/sqlite-core";

export const timestamps = {
  updatedAt: integer({ mode: "timestamp" }).$onUpdate(() => new Date()),
  createdAt: integer({ mode: "timestamp" })
    .$defaultFn(() => new Date())
    .notNull(),
  deletedAt: integer({ mode: "timestamp" }),
};
