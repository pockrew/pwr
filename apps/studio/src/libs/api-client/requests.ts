import type {
  AgentDeliveryList,
  AgentRequestList,
  AgentRequestScope,
  RelayExecutionResult,
  WebhookEvent,
} from "@pockrew/pwr-shared/schemas";

import { rpc, unwrapRpc } from "./client";

export interface EventPageResult {
  items: WebhookEvent[];
  count: number;
  nextCursor: string | null;
}

/** One delivery of an event to one endpoint (a live delivery or a replay) and its outcome. */
export interface DeliveryItem {
  id: string;
  endpointId: string;
  /** Where it went, or for pending work where it will go; null when no local target is set. */
  localTarget: string | null;
  trigger: "live" | "replay";
  replayOfDeliveryId: string | null;
  completed: boolean;
  completedAt: number | null;
  /** When the server confirmed the result (the ACK was delivered); null until then. */
  reportedAt: number | null;
  result: RelayExecutionResult | null;
}

export interface DeliveryPageResult {
  items: DeliveryItem[];
  count: number;
  nextCursor: string | null;
}

export const fetchRequests = async (
  query?: Partial<AgentRequestList>,
): Promise<EventPageResult> => {
  const queryParams: Record<string, string> = {};
  if (query?.limit !== undefined) queryParams.limit = String(query.limit);
  if (query?.cursor) queryParams.cursor = query.cursor;
  if (query?.tunnelId) queryParams.tunnelId = query.tunnelId;
  if (query?.projectId) queryParams.projectId = query.projectId;
  if (query?.method) queryParams.method = query.method;

  const res = await rpc.requests.$get({
    query: queryParams,
  });
  return await unwrapRpc(res);
};

export const fetchRequestDetail = async (
  id: string,
  scope?: AgentRequestScope,
): Promise<WebhookEvent> => {
  const queryParams: Record<string, string> = {};
  if (scope?.tunnelId) queryParams.tunnelId = scope.tunnelId;
  if (scope?.projectId) queryParams.projectId = scope.projectId;

  const res = await rpc.requests[":id"].$get({
    param: { id },
    query: queryParams,
  });
  return await unwrapRpc(res);
};

export const fetchDeliveries = async (
  id: string,
  query?: Partial<AgentDeliveryList>,
): Promise<DeliveryPageResult> => {
  const queryParams: Record<string, string> = {};
  if (query?.limit !== undefined) queryParams.limit = String(query.limit);
  if (query?.cursor) queryParams.cursor = query.cursor;
  if (query?.tunnelId) queryParams.tunnelId = query.tunnelId;
  if (query?.projectId) queryParams.projectId = query.projectId;

  const res = await rpc.requests[":id"].deliveries.$get({
    param: { id },
    query: queryParams,
  });
  return await unwrapRpc(res);
};

export const replayRequest = async (
  id: string,
  scope?: AgentRequestScope,
): Promise<{ delivery: RelayExecutionResult }> => {
  const queryParams: Record<string, string> = {};
  if (scope?.tunnelId) queryParams.tunnelId = scope.tunnelId;
  if (scope?.projectId) queryParams.projectId = scope.projectId;

  const res = await rpc.replay[":id"].$post({
    param: { id },
    json: {},
    query: queryParams,
  });
  return await unwrapRpc(res);
};

/**
 * Every delivery of an event (live deliveries and replays), following the agent's pages.
 * @param tunnelId - Local tunnel alias the event belongs to.
 */
export const fetchAllDeliveries = async (id: string, tunnelId: string): Promise<DeliveryItem[]> => {
  const items: DeliveryItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetchDeliveries(id, { tunnelId, limit: 100, ...(cursor ? { cursor } : {}) });
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
};
