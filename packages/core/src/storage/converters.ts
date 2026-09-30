import { isRecord } from "@pockrew/pwr-shared/libs";
import {
  HttpMethodSchema,
  type HttpMethod,
  type WebhookDelivery,
  type WebhookEvent,
} from "@pockrew/pwr-shared/schemas";

import type { IStoredWebhookDelivery, IStoredWebhookEvent } from "./storage.types";

/**
 * Normalizes an unknown record into a Record<string, string>, discarding non-string properties.
 *
 * @param val - Record to inspect.
 * @returns Cleaned dictionary containing only string key-value pairs.
 */
const toStringRecord = (val: unknown): Record<string, string> => {
  // 1. Guard against non-record values
  if (!isRecord(val)) return {};
  const record: Record<string, string> = {};

  // 2. Filter key-value pairs where value is a string
  for (const [k, v] of Object.entries(val)) {
    if (typeof v === "string") record[k] = v;
  }

  // 3. Return sanitized string record
  return record;
};

/**
 * Serializes an in-memory WebhookEvent entity into a flat storage row format for SQLite persistence.
 *
 * @param event - The WebhookEvent to serialize.
 * @returns Flat storage representation with serialized JSON headers.
 */
export const toStoredWebhook = (event: WebhookEvent): IStoredWebhookEvent => {
  // 1. Convert base64 or text body into raw byte buffer
  let rawBytes: Uint8Array | null = null;
  if (event.rawPayloadBase64) {
    rawBytes = Buffer.from(event.rawPayloadBase64, "base64");
  } else if (event.body) {
    rawBytes = Buffer.from(event.body, "utf-8");
  }

  const sizeBytes =
    typeof event.sizeBytes === "number" && event.sizeBytes > 0
      ? event.sizeBytes
      : rawBytes
        ? rawBytes.byteLength
        : event.body
          ? Buffer.byteLength(event.body, "utf-8")
          : 0;

  // 2. Map fields into flat IStoredWebhookEvent structure
  return {
    id: event.id,
    tunnelId: event.tunnelId,
    orgId: event.orgId ?? "default",
    projectId: event.projectId ?? "default",
    method: event.method,
    url: event.url ?? null,
    headers: JSON.stringify(event.headers),
    queryParams: event.queryParams ? JSON.stringify(event.queryParams) : null,
    body: event.body ?? null,
    payload: rawBytes,
    payloadText: event.payloadText ?? (event.isBinary ? null : (event.body ?? null)),
    isBinary: event.isBinary ? 1 : 0,
    sizeBytes,
    attempts: event.attempts ?? 0,
    replayCount: event.replayCount ?? 0,
    status: event.status ?? null,
    executionTimeMs: event.executionTimeMs ?? null,
    createdAt: event.createdAt,
    updatedAt: Date.now(),
  };
};

/**
 * Deserializes a stored SQLite row record into a normalized in-memory WebhookEvent entity.
 *
 * @param row - Stored database record.
 * @returns Reconstituted WebhookEvent.
 */
export const fromStoredWebhook = (row: IStoredWebhookEvent): WebhookEvent => {
  // 1. Parse and validate stored HTTP method
  const parsedMethod = HttpMethodSchema.safeParse(row.method);
  const method: HttpMethod = parsedMethod.success ? parsedMethod.data : "POST";

  // 2. Safely parse serialized HTTP headers JSON
  let headers: Record<string, string> = {};
  if (row.headers) {
    try {
      headers = toStringRecord(JSON.parse(row.headers));
    } catch {
      headers = {};
    }
  }

  // 3. Safely parse serialized query parameters JSON
  let queryParams: Record<string, string> | undefined;
  if (row.queryParams) {
    try {
      queryParams = toStringRecord(JSON.parse(row.queryParams));
    } catch {
      queryParams = undefined;
    }
  }

  const isBinary = Boolean(row.isBinary);
  let rawPayloadBase64: string | undefined;
  if (row.payload) {
    rawPayloadBase64 = Buffer.from(row.payload).toString("base64");
  }

  const sizeBytes =
    typeof row.sizeBytes === "number" && row.sizeBytes > 0
      ? row.sizeBytes
      : row.payload
        ? row.payload.byteLength
        : row.body
          ? Buffer.byteLength(row.body, "utf-8")
          : 0;

  // 4. Construct reconstituted WebhookEvent entity
  return {
    id: row.id,
    tunnelId: row.tunnelId,
    orgId: row.orgId,
    projectId: row.projectId,
    method,
    url: row.url ?? undefined,
    headers,
    queryParams,
    body: row.body ?? undefined,
    rawPayloadBase64,
    payloadText: row.payloadText ?? (isBinary ? undefined : (row.body ?? undefined)),
    isBinary,
    sizeBytes,
    attempts: typeof row.attempts === "number" ? row.attempts : 0,
    replayCount: typeof row.replayCount === "number" ? row.replayCount : 0,
    createdAt: row.createdAt,
  };
};

/**
 * Serializes a WebhookDelivery audit record into a flat SQLite storage record.
 *
 * @param delivery - WebhookDelivery entity to serialize.
 * @returns Serialized database delivery record.
 */
export const toStoredDelivery = (delivery: WebhookDelivery): IStoredWebhookDelivery => ({
  id: crypto.randomUUID(),
  webhookId: delivery.webhookId,
  tunnelId: delivery.tunnelId,
  destinationId: delivery.destinationId ?? null,
  orgId: delivery.orgId ?? "default",
  projectId: delivery.projectId ?? "default",
  targetUrl: delivery.targetUrl,
  statusCode: delivery.statusCode,
  latencyMs: delivery.latencyMs,
  requestHeaders: delivery.requestHeaders ? JSON.stringify(delivery.requestHeaders) : null,
  requestBody: delivery.requestBody ?? null,
  responseHeaders: delivery.responseHeaders ? JSON.stringify(delivery.responseHeaders) : null,
  responseBody: delivery.responseBody ?? null,
  deliveredAt: delivery.deliveredAt,
  updatedAt: Date.now(),
});

/**
 * Deserializes a stored delivery record into a normalized WebhookDelivery entity.
 *
 * @param row - Stored delivery row.
 * @returns Reconstituted WebhookDelivery.
 */
export const fromStoredDelivery = (row: IStoredWebhookDelivery): WebhookDelivery => {
  // 1. Safely parse serialized response headers JSON
  let responseHeaders: Record<string, string> | undefined;
  if (row.responseHeaders) {
    try {
      responseHeaders = toStringRecord(JSON.parse(row.responseHeaders));
    } catch {
      responseHeaders = undefined;
    }
  }

  // 2. Safely parse serialized request headers JSON
  let requestHeaders: Record<string, string> | undefined;
  if (row.requestHeaders) {
    try {
      requestHeaders = toStringRecord(JSON.parse(row.requestHeaders));
    } catch {
      requestHeaders = undefined;
    }
  }

  // 3. Construct reconstituted WebhookDelivery entity
  return {
    webhookId: row.webhookId,
    tunnelId: row.tunnelId,
    destinationId: row.destinationId ?? undefined,
    orgId: row.orgId,
    projectId: row.projectId,
    targetUrl: row.targetUrl,
    statusCode: row.statusCode,
    latencyMs: row.latencyMs,
    requestHeaders,
    requestBody: row.requestBody ?? undefined,
    responseHeaders,
    responseBody: row.responseBody ?? undefined,
    deliveredAt: row.deliveredAt,
  };
};
