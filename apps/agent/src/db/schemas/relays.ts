import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** Credentials stay in the agent DB and are scoped to the remote server plus tunnel slug. */
export const localRelayKeys = sqliteTable(
  "local_relay_keys",
  {
    serverUrl: text("server_url").notNull(),
    slug: text("tunnel_slug").notNull(),
    apiKey: text("api_key").notNull(),
  },
  (t) => [primaryKey({ columns: [t.serverUrl, t.slug] })],
);
export const localEndpointSecrets = sqliteTable(
  "local_endpoint_secrets",
  {
    serverUrl: text("server_url").notNull(),
    slug: text("tunnel_slug").notNull(),
    endpointId: text("endpoint_id").notNull(),
    headerName: text("header_name").notNull(),
    secret: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.serverUrl, t.slug, t.endpointId] })],
);

/** Target URLs are agent-owned: the server never supplies or learns where deliveries go. */
export const localEndpointTargets = sqliteTable(
  "local_endpoint_targets",
  {
    serverUrl: text("server_url").notNull(),
    slug: text("tunnel_slug").notNull(),
    endpointId: text("endpoint_id").notNull(),
    url: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.serverUrl, t.slug, t.endpointId] })],
);

/** Durable queue/audit metadata points at the single event BLOB; no provider body copies. */
export const localRelayPackages = sqliteTable(
  "local_relay_packages",
  {
    id: text().notNull(),
    serverUrl: text("server_url").notNull(),
    slug: text("tunnel_slug").notNull(),
    eventId: text("event_id").notNull(),
    metadata: text().notNull(),
    projectId: text("project_id").notNull(),
    completed: integer({ mode: "boolean" }).notNull().default(false),
    completedAt: integer("completed_at"),
    reportedAt: integer("reported_at"),
    ack: text(),
    result: text(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.serverUrl, t.id] }),
    index("idx_relay_pending").on(t.serverUrl, t.slug, t.completed, t.createdAt),
    index("idx_relay_event").on(t.eventId),
  ],
);

/** Payload-free deduplication survives history pruning for a bounded time. Never holds credentials. */
export const localRelayTombstones = sqliteTable(
  "local_relay_tombstones",
  {
    serverUrl: text("server_url").notNull(),
    id: text().notNull(),
    slug: text("tunnel_slug").notNull(),
    eventId: text("event_id").notNull(),
    endpointId: text("endpoint_id").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.serverUrl, t.id] }),
    index("idx_relay_dedupe_expiry").on(t.expiresAt),
  ],
);

/** Only transport resume state is persisted; API keys and endpoint secrets have separate owners. */
export const localRelaySessions = sqliteTable(
  "local_relay_sessions",
  {
    serverUrl: text("server_url").notNull(),
    slug: text("tunnel_slug").notNull(),
    tunnelId: text("tunnel_id").notNull(),
    projectId: text("project_id").notNull().default("default"),
    isPaused: integer("is_paused", { mode: "boolean" }).notNull().default(false),
    enabled: integer({ mode: "boolean" }).notNull().default(true),
  },
  (t) => [
    primaryKey({ columns: [t.serverUrl, t.slug] }),
    uniqueIndex("idx_relay_session_alias").on(t.tunnelId),
  ],
);
