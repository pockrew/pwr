import { configScope } from "@agent/modules/config/repository";
import { listRelayDeliveries } from "@agent/modules/relays/repository";
import { tunnelManager } from "@agent/modules/relays/service";
import { HTTPException } from "hono/http-exception";

import type {
  AgentDeliveryList,
  AgentRequestList,
  AgentRequestScope,
} from "@pockrew/pwr-shared/schemas";

import { agentDbService } from "./repository";

/** Resolve the local alias for every HTTP/MCP inspection or replay entry point. */
const scopeOf = (filter: AgentRequestScope) =>
  filter.tunnelId ? configScope(filter.tunnelId) : undefined;

/** Page local history, applying the same ownership and method filters for HTTP and MCP. */
export const listRequests = (filter: AgentRequestList) =>
  agentDbService.listEventPage(filter, scopeOf(filter));

/** Read a scoped original; missing IDs and wrong scopes both return 404 without revealing data. */
export const getRequest = (id: string, filter: AgentRequestScope) => {
  const event = agentDbService.getEventById(id, scopeOf(filter), filter.projectId);
  if (!event) throw new HTTPException(404);
  return event;
};

/** Page delivery metadata for a scoped original so clients can select one target for replay. */
export const listDeliveries = (id: string, filter: AgentDeliveryList) => {
  getRequest(id, filter);
  const rows = listRelayDeliveries(
    id,
    scopeOf(filter),
    filter.projectId,
    filter.limit,
    filter.cursor,
  );
  const items = rows.slice(0, filter.limit);
  return {
    items,
    count: items.length,
    nextCursor: rows.length > filter.limit ? (items.at(-1)?.id ?? null) : null,
  };
};

/** Replay one scoped source through the existing engine; offline operation never requires server I/O. */
export const replayRequest = (id: string, filter: AgentRequestScope) =>
  tunnelManager.replayLocal(id, scopeOf(filter), filter.projectId);
