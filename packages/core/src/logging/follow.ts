import type { LogFilter } from "@pockrew/pwr-shared/schemas";

import { matchesLogFilter } from "./entry";
import { readLogTail } from "./reader";

const TAIL_INTERVAL_MS = 500;
// Below Bun's default 10s idle timeout, which would otherwise close a quiet stream.
const HEARTBEAT_MS = 5_000;

/** Transport of a live log client (an SSE stream in the agent and the server). */
export interface ILogChannel {
  send: (event: "logs" | "reset" | "ping", data: string) => Promise<void>;
  sleep: (ms: number) => Promise<unknown>;
  isClosed: () => boolean;
}

/**
 * Push entries appended after cursor `after` to a live client until it disconnects.
 * 1. A file that shrank in place sends `reset`: cursors no longer line up, so the client reloads.
 * 2. Every advance is sent, even when filtered empty, so a reconnect resumes exactly there.
 * 3. An idle connection gets a heartbeat so both sides notice a dead peer.
 */
export const followLog = async (
  path: string,
  after: string,
  filter: LogFilter,
  channel: ILogChannel,
): Promise<void> => {
  let cursor = after;
  let lastSend = Date.now();
  while (!channel.isClosed()) {
    const tail = await readLogTail(path, cursor);
    if (tail.reset) {
      await channel.send("reset", "{}");
      return;
    }
    if (tail.next !== cursor) {
      cursor = tail.next;
      const entries = tail.entries.filter((entry) => matchesLogFilter(entry, filter));
      await channel.send("logs", JSON.stringify({ entries, after: cursor }));
      lastSend = Date.now();
      continue;
    }
    if (Date.now() - lastSend >= HEARTBEAT_MS) {
      await channel.send("ping", "{}");
      lastSend = Date.now();
    }
    await channel.sleep(TAIL_INTERVAL_MS);
  }
};
