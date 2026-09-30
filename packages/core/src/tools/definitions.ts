export interface IMcpToolProperty {
  type: string;
  description?: string | undefined;
  enum?: readonly string[] | undefined;
  default?: string | number | boolean | undefined;
  minimum?: number | undefined;
  maximum?: number | undefined;
  additionalProperties?: { type: string } | undefined;
}

export interface IMcpToolInputSchema {
  type: "object";
  properties: Record<string, IMcpToolProperty>;
  required?: readonly string[] | undefined;
}

export interface IMcpToolDefinition {
  name: string;
  description: string;
  inputSchema: IMcpToolInputSchema;
}

export interface IListTunnelsArgs {
  status?: "all" | "online" | "offline" | undefined;
  project_id?: string | undefined;
}

export interface IGetTunnelStatusArgs {
  tunnel_id: string;
  project_id?: string | undefined;
}

export interface IListRequestsArgs {
  tunnel_id: string;
  project_id?: string | undefined;
  limit?: number | undefined;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | undefined;
}

export interface IGetRequestArgs {
  request_id: string;
  tunnel_id?: string | undefined;
  project_id?: string | undefined;
}

export interface IReplayRequestArgs {
  request_id: string;
  tunnel_id?: string | undefined;
  project_id?: string | undefined;
  target_url?: string | undefined;
  headers_override?: Record<string, string> | undefined;
}

export const MCP_TOOLS: readonly IMcpToolDefinition[] = [
  {
    name: "list_tunnels",
    description:
      "List all webhook tunnels registered under the authenticated organization. Use this to inspect tunnel names, default forwarding targets, active CLI agent counts, and project associations.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["all", "online", "offline"],
          default: "all",
          description:
            "Filter tunnels by connection state: 'all' (default), 'online' (active forwarder connected), or 'offline'.",
        },
        project_id: {
          type: "string",
          description: "Optional project identifier to isolate tunnels for a specific project.",
        },
      },
    },
  },
  {
    name: "get_tunnel_status",
    description:
      "Check the real-time liveness and operational health of a specific webhook tunnel before testing. Verifies whether a local CLI agent is connected to forward incoming webhooks to localhost.",
    inputSchema: {
      type: "object",
      properties: {
        tunnel_id: {
          type: "string",
          description:
            "The unique identifier of the tunnel to inspect (e.g. 'stripe-dev', 'github', or 'default').",
        },
        project_id: {
          type: "string",
          description: "Optional project ID to ensure tunnel belongs to the expected project.",
        },
      },
      required: ["tunnel_id"],
    },
  },
  {
    name: "list_requests",
    description:
      "List captured webhook requests received by a specific tunnel. Provides request IDs, HTTP methods, timestamps, status codes, and ingress latency for selecting requests to replay.",
    inputSchema: {
      type: "object",
      properties: {
        tunnel_id: {
          type: "string",
          description: "The unique tunnel identifier whose captured webhooks you want to list.",
        },
        project_id: {
          type: "string",
          description: "Optional project identifier to scope captured webhook lookup.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 20,
          description:
            "Maximum number of recent webhook requests to return (1 to 100, default: 20).",
        },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
          description: "Optional HTTP method filter (e.g. 'POST').",
        },
      },
      required: ["tunnel_id"],
    },
  },
  {
    name: "get_request",
    description:
      "Retrieve the full raw payload, incoming HTTP headers, query parameters, and execution metadata of a specific captured webhook request by its ID.",
    inputSchema: {
      type: "object",
      properties: {
        request_id: {
          type: "string",
          description: "The unique UUID of the captured webhook request to inspect.",
        },
        tunnel_id: {
          type: "string",
          description: "Optional tunnel ID where the webhook was received (speeds up lookup).",
        },
        project_id: {
          type: "string",
          description: "Optional project ID to ensure request belongs to the intended project.",
        },
      },
      required: ["request_id"],
    },
  },
  {
    name: "replay_request",
    description:
      "Replay a previously captured webhook request directly into the local development server (or custom target URL). Returns the local server's HTTP response code, response body, and roundtrip latency.",
    inputSchema: {
      type: "object",
      properties: {
        request_id: {
          type: "string",
          description: "The unique UUID of the captured webhook request to replay.",
        },
        tunnel_id: {
          type: "string",
          description: "Optional tunnel ID where the webhook was originally captured.",
        },
        project_id: {
          type: "string",
          description: "Optional project ID to prevent accidental cross-project replays.",
        },
        target_url: {
          type: "string",
          description:
            "Optional local URL to send the replayed request to (e.g. 'http://localhost:3000/api/webhook'). Default is the tunnel's configured target URL.",
        },
        headers_override: {
          type: "object",
          additionalProperties: { type: "string" },
          description:
            "Optional key-value headers to override or inject into the replayed request.",
        },
      },
      required: ["request_id"],
    },
  },
];
