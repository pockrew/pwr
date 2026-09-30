import {
  LogBatchSchema,
  type LogFilter,
  type LogPage,
  type LogPageQuery,
  type LogSettings,
} from "@pockrew/pwr-shared/schemas";
import type { LogStreamHandlers } from "@pockrew/pwr-ui/logs";

import { rpc, unwrapRpc } from "./client";

/** Query-string form of a log filter; empty values are omitted. */
const filterParams = (filter: LogFilter): Record<string, string> => ({
  ...(filter.level ? { level: filter.level } : {}),
  ...(filter.q ? { q: filter.q } : {}),
});

/**
 * Fetch one newest-first page of agent.log (continuing into rotated files).
 * @throws When the agent is unreachable or rejects the query.
 */
export const fetchAgentLogs = async (query: LogPageQuery): Promise<LogPage> =>
  unwrapRpc(
    await rpc.logs.$get({
      query: {
        ...filterParams(query),
        limit: String(query.limit),
        ...(query.before ? { before: query.before } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
      },
    }),
  );

/**
 * Open the live agent.log tail over SSE after cursor `after`.
 * @returns Function that closes the connection.
 */
export const openAgentLogStream = (
  after: string,
  filter: LogFilter,
  handlers: LogStreamHandlers,
): (() => void) => {
  const params = new URLSearchParams({ ...filterParams(filter), after });
  const source = new EventSource(`/api/logs/stream?${params}`);
  source.addEventListener("open", handlers.onOpen);
  source.addEventListener("logs", (event) => {
    if (!(event instanceof MessageEvent)) return;
    const batch = LogBatchSchema.safeParse(JSON.parse(String(event.data)));
    if (batch.success) handlers.onBatch(batch.data);
  });
  source.addEventListener("reset", () => {
    source.close();
    handlers.onReset();
  });
  source.addEventListener("error", handlers.onError);
  return () => source.close();
};

/** Minimum level and rotation of agent.log (`[logs]` in config.toml). */
export const fetchAgentLogSettings = async (): Promise<LogSettings> =>
  unwrapRpc(await rpc.logs.settings.$get());

/** Save and apply new agent log settings; resolves after the agent committed them. */
export const saveAgentLogSettings = async (settings: LogSettings): Promise<LogSettings> =>
  unwrapRpc(await rpc.logs.settings.$put({ json: settings }));
