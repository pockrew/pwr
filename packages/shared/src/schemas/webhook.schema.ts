import { z } from "zod";

export const HttpMethodSchema = z.enum([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
]);
export type HttpMethod = z.infer<typeof HttpMethodSchema>;
export const HttpMethods = HttpMethodSchema.enum;

/** Delivery outcome of one event across its endpoints, live deliveries and replays together. */
export const EventDeliverySummarySchema = z.strictObject({
  total: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export type EventDeliverySummary = z.infer<typeof EventDeliverySummarySchema>;

/**
 * A captured provider request. `status` and `executionTimeMs` are the newest target result
 * (absent until a delivery completes); `deliveries` summarizes every delivery of the event.
 */
export const WebhookEventSchema = z.strictObject({
  id: z.string().uuid(),
  tunnelId: z.string().min(1).max(64),
  orgId: z.string().min(1).max(64).default("default"),
  projectId: z.string().min(1).max(64).default("default"),
  method: HttpMethodSchema,
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()),
  queryParams: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  rawPayloadBase64: z.string().optional(),
  payloadText: z.string().optional(),
  isBinary: z.boolean().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  attempts: z.number().int().nonnegative().optional(),
  replayCount: z.number().int().nonnegative().optional(),
  status: z.number().int().min(100).max(599).optional(),
  executionTimeMs: z.number().nonnegative().optional(),
  deliveries: EventDeliverySummarySchema.optional(),
  createdAt: z.number().int().positive(),
});

export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

export const WebhookDeliverySchema = z.strictObject({
  webhookId: z.string().uuid(),
  tunnelId: z.string().min(1).max(64),
  destinationId: z.string().optional(),
  orgId: z.string().min(1).max(64).default("default"),
  projectId: z.string().min(1).max(64).default("default"),
  targetUrl: z.url(),
  statusCode: z.number().int(),
  latencyMs: z.number().nonnegative(),
  requestHeaders: z.record(z.string(), z.string()).optional(),
  requestBody: z.string().optional(),
  responseHeaders: z.record(z.string(), z.string()).optional(),
  responseBody: z.string().optional(),
  deliveredAt: z.number().int().positive(),
});

export type WebhookDelivery = z.infer<typeof WebhookDeliverySchema>;
