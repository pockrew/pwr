import { hc } from "hono/client";

import type { AgentAppType } from "@pockrew/pwr-agent/rpc";
import { readAgentToken } from "@pockrew/pwr-core";
import {
  AgentDeliveryStreamSchema,
  WebhookEventSchema,
  type AgentDeliveryStream,
  type AgentRelayConnect,
  type AgentRequestScope,
  type AgentTunnelSession,
  type MaintenanceActionInput,
  type WebhookDelivery,
  type WebhookEvent,
} from "@pockrew/pwr-shared/schemas";

import { agentPort } from "./daemon.lifecycle";

export {
  agentPort,
  checkAgentHealth,
  ensureAgentDaemonRunning,
  resolveAgentCommand,
  type IAgentHealth,
} from "./daemon.lifecycle";

/**
 * Type alias for the strongly-typed Hono RPC client connected to the Agent daemon.
 */
export type AgentRpcClient = ReturnType<typeof hc<AgentAppType>>;

/** Local API token header, read from the agent's owner-only token file on every request. */
export const agentAuthHeaders = (): Record<string, string> => {
  const token = readAgentToken();
  return token ? { authorization: `Bearer ${token}` } : {};
};

/**
 * Tunnel descriptor structure returned by the Agent relay management endpoint.
 */
export type IAgentTunnelItem = AgentTunnelSession;

/** Public categories avoid exposing server URLs, credentials or raw socket errors. */
export const describeTunnelError = (reason?: IAgentTunnelItem["lastError"]): string | null => {
  switch (reason) {
    case "relay_handshake_failed":
      return "Relay handshake failed; check server reachability, tunnel slug and relay key";
    case "connection_lost":
      return "Server connection was lost; Agent is retrying";
    case "local_socket_failed":
      return "Agent could not open the relay socket; check local proxy/TLS settings";
    case "tunnel_in_use":
      return "Another agent is connected to this tunnel; stop it, or rerun with --takeover to replace it";
    default:
      return null;
  }
};

/**
 * Request list query filters for the local Agent SQLite store.
 */
export interface IAgentRequestListQuery {
  limit?: number | undefined;
  cursor?: string | undefined;
  tunnelId?: string | undefined;
  projectId?: string | undefined;
}

/**
 * Creates a type-safe Hono RPC client instance targeting the local Agent daemon.
 *
 * @param port - Pinned `--port`; omitted, the running agent's port is discovered.
 * @returns Strongly-typed RPC client instance.
 */
export const createAgentRpcClient = (port?: number): AgentRpcClient => {
  // 1. Construct local HTTP base URL
  const baseUrl = `http://127.0.0.1:${agentPort(port)}`;

  // 2. Initialize Hono RPC client with full agent router schema and the local API token.
  return hc<AgentAppType>(baseUrl, { headers: agentAuthHeaders });
};

/**
 * Retrieves the current list of active webhook tunnels managed by the local Agent daemon.
 *
 * @param client - Typed Agent RPC client.
 * @returns Array of tunnel status descriptors.
 */
export const fetchAgentTunnels = async (client: AgentRpcClient): Promise<IAgentTunnelItem[]> => {
  const res = await client.tunnels.$get();
  if (!res.ok) throw new Error(`Could not load tunnels (HTTP ${res.status})`);
  return (await res.json()).data.tunnels;
};

