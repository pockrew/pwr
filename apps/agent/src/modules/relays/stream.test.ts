import { describe, expect, it } from "bun:test";

import type { AgentDeliveryStream, WebhookEvent } from "@pockrew/pwr-shared/schemas";

import { app } from "~/app";

import { agentStreamBroker, relayStreamKey } from "./broker";
import { saveRelaySession } from "./repository";

describe("Agent Local Direct SSE Stream", () => {
  it("subscribes and receives broadcast events via agentStreamBroker", () => {
    const tunnelId = `agent-stream-test-${crypto.randomUUID().slice(0, 8)}`;
    const received: WebhookEvent[] = [];

    const unsubscribe = agentStreamBroker.subscribe(tunnelId, (event) => {
      received.push(event);
    });

    expect(agentStreamBroker.getSubscriberCount(tunnelId)).toBe(1);

    const testEvent: WebhookEvent = {
      id: "evt-local-1",
      tunnelId,
      orgId: "default",
      projectId: "default",
      method: "POST",
      headers: {},
      status: 200,
      executionTimeMs: 5,
      createdAt: Date.now(),
    };

    agentStreamBroker.broadcast(testEvent);
    expect(received.length).toBe(1);
    expect(received[0]?.id).toBe("evt-local-1");

    unsubscribe();
    expect(agentStreamBroker.getSubscriberCount(tunnelId)).toBe(0);

    agentStreamBroker.broadcast({ ...testEvent, id: "evt-local-2" });
    expect(received.length).toBe(1); // not received after unsubscribe
  });

  it("handles GET /events/stream/:tunnelId with valid SSE content-type", async () => {
    const tunnelId = `test-sse-route-${crypto.randomUUID().slice(0, 8)}`;

    saveRelaySession({ tunnelId, serverUrl: "http://127.0.0.1:1", slug: tunnelId, enabled: false });
    const res = await app.request(`/events/stream/${tunnelId}`, {
      method: "GET",
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    await res.body?.cancel();
  });

  it("publishes committed delivery results to the matching server and slug only", () => {
    const scope = { serverUrl: "http://127.0.0.1:18787", slug: "payments" };
    const received: AgentDeliveryStream[] = [];
    const stop = agentStreamBroker.subscribeDelivery(relayStreamKey(scope), (event) => {
      received.push(event);
    });
    const result: AgentDeliveryStream = {
      type: "delivery_result",
      eventId: "event-1",
      deliveryId: "delivery-1",
      trigger: "live",
      statusCode: 202,
      latencyMs: 12,
    };
    agentStreamBroker.broadcastDelivery(result, { ...scope, slug: "other" });
    expect(received).toHaveLength(0);
    agentStreamBroker.broadcastDelivery(result, scope);
    expect(received).toEqual([result]);
    stop();
    agentStreamBroker.broadcastDelivery(result, scope);
    expect(received).toHaveLength(1);
  });
});
