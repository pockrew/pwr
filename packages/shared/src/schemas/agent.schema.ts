import { z } from "zod";

import { MaintenanceActionInputSchema, ProxyConfigSchema } from "./project.schema";
import {
  AgentRelayConnectSchema,
  AgentReplayToolSchema,
  AgentRequestListSchema,
  AgentTunnelIdSchema,
} from "./relay.schema";

/** Local credentials have no read-value API and never participate in metadata sync. */
export const AgentRelayKeySchema = z.strictObject({
  apiKey: AgentRelayConnectSchema.shape.apiKey.unwrap(),
});
export const AgentStreamQuerySchema = AgentTunnelIdSchema.strict();
export const AgentProxyUpdateSchema = ProxyConfigSchema.extend({
  mode: ProxyConfigSchema.shape.mode,
  httpProxy: z.url({ protocol: /^https?$/ }).optional(),
  httpsProxy: z.url({ protocol: /^https?$/ }).optional(),
}).refine(
  (value) => value.mode !== "manual" || Boolean(value.httpProxy || value.httpsProxy),
  "Manual mode needs a proxy URL",
);
export const AgentCleanRequestSchema = MaintenanceActionInputSchema.refine(
  (value) => value.action === "clean",
  "This endpoint only cleans local history",
);

/** Intake pressure is separate from result reporting and local configuration availability. */
export const AgentStorageStatusSchema = z.object({
  state: z.enum(["ready", "blocked"]),
  reason: z.enum(["capacity", "disk_free", "write_failed"]).nullable(),
  usedBytes: z.number().nonnegative(),
  limitBytes: z.number().positive(),
  requiredBytes: z.number().nonnegative(),
  freeDiskBytes: z.number().nonnegative().nullable(),
  pendingPackages: z.number().nonnegative(),
  unreportedResults: z.number().nonnegative(),
  retainedPackages: z.number().nonnegative(),
  tombstones: z.number().nonnegative(),
  dedupeDays: z.number().positive(),
  lastRunAt: z.number().nullable(),
});
export type AgentStorageStatus = z.infer<typeof AgentStorageStatusSchema>;

/** JSON-RPC envelope; method/tool validation is handled separately for protocol errors. */
export const AgentMcpRequestSchema = z.strictObject({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
});
export const AgentMcpInitializeSchema = z.object({ protocolVersion: z.string().min(1) });
export const AgentMcpCallSchema = z.strictObject({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

const project = AgentRequestListSchema.shape.projectId;
const tunnel = AgentTunnelIdSchema.shape.tunnelId;
const request = AgentReplayToolSchema;

/** Both advertised input schemas and runtime validation use these same local tool contracts. */
export const AgentMcpTools = {
  list_tunnels: {
    description:
      "List saved local tunnels, including disconnected sessions. Credentials are never returned.",
    schema: z.strictObject({
      status: z.enum(["all", "online", "offline"]).default("all"),
      project_id: project,
    }),
  },
  get_tunnel_status: {
    description: "Read the saved local session and its current server connection status.",
    schema: z.strictObject({ tunnel_id: tunnel, project_id: project }),
  },
  list_requests: {
    description:
      "Page through local request history, optionally scoped by local tunnel alias, project or method.",
    schema: z.strictObject({
      tunnel_id: tunnel.optional(),
      project_id: project,
      limit: z.number().int().min(1).max(100).default(50),
      method: AgentRequestListSchema.shape.method,
      cursor: AgentRequestListSchema.shape.cursor,
    }),
  },
  get_request: {
    description: "Read an original locally stored request without changing its payload.",
    schema: request,
  },
  list_deliveries: {
    description:
      "List local delivery/replay IDs for a request. Choose a delivery ID when an event has multiple endpoints.",
    schema: request.extend({
      limit: z.number().int().min(1).max(100).default(50),
      cursor: AgentRequestListSchema.shape.cursor,
    }),
  },
  replay_request: {
    description:
      "Replay one stored delivery offline with unchanged provider bytes and the current local endpoint secret; creates a new replay ID.",
    schema: request,
  },
};
