import { index, snakeCase, text } from "drizzle-orm/sqlite-core";

import { timestamps } from "./timestamp.helper";
import { uuid } from "./uuid.helper";

export const audit_logs = snakeCase.table(
  "audit_logs",
  {
    id: uuid("id"),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: text().notNull(),
    details: text(),
    ...timestamps,
  },
  (table) => [
    index("idx_audit_logs_action").on(table.action),
    index("idx_audit_logs_entity_type").on(table.entityType),
    index("idx_audit_logs_entity_id").on(table.entityId),
    index("idx_audit_logs_created").on(table.createdAt),
  ],
);
