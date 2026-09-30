import type { AgentTunnelSession } from "@pockrew/pwr-shared/schemas";

/** Runtime sessions use the public contract; credentials are read exclusively from local DB. */
export type ITunnelSession = AgentTunnelSession;

/**
 * Internal registry entry containing tunnel session metadata and runtime socket handles.
 */
export interface ITunnelEntry {
  /** Session configuration and runtime status */
  session: ITunnelSession;
  /** Active WebSocket instance, or null if reconnecting */
  ws: WebSocket | null;
  /** Report-only transport while storage cannot accept another durable package. */
  intakePaused?: boolean;
  /** Timer handle for scheduled reconnection backoff */
  reconnectTimer?: ReturnType<typeof setTimeout> | undefined;
  /** Canonical tunnel ID confirmed by the authenticated server subscription. */
  serverTunnelId?: string | undefined;
  /** Number of failed connection attempts for bounded reconnect backoff. */
  retryAttempt?: number | undefined;
  /** One-shot request to replace another agent's connection; cleared after subscription. */
  takeover?: boolean | undefined;
  /** Config replication lifetime follows the authenticated socket, with durable work in SQLite. */
  configSync?: { stop: () => void; done: Promise<void> } | undefined;
}
