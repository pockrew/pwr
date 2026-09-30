import { z } from "zod";

import { HttpMethodSchema, WebhookDeliverySchema } from "./webhook.schema";

const relayId = z.string().min(1).max(128);
export const RelayHeadersSchema = z.record(z.string(), z.string());
export const RelayScopeSchema = z.object({ serverUrl: z.url(), slug: z.string().min(1) });
export type RelayScope = z.infer<typeof RelayScopeSchema>;
export const LocalEndpointCredentialSchema = z
  .object({
    headerName: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[!#$%&'*+.^_`|~0-9a-z-]+$/)
      .refine(
        (name) =>
          ![
            "host",
            "content-length",
            "content-type",
            "content-encoding",
            "transfer-encoding",
            "connection",
            "upgrade",
            "te",
            "trailer",
            "keep-alive",
            "proxy-authorization",
            "proxy-authenticate",
          ].includes(name),
        "Use an authentication header",
      )
      .default("authorization"),
    secret: z
      .string()
      .min(1)
      .max(8192)
      .regex(/^[\x20-\x7e\x80-\xff]+$/),
  })
  .strict();
export type LocalEndpointCredential = z.infer<typeof LocalEndpointCredentialSchema>;
export const RelayResultStatusSchema = z.enum(["SUCCESS", "FAILED"]);
export const RelayResultStatuses = RelayResultStatusSchema.enum;

/**
 * Current /relay/:slug contract. Unknown metadata is stripped; endpoint secrets and targets are
 * agent-owned and never imported from the server.
 */
export const RelayPackageSchema = z.object({
  id: relayId,
  eventId: relayId,
  endpointId: relayId,
  tunnelId: relayId,
  trigger: z.enum(["live", "replay"]),
  replayOfDeliveryId: relayId.nullable(),
  relayStatus: RelayResultStatusSchema.nullable(),
  method: HttpMethodSchema,
  contentType: z.string(),
  payloadBase64: z.base64(),
  headers: z.string().refine((value) => {
    try {
      return RelayHeadersSchema.safeParse(JSON.parse(value)).success;
    } catch {
      return false;
    }
  }, "Invalid original headers"),
  queryParams: z.string(),
  rawQuery: z.string().nullable(),
  eventReceivedAt: z.iso.datetime(),
});
export type RelayPackage = z.infer<typeof RelayPackageSchema>;
export const RelayMetadataSchema = RelayPackageSchema.omit({ payloadBase64: true });

/** Local audit keeps the existing result shape; server event IDs are opaque, not necessarily UUIDs. */
export const RelayExecutionResultSchema = WebhookDeliverySchema.extend({
  id: relayId,
  webhookId: relayId,
  tunnelId: relayId,
});
export type RelayExecutionResult = z.infer<typeof RelayExecutionResultSchema>;

/** Receipt recovery confirms a server-owned result; only a result response confirms a local ACK. */
export const RelayResultConfirmationSchema = z.object({
  type: z.literal("result_committed"),
  resultId: relayId,
  source: z.enum(["result", "receipt"]),
});
export type RelayResultConfirmation = z.infer<typeof RelayResultConfirmationSchema>;

export const RelayServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("subscribed"), tunnelId: relayId }),
  // Transport confirmation of a committed result, never a fourth business ACK.
  RelayResultConfirmationSchema,
  z.object({ type: z.literal("sync"), deliveries: z.array(RelayPackageSchema) }),
  z.object({ type: z.literal("webhook_event"), events: z.array(RelayPackageSchema) }),
]);

const resultFields = {
  deliveryId: relayId,
  status: RelayResultStatusSchema,
  responseStatus: z.number().int().min(100).max(599).optional(),
  latencyMs: z.number().nonnegative().max(3_600_000).optional(),
  responseBytes: z.number().int().nonnegative().optional(),
};

/** ACKs carry outcome metadata only: no target URL, credentials, response headers or body. */
export const RelayClientAckSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("ack_received"), deliveryId: relayId }),
  z.strictObject({ type: z.literal("ack_relayed"), ...resultFields }),
  z.strictObject({
    type: z.literal("ack_replayed"),
    ...resultFields,
    replayId: z.uuid().toLowerCase(),
  }),
]);
export type RelayClientAck = z.infer<typeof RelayClientAckSchema>;