/** Read the Agent's actual relay state; accepting a connect command is not a WebSocket handshake. */
export const getAgentTunnel = async (
  client: AgentRpcClient,
  tunnelId: string,
): Promise<IAgentTunnelItem | null> => {
  const res = await client.tunnels[":tunnelId"].$get({ param: { tunnelId } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Could not load tunnel (HTTP ${res.status})`);
  return (await res.json()).data.tunnel;
};

/**
 * Instructs the local Agent daemon to establish a reverse WebSocket tunnel to the central server.
 *
 * @param client - Typed Agent RPC client.
 * @param payload - Tunnel connection configuration parameters.
 * @returns True if the agent accepted the connection command.
 */
export const agentConnectTunnel = async (
  client: AgentRpcClient,
  payload: AgentRelayConnect,
): Promise<{ success: boolean; message?: string | undefined }> => {
  try {
    // 1. Send tunnel connect RPC command
    const res = await client.tunnels.connect.$post({ json: payload });

    // 2. Parse response and return status
    if (res.ok) {
      return { success: true };
    }
    const err: unknown = await res.json();
    return {
      success: false,
      message:
        res.status === 409
          ? "Relay key missing; pass --api-key once so Agent can save it locally"
          : typeof err === "object" && err !== null && "code" in err
            ? `${String(err.code)} (HTTP ${res.status})`
            : `Agent rejected connection (HTTP ${res.status})`,
    };
  } catch (error) {
    // 3. Catch unexpected connection errors
    return { success: false, message: error instanceof Error ? error.message : "RPC failure" };
  }
};

/**
 * Instructs the local Agent daemon to disconnect an active WebSocket tunnel.
 *
 * @param client - Typed Agent RPC client.
 * @param tunnelId - Identifier of the tunnel to terminate.
 * @returns True if the tunnel was successfully disconnected.
 */
export const agentDisconnectTunnel = async (
  client: AgentRpcClient,
  tunnelId: string,
): Promise<boolean> => {
  try {
    // 1. Send disconnect command to agent
    const res = await client.tunnels.disconnect.$post({ json: { tunnelId } });
    return res.ok;
  } catch {
    // 2. Return false on failure
    return false;
  }
};

/**
 * Queries the list of persisted webhook requests from the Agent daemon's local SQLite database.
 *
 * @param client - Typed Agent RPC client.
 * @param query - Optional filtering and pagination parameters.
 * @returns List of webhook events.
 */
export const agentListRequests = async (
  client: AgentRpcClient,
  query?: IAgentRequestListQuery | undefined,
): Promise<{ items: WebhookEvent[]; nextCursor: string | null; count: number }> => {
  const queryParams: Record<string, string> = {};
  if (query?.limit !== undefined) queryParams["limit"] = String(query.limit);
  if (query?.cursor) queryParams["cursor"] = query.cursor;
  if (query?.tunnelId) queryParams["tunnelId"] = query.tunnelId;
  if (query?.projectId) queryParams["projectId"] = query.projectId;
  const res = await client.requests.$get({ query: queryParams });
  if (!res.ok) throw new Error(`Could not load requests (HTTP ${res.status})`);
  const { data } = await res.json();
  return {
    items: data.items,
    nextCursor: data.nextCursor,
    count: data.count,
  };
};

/**
 * Retrieves the full details of a specific webhook request by its identifier.
 *
 * @param client - Typed Agent RPC client.
 * @param id - Unique request UUID identifier.
 * @returns WebhookEvent object or null if not found.
 */
export const agentGetRequest = async (
  client: AgentRpcClient,
  id: string,
  scope?: AgentRequestScope,
): Promise<WebhookEvent | null> => {
  const res = await client.requests[":id"].$get({ param: { id }, query: scope ?? {} });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Could not load request (HTTP ${res.status})`);
  const { data } = await res.json();
  return data;
};

/** List a stored event's delivery IDs so replay can select one target unambiguously. */
export const agentListRequestDeliveries = async (
  client: AgentRpcClient,
  id: string,
  scope?: AgentRequestScope,
) => {
  const fetchPage = async (cursor?: string) => {
    const res = await client.requests[":id"].deliveries.$get({
      param: { id },
      query: { ...scope, limit: "100", ...(cursor ? { cursor } : {}) },
    });
    if (!res.ok) throw new Error(`Could not load deliveries (HTTP ${res.status})`);
    return (await res.json()).data;
  };
  let page = await fetchPage();
  const items = [...page.items];
  while (page.nextCursor) {
    page = await fetchPage(page.nextCursor);
    items.push(...page.items);
  }
  return items;
};

/**
 * Triggers a local webhook replay through the Agent daemon to the target endpoint.
 *
 * @param client - Typed Agent RPC client.
 * @param id - Stored delivery ID, or an event ID with exactly one target.
 * @returns Resulting webhook delivery record.
 */
export const agentReplayRequest = async (
  client: AgentRpcClient,
  id: string,
  scope?: AgentRequestScope,
): Promise<{
  success: boolean;
  delivery?: WebhookDelivery | undefined;
  error?: string | undefined;
}> => {
  try {
    // 1. Send replay RPC request
    const res = await client.replay[":id"].$post({
      param: { id },
      json: {},
      query: scope ?? {},
    });

    // 2. Parse delivery result on success
    if (res.ok) {
      const { data } = await res.json();
      return { success: true, delivery: data.delivery };
    }

    const err = await res.json();
    return {
      success: false,
      error:
        res.status === 409
          ? "Multiple targets match this event; inspect it and replay one delivery ID"
          : "code" in err
            ? `${String(err.code)} (HTTP ${res.status})`
            : `Replay failed (HTTP ${res.status})`,
    };
  } catch (error) {
    // 3. Catch error
    return {
      success: false,
      error: error instanceof Error ? error.message : "RPC execution failed",
    };
  }
};

/**
 * Fetches the current corporate proxy configuration and system-detected settings from the Agent.
 *
 * @param client - Typed Agent RPC client.
 * @returns Proxy configuration and auto-detected system proxy.
 */
export const agentGetProxy = async (client: AgentRpcClient) => {
  try {
    // 1. Dispatch proxy query RPC
    const res = await client.proxy.$get();
    if (res.ok) {
      return (await res.json()).data;
    }
  } catch {
    // 2. Fallback on error
  }
  return null;
};

/**
 * Updates the corporate proxy settings managed by the Agent daemon.
 *
 * @param client - Typed Agent RPC client.
 * @param payload - Updated proxy configuration fields.
 * @returns Result object indicating success or failure.
 */
export const agentSetProxy = async (
  client: AgentRpcClient,
  payload: {
    mode?: "auto" | "manual" | "disabled" | undefined;
    httpProxy?: string | undefined;
    httpsProxy?: string | undefined;
    noProxy?: string | undefined;
    caCertPath?: string | undefined;
  },
) => {
  try {
    // The Agent replaces this document; preserve fields the CLI caller did not change.
    const current = await agentGetProxy(client);
    if (!current) return null;
    const changes = Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined),
    );
    const res = await client.proxy.$post({ json: { ...current.config, ...changes } });
    if (res.ok) {
      return { success: true, ...(await res.json()).data };
    }
  } catch {
    // 2. Fallback on error
  }
  return null;
};

