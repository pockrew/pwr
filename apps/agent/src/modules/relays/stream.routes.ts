import { configScope } from "@agent/modules/config/repository";
import { requireValidation } from "@agent/platform/validator.middleware";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";

import { AgentStreamQuerySchema, AgentTunnelIdSchema } from "@pockrew/pwr-shared/schemas";

import { agentStreamBroker, relayStreamKey } from "./broker";

/** Resolve a saved alias before subscribing; server IDs remain unchanged in the event payload. */
const streamEvents = (c: Context, tunnelId: string) => {
  const channel = relayStreamKey(configScope(tunnelId));
  return streamSSE(c, async (stream) => {
    // 1. Register before the first asynchronous write so arrivals during connection are not lost.
    const unsubscribe = agentStreamBroker.subscribe(channel, (event) => {
      void stream
        .writeSSE({ event: "webhook", data: JSON.stringify(event) })
        .catch(() => stream.abort());
    });
    const unsubscribeDelivery = agentStreamBroker.subscribeDelivery(channel, (event) => {
      void stream
        .writeSSE({ event: "delivery", data: JSON.stringify(event) })
        .catch(() => stream.abort());
    });
    stream.onAbort(() => {
      unsubscribe();
      unsubscribeDelivery();
    });
    try {
      await stream.writeSSE({
        event: "connected",
        data: JSON.stringify({
          type: "connected",
          tunnelId,
          source: "agent",
          timestamp: Date.now(),
        }),
      });
      // 2. Keep one heartbeat loop; both supported URL forms use this same implementation.
      while (!stream.aborted) {
        await stream.sleep(15_000);
        if (!stream.aborted)
          await stream.writeSSE({
            event: "ping",
            data: JSON.stringify({ type: "ping", timestamp: Date.now() }),
          });
      }
    } finally {
      unsubscribe();
      unsubscribeDelivery();
    }
  });
};

export const streamRoutes = new Hono()
  .get("/events/stream/:tunnelId", requireValidation("param", AgentTunnelIdSchema), (c) =>
    streamEvents(c, c.req.valid("param").tunnelId),
  )
  .get("/events/stream", requireValidation("query", AgentStreamQuerySchema), (c) =>
    streamEvents(c, c.req.valid("query").tunnelId),
  );
