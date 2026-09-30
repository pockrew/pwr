import {
  LogBatchSchema,
  type LogFilter,
  type LogPage,
  type LogPageQuery,
  type LogSettings,
} from "@pockrew/pwr-shared/schemas";
import type { LogStreamHandlers } from "@pockrew/pwr-ui/logs";

import { rpc } from "./api-client";
import { readData } from "./read-data";

/** Query-string form of a log filter; empty values are omitted. */
const filterParams = (filter: LogFilter): Record<string, string> => ({
  ...(filter.level ? { level: filter.level } : {}),
  ...(filter.q ? { q: filter.q } : {}),
});

/** One newest-first page of server.log (continuing into rotated files); admin session only. */
export const fetchServerLogs = async (query: LogPageQuery): Promise<LogPage> =>
  readData(
    await rpc.logs.$get({
      query: {
        ...filterParams(query),
        limit: String(query.limit),
        ...(query.before ? { before: query.before } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
      },
    }),
    "Failed to load server logs",
  );

/**
 * Open the live server.log tail over SSE after cursor `after`.
 * @returns Function that closes the connection.
 */
export const openServerLogStream = (
  after: string,
  filter: LogFilter,
  handlers: LogStreamHandlers,
): (() => void) => {
  const params = new URLSearchParams({ ...filterParams(filter), after });
  const source = new EventSource(`/api/logs/stream?${params}`, { withCredentials: true });
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

/** Minimum level and rotation of server.log. */
export const fetchServerLogSettings = async (): Promise<LogSettings> =>
  readData(await rpc.logs.settings.$get(), "Failed to load log settings");

/** Save and apply new server log settings; resolves after the server stored them. */
export const saveServerLogSettings = async (settings: LogSettings): Promise<LogSettings> =>
  readData(await rpc.logs.settings.$put({ json: settings }), "Failed to save log settings");
