import { blob, index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Original events contain payload/audit data only; delivery execution lives in relay packages. */
export const localEvents = sqliteTable(
  "local_events",
  {
    id: text().primaryKey(),
    tunnelId: text("tunnel_id").notNull(),
    orgId: text("org_id").notNull().default("default"),
    projectId: text("project_id").notNull().default("default"),
    method: text().notNull(),
    url: text(),
    headers: text().notNull(),
    queryParams: text("query_params"),
    body: text(),
    payload: blob({ mode: "buffer" }),
    payloadText: text("payload_text"),
    isBinary: integer("is_binary").default(0),
    sizeBytes: integer("size_bytes").default(0),
    // Historical attempt count is audit data only; the event-level retry queue has been removed.
    attempts: integer().default(0),
    replayCount: integer("replay_count").default(0),
    status: integer().default(200),
    executionTimeMs: real("execution_time_ms").default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at"),
  },
  (t) => [
    index("idx_events_proj").on(t.projectId, t.createdAt),
    index("idx_events_tunnel").on(t.tunnelId, t.createdAt),
  ],
);

/** Local result IDs are server delivery IDs or agent-generated replay UUIDs. */
export const localDeliveries = sqliteTable(
  "local_deliveries",
  {
    id: text().primaryKey(),
    webhookId: text("webhook_id").notNull(),
    tunnelId: text("tunnel_id").notNull(),
    destinationId: text("destination_id"),
    orgId: text("org_id").notNull().default("default"),
    projectId: text("project_id").notNull().default("default"),
    targetUrl: text("target_url").notNull(),
    statusCode: integer("status_code").notNull(),
    latencyMs: real("latency_ms").notNull(),
    requestHeaders: text("request_headers"),
    requestBody: text("request_body"),
    responseHeaders: text("response_headers"),
    responseBody: text("response_body"),
    deliveredAt: integer("delivered_at").notNull(),
    updatedAt: integer("updated_at"),
  },
  (t) => [index("idx_deliveries_webhook").on(t.webhookId)],
);
