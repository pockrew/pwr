import { sql } from "drizzle-orm";
import {
  blob,
  foreignKey,
  index,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { endpoints, tunnels } from "./tunnels";
import { uuid } from "./uuid.helper";

// Column order matters: SQLite reads columns in order, so the payload BLOB is declared last and
// metadata scans never walk its overflow pages.
export const webhookEvents = snakeCase.table(
  "webhook_events",
  {
    id: uuid("id"),
    method: text().notNull(),
    contentType: text().notNull(),
    sizeBytes: integer({ mode: "number" }).notNull().default(0),
    queryParams: text().notNull(),
    rawQuery: text(),
    headers: text().notNull(),
    sourceIp: text().notNull(),
    userAgent: text(),

    // Provider's own delivery ID (X-GitHub-Delivery, Stripe event id, webhook-id) for dedupe.
    providerDeliveryId: text(),

    // Keep the ingress selector for the stored-event subscriber and crash recovery.
    collectionId: text(),
    endpointPath: text(),
    deliveryPreparedAt: integer({ mode: "timestamp" }),
    // Recovery backoff so one failing event cannot block the ones behind it.
    prepareAttempts: integer({ mode: "number" }).notNull().default(0),
    nextRetryAt: integer({ mode: "number" }),

    status: integer({ mode: "number" }).notNull().default(200),

    tunnelId: text()
      .notNull()
      .references(() => tunnels.id),

    // times that server received
    receivedAt: integer({ mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),

    payload: blob({ mode: "buffer" }),
  },
  (t) => [
    index("idx_events_tunnel_received").on(t.tunnelId, t.receivedAt),
    index("idx_events_unprepared")
      .on(t.receivedAt, t.id)
      .where(sql`${t.deliveryPreparedAt} IS NULL`),
    uniqueIndex("idx_events_provider_delivery").on(t.tunnelId, t.providerDeliveryId),
  ],
);

export const webhookDeliveries = snakeCase.table(
  "webhook_deliveries",
  {
    id: uuid("id"),
    eventId: text()
      .notNull()
      .references(() => webhookEvents.id),
    trigger: text().notNull(), // 'live' | 'replay'
    replayOfDeliveryId: text(),
    relayStatus: text(), // null | 'SUCCESS' | 'FAILED'; independent of agent receipt
    relayedAt: integer({ mode: "timestamp" }),

    // Outcome only: target URL, response headers and body stay on the agent.
    responseStatus: integer({ mode: "number" }),
    latencyMs: integer({ mode: "number" }),
    responseBytes: integer({ mode: "number" }),

    // delivery status
    status: text().notNull(), // "PENDING" | "DELIVERED" (agent receipt, not target result)

    endpointId: text()
      .notNull()
      .references(() => endpoints.id),

    // times that server delivery relay request to agent
    sentAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),

    // times that agents received relay request from server
    receivedAt: integer({ mode: "timestamp" }),
  },
  (table) => [
    foreignKey({ columns: [table.replayOfDeliveryId], foreignColumns: [table.id] }),
    index("idx_deliveries_event").on(table.eventId),
    index("idx_deliveries_status_endpoint").on(table.status, table.endpointId),
    // One live delivery per endpoint, even if live preparation and recovery race.
    uniqueIndex("idx_deliveries_live_endpoint")
      .on(table.eventId, table.endpointId)
      .where(sql`${table.trigger} = 'live'`),
  ],
);