/** Local daemon requests share validation with future CLI/Studio clients. */
export const AgentTunnelIdSchema = z.object({ tunnelId: relayId });
export const AgentRequestIdSchema = z.object({ id: relayId });
export const AgentRelayConnectSchema = AgentTunnelIdSchema.extend({
  slug: relayId.optional(),
  serverWsUrl: z.url({ protocol: /^(https?|wss?)$/ }).refine((value) => {
    // Syntax/protocol is checked above; this pure contract needs no runtime URL dependency.
    return !/[?#]/.test(value) && !/^[a-z]+:\/\/[^/]*@/i.test(value.trim());
  }, "Server URL must not contain credentials, query or fragment"),
  apiKey: z
    .string()
    .trim()
    .min(1)
    .max(8192)
    .regex(/^[\x21-\x7e]+$/)
    .optional(),
  projectId: z.string().min(1).max(64).optional(),
  // Replace another agent that currently owns this tunnel (e.g. moving to a new machine).
  takeover: z.boolean().optional(),
}).strict();
export type AgentRelayConnect = z.infer<typeof AgentRelayConnectSchema>;

/**
 * Credential check before connecting: nothing is stored and no relay socket is opened. Without
 * `apiKey`, the key already saved for this server/slug is checked.
 */
export const AgentRelayTestSchema = AgentRelayConnectSchema.pick({
  serverWsUrl: true,
  apiKey: true,
})
  .extend({ slug: relayId })
  .strict();
export type AgentRelayTest = z.infer<typeof AgentRelayTestSchema>;

/** Why a credential check failed; `ok` means the server accepted this key for this slug. */
export const AgentRelayTestResultSchema = z.object({
  result: z.enum([
    "ok",
    "unauthorized",
    "not_found",
    "ip_forbidden",
    "unreachable",
    "server_error",
  ]),
  status: z.number().int().optional(),
});
export type AgentRelayTestResult = z.infer<typeof AgentRelayTestResultSchema>;

/** WebSocket close code: the tunnel already has an active agent and takeover was not requested. */
export const RELAY_CLOSE_TUNNEL_IN_USE = 4409;
/** Upgrade header carrying the agent's stable instance ID; same ID may replace its own socket. */
export const RELAY_AGENT_ID_HEADER = "x-pwr-agent-id";
/** Upgrade header requesting replacement of a different agent's connection. */
export const RELAY_TAKEOVER_HEADER = "x-pwr-takeover";
export const AgentRelayDrainSchema = z.object({
  rateLimitPerSec: z
    .number()
    .min(1 / 60)
    .optional(),
  delayMs: z.number().int().min(0).max(60_000).optional(),
  maxBatchSize: z.number().int().positive().optional(),
});
export type AgentRelayDrain = z.infer<typeof AgentRelayDrainSchema>;
// Explicitly reject payload/header/target overrides instead of silently ignoring them.
export const AgentReplayRequestSchema = z.strictObject({});
export const AgentRequestScopeSchema = z.strictObject({
  projectId: z.string().min(1).max(64).optional(),
  tunnelId: relayId.optional(),
});
export type AgentRequestScope = z.infer<typeof AgentRequestScopeSchema>;
// An omitted query is valid for existing clients; supplied filters still use the strict schema.
export const AgentRequestScopeQuerySchema = AgentRequestScopeSchema.default({});
export const AgentDeliveryListSchema = AgentRequestScopeSchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: relayId.optional(),
});
export type AgentDeliveryList = z.infer<typeof AgentDeliveryListSchema>;
export const AgentRequestListSchema = AgentDeliveryListSchema.extend({
  method: HttpMethodSchema.optional(),
});
export type AgentRequestList = z.infer<typeof AgentRequestListSchema>;

/** Public local tunnel snapshot; credentials belong only to the agent's internal runtime state. */
export const AgentTunnelSessionSchema = z.object({
  tunnelId: relayId,
  slug: relayId.optional(),
  serverWsUrl: z.string(),
  isPaused: z.boolean().optional(),
  projectId: z.string(),
  status: z.enum(["connected", "disconnected", "reconnecting"]),
  lastError: z
    .enum(["relay_handshake_failed", "connection_lost", "local_socket_failed", "tunnel_in_use"])
    .optional(),
  connectedAt: z.number().optional(),
});
export type AgentTunnelSession = z.infer<typeof AgentTunnelSessionSchema>;

/** Safe local stream notification after a target result is committed; no payload or credentials. */
export const AgentDeliveryStreamSchema = z.strictObject({
  type: z.literal("delivery_result"),
  eventId: relayId,
  deliveryId: relayId,
  trigger: z.enum(["live", "replay"]),
  statusCode: z.number().int(),
  latencyMs: z.number().nonnegative(),
});
export type AgentDeliveryStream = z.infer<typeof AgentDeliveryStreamSchema>;

/** Agent replay tools use the same immutable source contract; overrides are no longer supported. */
export const AgentReplayToolSchema = z.strictObject({
  request_id: relayId.describe("Stored delivery ID, or event ID with exactly one target"),
  tunnel_id: relayId.optional(),
  project_id: z.string().min(1).max(64).optional(),
});
