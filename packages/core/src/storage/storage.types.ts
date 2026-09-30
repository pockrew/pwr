export interface IStoredWebhookEvent {
  id: string;
  tunnelId: string;
  orgId: string;
  projectId: string;
  method: string;
  url?: string | null | undefined;
  headers: string;
  queryParams?: string | null | undefined;
  body?: string | null | undefined;
  payload?: Uint8Array | null | undefined;
  payloadText?: string | null | undefined;
  isBinary?: number | boolean | null | undefined;
  sizeBytes?: number | undefined;
  attempts?: number | undefined;
  replayCount?: number | undefined;
  /** Legacy columns; the event outcome is derived from its deliveries. */
  status: number | null;
  executionTimeMs: number | null;
  createdAt: number;
  updatedAt?: number | null | undefined;
}

export interface IStoredWebhookDelivery {
  id: string;
  webhookId: string;
  tunnelId: string;
  destinationId?: string | null | undefined;
  orgId: string;
  projectId: string;
  targetUrl: string;
  statusCode: number;
  latencyMs: number;
  requestHeaders?: string | null | undefined;
  requestBody?: string | null | undefined;
  responseHeaders?: string | null | undefined;
  responseBody?: string | null | undefined;
  deliveredAt: number;
  updatedAt?: number | null | undefined;
}

export interface IListWebhooksFilter {
  tunnelId?: string | undefined;
  orgId?: string | undefined;
  projectId?: string | undefined;
  limit?: number | undefined;
}

export interface IRetentionPruneFilter {
  orgId: string;
  cutoffMs?: number | undefined;
  projects?: string[] | undefined;
}