/**
 * Executes a retention cleanup sweep on the Agent's local SQLite database.
 *
 * @param client - Typed Agent RPC client.
 * @param payload - Retention maintenance parameters.
 * @returns Maintenance sweep result metrics.
 */
export const agentCleanRetention = async (
  client: AgentRpcClient,
  payload: MaintenanceActionInput,
) => {
  try {
    // 1. Dispatch retention cleanup RPC
    const res = await client.maintenance.clean.$post({ json: payload });
    if (res.ok) {
      return (await res.json()).data;
    }
  } catch {
    // 2. Fallback on error
  }
  return null;
};

/**
 * Subscribes to the Agent daemon's Server-Sent Events (SSE) stream for real-time webhook deliveries.
 *
 * @param port - Local HTTP port of the Agent daemon.
 * @param tunnelId - Tunnel identifier to filter events.
 * @param onEvent - Callback invoked when a new webhook event is delivered.
 * @param onStatus - Callback invoked on connection status transitions.
 * @returns AbortController to disconnect and close the SSE stream.
 */
export const streamAgentEvents = (
  port: number,
  tunnelId: string,
  onEvent: (event: WebhookEvent) => void,
  onStatus?: (status: "connected" | "disconnected" | "reconnecting") => void,
  onDelivery?: (event: AgentDeliveryStream) => void,
): AbortController => {
  // 1. Initialize abort controller for lifecycle management
  const controller = new AbortController();
  const url = `http://127.0.0.1:${port}/events/stream/${encodeURIComponent(tunnelId)}`;

  // 2. Spawn async stream reader loop
  void (async () => {
    while (!controller.signal.aborted) {
      try {
        onStatus?.("reconnecting");

        // 3. Establish HTTP SSE connection
        const response = await fetch(url, {
          signal: controller.signal,
          headers: agentAuthHeaders(),
        });
        if (!response.ok || !response.body) {
          throw new Error(`SSE stream failed with HTTP ${response.status}`);
        }

        onStatus?.("connected");

        // 4. Consume stream chunks and parse newline-delimited SSE messages
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data:")) {
              const jsonStr = trimmed.slice(5).trim();
              if (jsonStr) {
                try {
                  const parsed: unknown = JSON.parse(jsonStr);
                  if (typeof parsed !== "object" || parsed === null) continue;
                  const kind = "type" in parsed ? parsed.type : undefined;
                  if (kind === "delivery_result") {
                    const result = AgentDeliveryStreamSchema.safeParse(parsed);
                    if (result.success) onDelivery?.(result.data);
                  } else if (kind !== "connected" && kind !== "ping") {
                    const event = WebhookEventSchema.safeParse(parsed);
                    if (event.success) onEvent(event.data);
                  }
                } catch {
                  // Ignore JSON parse errors on malformed chunks
                }
              }
            }
          }
        }
        if (!controller.signal.aborted) throw new Error("SSE stream ended");
      } catch {
        if (controller.signal.aborted) break;
        onStatus?.("disconnected");
        // 5. Backoff delay before reconnecting SSE stream
        await Bun.sleep(1500);
      }
    }
  })();

  return controller;
};
