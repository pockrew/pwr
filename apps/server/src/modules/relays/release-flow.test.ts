import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { createHash } from "node:crypto";
import type { IWsConnection } from "@server/modules/relays/service";
import { sql } from "drizzle-orm";
import { z } from "zod";

// Each run uses only an in-memory DB, including production migrations.
process.env["DB_FILE_NAME"] = ":memory:";
process.env["BETTER_AUTH_SECRET"] = "release-regression-secret-at-least-32-characters";
process.env["ADMIN_EMAIL"] = "release-test@example.com";
process.env["ADMIN_PASSWORD"] = "release-test-password";
process.env["MAX_REPLAY_BACKLOG_BATCH"] = "50";
process.env["MAX_REPLAY_BATCH_BYTES"] = "1048576";
process.env["RELAY_ACK_TIMEOUT_MS"] = "30000";
const { db } = await import("@server/db/client");
const { tunnels, collections, endpoints, webhookEvents, webhookDeliveries, apiKeys } =
  await import("@server/db/schemas");
const { env } = await import("@server/platform/env");
const { relayService } = await import("@server/modules/relays/service");
const { deliveryBacklogStatus, prepareDelivery } =
  await import("@server/modules/relays/delivery.service");
const { ingressEvents } = await import("@server/modules/ingress/events");
const packetSchema = z.object({ id: z.string(), eventId: z.string(), payloadBase64: z.string() });
const frameSchema = z.object({
  type: z.string(),
  deliveries: z.array(packetSchema).optional(),
  events: z.array(packetSchema).optional(),
});
const packets = (text: string) => {
  const frame = frameSchema.parse(JSON.parse(text));
  return frame.deliveries ?? frame.events ?? [];
};
let sequence = 0;
const store = (body: Buffer, count = 1, prepare = true) => {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    sequence++;
    const record = db
      .insert(webhookEvents)
      .values({
        tunnelId: "t",
        collectionId: "c",
        method: "POST",
        contentType: "application/octet-stream",
        payload: body,
        sizeBytes: body.length,
        headers: JSON.stringify({ "x-unicode": "🔔".repeat(100) }),
        queryParams: "{}",
        sourceIp: "127.0.0.1",
        receivedAt: new Date(sequence * 1000),
      })
      .returning()
      .get();
    if (!record) throw new Error("Event insert failed");
    ids.push(record.id);
    if (prepare) prepareDelivery(record.id);
  }
  return ids;
};
const socket = (sendResult = 1) => {
  const frames: string[] = [];
  const closed: number[] = [];
  const ws: IWsConnection = {
    data: {},
    readyState: 1,
    getBufferedAmount: () => 0,
    send: (data) => {
      frames.push(String(data));
      return sendResult;
    },
    close: (code) => {
      closed.push(code ?? 1000);
    },
  };
  const receive = (deliveryId: string) =>
    relayService.acknowledge("t", ws, JSON.stringify({ type: "ack_received", deliveryId }));
  return { ws, frames, closed, receive };
};
const deliveries = () => db.select().from(webhookDeliveries).all();

beforeEach(() => {
  relayService.closeAll("reset");
  sequence = 0;
  env.RELAY_ACK_TIMEOUT_MS = 30_000;
  for (const table of [webhookDeliveries, webhookEvents, apiKeys, endpoints, collections, tunnels])
    db.delete(table).run();
  db.insert(tunnels).values({ id: "t", slug: "release", name: "Release" }).run();
  db.insert(collections).values({ id: "c", tunnelId: "t" }).run();
  db.insert(endpoints)
    .values({
      id: "target",
      collectionId: "c",
      pathName: "/test",
    })
    .run();
});
afterEach(() => {
  db.run(sql`DROP TRIGGER IF EXISTS reject_result_commit`);
  relayService.closeAll("test complete");
  jest.useRealTimers();
  env.RELAY_ACK_TIMEOUT_MS = 30_000;
});

test("backlog status distinguishes unprepared, unmatched and paused deliveries", async () => {
  const unprepared = store(Buffer.from("waiting for recovery"), 1, false);
  expect(deliveryBacklogStatus("t")).toMatchObject({ unpreparedEvents: 1 });
  if (!unprepared[0]) throw new Error("Missing stored event");
  prepareDelivery(unprepared[0]);
  store(Buffer.from("pending"));
  db.update(endpoints).set({ isPaused: true }).run();
  const unmatched = db
    .insert(webhookEvents)
    .values({
      tunnelId: "t",
      collectionId: "missing-collection",
      method: "POST",
      contentType: "application/octet-stream",
      payload: Buffer.from("unmatched"),
      headers: "{}",
      queryParams: "{}",
      sourceIp: "127.0.0.1",
    })
    .returning({ id: webhookEvents.id })
    .get();
  if (!unmatched) throw new Error("Missing unmatched event");
  prepareDelivery(unmatched.id);
  expect(deliveryBacklogStatus("t")).toEqual({
    unpreparedEvents: 0,
    unmatchedEvents: 1,
    pendingDeliveries: 2,
    blockedDeliveries: 2,
  });
  const token = "status-relay-key";
  db.insert(apiKeys)
    .values({
      tunnelId: "t",
      types: "outbound",
      name: "Status agent",
      keyPrefix: "status",
      keyHash: createHash("sha256").update(token).digest("hex"),
    })
    .run();
  const { app } = await import("@server/app");
  const response = await app.request("/api/tunnels/t/delivery-status", {
    headers: { "x-api-key": token },
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ data: deliveryBacklogStatus("t") });
});

test("result confirmations follow commit, recover lost receipts and ignore conflicting retries", () => {
  store(Buffer.from("committed result"));
  const id = deliveries()[0]?.id;
  if (!id) throw new Error("Missing delivery");
  const ack = {
    type: "ack_relayed",
    deliveryId: id,
    status: "SUCCESS",
    responseStatus: 200,
    latencyMs: 12.5,
    responseBytes: 2,
  };
  const agent = socket();
  const send = agent.ws.send;
  agent.ws.send = (data) => {
    if (String(data).includes('"result_committed"'))
      expect(deliveries().find((row) => row.id === id)?.relayStatus).toBe("SUCCESS");
    return send(data);
  };
  relayService.register("t", agent.ws, { resultReceipts: true });
  agent.receive(id);
  expect(agent.frames.some((frame) => frame.includes("result_committed"))).toBe(false);
  db.run(sql`CREATE TRIGGER reject_result_commit BEFORE UPDATE OF relay_status ON webhook_deliveries
    BEGIN SELECT RAISE(ABORT, 'simulated commit failure'); END`);
  relayService.acknowledge("t", agent.ws, JSON.stringify(ack));
  expect(deliveries()[0]?.relayStatus).toBeNull();
  expect(agent.frames.some((frame) => frame.includes("result_committed"))).toBe(false);
  db.run(sql`DROP TRIGGER reject_result_commit`);
  relayService.register("t", agent.ws, { resultReceipts: true });
  relayService.acknowledge("t", agent.ws, JSON.stringify(ack));
  const committedAt = deliveries()[0]?.relayedAt;
  // Lost transport confirmation: identical report on reconnect gets the same committed ID.
  relayService.register("t", agent.ws, { resultReceipts: true, acceptDeliveries: false });
  relayService.acknowledge("t", agent.ws, JSON.stringify(ack));
  expect(agent.frames.filter((frame) => frame.includes("result_committed"))).toHaveLength(2);
  expect(deliveries()[0]?.relayedAt).toEqual(committedAt);
  // A divergent retry is confirmed (so the agent stops re-sending and the queue keeps moving)
  // but never overwrites the first committed result.
  relayService.acknowledge("t", agent.ws, JSON.stringify({ ...ack, status: "FAILED" }));
  expect(agent.frames.filter((frame) => frame.includes("result_committed"))).toHaveLength(3);
  expect(agent.ws.readyState).toBe(1);
  expect(deliveries()[0]?.relayStatus).toBe("SUCCESS");
  expect(deliveries()[0]?.latencyMs).toBe(13);
});

test("replay confirmations validate parent identity and old agents never receive new frames", () => {
  store(Buffer.from("parents"), 2);
  const [first, second] = deliveries();
  if (!first || !second) throw new Error("Missing parents");
  const legacy = socket();
  relayService.register("t", legacy.ws);
  legacy.receive(first.id);
  legacy.receive(second.id);
  relayService.acknowledge(
    "t",
    legacy.ws,
    JSON.stringify({ type: "ack_relayed", deliveryId: first.id, status: "SUCCESS" }),
  );
  expect(legacy.frames.some((frame) => frame.includes("result_committed"))).toBe(false);
  const agent = socket();
  relayService.register("t", agent.ws, { resultReceipts: true, acceptDeliveries: false });
  const replay = {
    type: "ack_replayed",
    deliveryId: first.id,
    replayId: crypto.randomUUID(),
    status: "FAILED",
  };
  relayService.acknowledge("t", agent.ws, JSON.stringify(replay));
  relayService.acknowledge("t", agent.ws, JSON.stringify(replay));
  expect(agent.frames.filter((frame) => frame.includes(replay.replayId))).toHaveLength(2);
  // Same replay ID under another parent: confirmed to end the retry loop, but not recorded.
  relayService.acknowledge("t", agent.ws, JSON.stringify({ ...replay, deliveryId: second.id }));
  expect(agent.frames.filter((frame) => frame.includes(replay.replayId))).toHaveLength(3);
  expect(deliveries().filter((row) => row.trigger === "replay")).toHaveLength(1);
  expect(deliveries().find((row) => row.id === replay.replayId)?.replayOfDeliveryId).toBe(first.id);
});

test("report-only connections receive confirmations without consuming pending delivery batches", () => {
  store(Buffer.from("delivered"));
  const agent = socket();
  relayService.register("t", agent.ws);
  const first = deliveries()[0];
  if (!first) throw new Error("Missing source");
  store(Buffer.from("waiting for disk"));
  const control = socket();
  relayService.register("t", control.ws, { resultReceipts: true, acceptDeliveries: false });
  relayService.send("t");
  expect(control.frames).toHaveLength(1);
  // The first receipt was lost: an agent can repeat its durable receipt while new intake is paused.
  control.receive(first.id);
  relayService.acknowledge(
    "t",
    control.ws,
    JSON.stringify({ type: "ack_relayed", deliveryId: first.id, status: "SUCCESS" }),
  );
  expect(control.frames.at(-1)).toBe(
    JSON.stringify({ type: "result_committed", resultId: first.id, source: "result" }),
  );
  expect(deliveries().filter((row) => row.status === "PENDING")).toHaveLength(1);
  const resumed = socket();
  relayService.register("t", resumed.ws, { resultReceipts: true });
  expect(resumed.frames.flatMap(packets)).toHaveLength(1);
});

test("byte budget includes base64, UTF-8 metadata and envelope; all packages eventually drain", () => {
  const body = Buffer.alloc(32 * 1024, 255);
  store(body, 51);
  const agent = socket();
  relayService.register("t", agent.ws);
  const seen = new Set<string>();
  // ACKing the last item appends the next batch to frames synchronously.
  for (let i = 1; i < agent.frames.length; i++) {
    const frame = agent.frames[i];
    if (!frame) throw new Error("Missing frame");
    expect(Buffer.byteLength(frame)).toBeLessThanOrEqual(env.MAX_REPLAY_BATCH_BYTES);
    const batch = packets(frame);
    expect(batch.length).toBeLessThanOrEqual(env.MAX_REPLAY_BACKLOG_BATCH);
    for (const item of batch) {
      expect(Buffer.from(item.payloadBase64, "base64").equals(body)).toBe(true);
      expect(seen.has(item.id)).toBe(false);
      seen.add(item.id);
      agent.receive(item.id);
    }
  }
  expect(agent.frames.length).toBeGreaterThan(2);
  expect(seen.size).toBe(51);
  expect(deliveries().every((row) => row.status === "DELIVERED")).toBe(true);
});

test("an oversized package travels alone and does not block smaller packages behind it", () => {
  const big = Buffer.alloc(2 * 1024 * 1024, 128);
  store(big);
  store(Buffer.from("small"), 2);
  const agent = socket();
  relayService.register("t", agent.ws);
  const frame = agent.frames[1];
  if (!frame) throw new Error("Missing frame");
  expect(Buffer.byteLength(frame)).toBeGreaterThan(env.MAX_REPLAY_BATCH_BYTES);
  const batch = packets(frame);
  expect(batch).toHaveLength(1);
  const first = batch[0];
  if (!first) throw new Error("Missing package");
  expect(Buffer.from(first.payloadBase64, "base64").equals(big)).toBe(true);
  agent.receive(first.id);
  expect(packets(agent.frames[2] ?? "{}")).toHaveLength(2);
});

test("count-limited batches get a fresh deadline only when the previous batch is fully received", () => {
  jest.useFakeTimers();
  store(Buffer.from("small"), 51);
  const agent = socket();
  relayService.register("t", agent.ws);
  const first = packets(agent.frames[1] ?? "{}");
  expect(first).toHaveLength(50);
  jest.advanceTimersByTime(env.RELAY_ACK_TIMEOUT_MS - 1);
  for (const item of first) agent.receive(item.id);
  const second = packets(agent.frames[2] ?? "{}");
  expect(second).toHaveLength(1);
  jest.advanceTimersByTime(1);
  expect(agent.closed).toHaveLength(0);
  expect(jest.getTimerCount()).toBe(1);
  for (const item of second) agent.receive(item.id);
  jest.advanceTimersByTime(env.RELAY_ACK_TIMEOUT_MS);
  expect(agent.closed).toHaveLength(0);
  expect(jest.getTimerCount()).toBe(0);
});

test("partial receipts and relay results cannot extend the deadline; reconnect sends only missing receipts", () => {
  jest.useFakeTimers();
  store(Buffer.from("body"), 3);
  const old = socket();
  relayService.register("t", old.ws);
  const batch = packets(old.frames[1] ?? "{}");
  const missing = batch.at(-1);
  if (!missing) throw new Error("Missing package");
  jest.advanceTimersByTime(env.RELAY_ACK_TIMEOUT_MS - 1);
  for (const item of batch.slice(0, 2)) old.receive(item.id);
  relayService.acknowledge(
    "t",
    old.ws,
    JSON.stringify({ type: "ack_relayed", deliveryId: missing.id, status: "SUCCESS" }),
  );
  jest.advanceTimersByTime(1);
  expect(old.closed).toEqual([1011]);
  expect(
    deliveries()
      .filter((row) => row.status === "PENDING")
      .map((row) => row.id),
  ).toEqual([missing.id]);
  const next = socket();
  relayService.register("t", next.ws);
  expect(packets(next.frames[1] ?? "{}").map((row) => row.id)).toEqual([missing.id]);
  next.receive(missing.id);
  jest.advanceTimersByTime(env.RELAY_ACK_TIMEOUT_MS * 2);
  expect(next.closed).toHaveLength(0);
  expect(deliveries().find((row) => row.id === missing.id)).toMatchObject({
    status: "DELIVERED",
    relayStatus: "SUCCESS",
  });
  expect(jest.getTimerCount()).toBe(0);
});

test("replacing a socket cancels its timer; an old close cannot cancel the new deadline", () => {
  jest.useFakeTimers();
  store(Buffer.from("body"));
  const old = socket();
  relayService.register("t", old.ws);
  jest.advanceTimersByTime(15_000);
  const next = socket();
  relayService.register("t", next.ws);
  relayService.unregister("t", old.ws);
  jest.advanceTimersByTime(15_000);
  expect(next.closed).toHaveLength(0);
  expect(jest.getTimerCount()).toBe(1);
  jest.advanceTimersByTime(15_000);
  expect(next.closed).toEqual([1011]);
  expect(jest.getTimerCount()).toBe(0);
});

test("dropped, queued and malformed frames clean up receipt timers and preserve pending data", () => {
  jest.useFakeTimers();
  store(Buffer.from("body"));
  const dropped = socket();
  relayService.register("t", dropped.ws);
  relayService.unregister("t", dropped.ws);
  expect(jest.getTimerCount()).toBe(0);
  const queued = socket(-1);
  relayService.register("t", queued.ws);
  expect(jest.getTimerCount()).toBe(1);
  jest.advanceTimersByTime(env.RELAY_ACK_TIMEOUT_MS);
  expect(queued.closed).toEqual([1011]);
  const invalid = socket();
  relayService.register("t", invalid.ws);
  relayService.acknowledge("t", invalid.ws, "{");
  expect(invalid.closed).toEqual([1008]);
  expect(jest.getTimerCount()).toBe(0);
  const zero = socket();
  const send = zero.ws.send;
  zero.ws.send = (data) => {
    send(data);
    return zero.frames.length === 1 ? 1 : 0;
  };
  relayService.register("t", zero.ws);
  expect(zero.closed).toEqual([1011]);
  expect(jest.getTimerCount()).toBe(0);
  expect(deliveries()[0]?.status).toBe("PENDING");
});

test("shutdown cancels deadlines and an offline subscriber still creates pending packages", async () => {
  jest.useFakeTimers();
  store(Buffer.from("body"));
  const agent = socket();
  relayService.register("t", agent.ws);
  relayService.closeAll("shutdown");
  expect(jest.getTimerCount()).toBe(0);
  jest.advanceTimersByTime(60_000);
  expect(agent.closed).toEqual([1001]);
  const ids = store(Buffer.from("arrived offline"), 1, false);
  expect(deliveries()).toHaveLength(1);
  for (const id of ids) ingressEvents.emit("stored", id);
  await Promise.resolve();
  expect(deliveries()).toHaveLength(2);
  expect(deliveries().every((row) => row.status === "PENDING")).toBe(true);
});

test("real WebSocket times out a missing receipt and a new connection receives the pending package", async () => {
  env.RELAY_ACK_TIMEOUT_MS = 100;
  store(Buffer.from("socket-test"));
  db.insert(apiKeys)
    .values({
      tunnelId: "t",
      types: "outbound",
      name: "test",
      keyPrefix: "release",
      keyHash: createHash("sha256").update("release-test-key").digest("hex"),
    })
    .run();
  const { app, websocket } = await import("@server/app");
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch, websocket });
  const url = `ws://127.0.0.1:${server.port}/relay/release`;
  const options = { headers: { "x-api-key": "release-test-key" } };
  const first = new WebSocket(url, options);
  let firstId: string | undefined;
  let second: WebSocket | undefined;
  try {
    const code = await new Promise<number>((resolve, reject) => {
      first.onerror = () => reject(new Error("First socket failed"));
      first.onmessage = (event) => {
        firstId = packets(String(event.data))[0]?.id ?? firstId;
      };
      first.onclose = (event) => resolve(event.code);
    });
    expect(code).toBe(1011);
    const receivedId = firstId;
    if (!receivedId) throw new Error("First socket did not receive a package");
    expect(deliveries()[0]?.status).toBe("PENDING");
    second = new WebSocket(url, options);
    const active = second;
    const nextId = await new Promise<string>((resolve, reject) => {
      active.onerror = () => reject(new Error("Reconnect failed"));
      active.onmessage = (event) => {
        const item = packets(String(event.data))[0];
        if (!item) return;
        active.send(JSON.stringify({ type: "ack_received", deliveryId: item.id }));
        resolve(item.id);
      };
    });
    expect(nextId).toBe(receivedId);
    for (let i = 0; i < 50 && deliveries()[0]?.status !== "DELIVERED"; i++) await Bun.sleep(5);
    expect(deliveries()[0]?.status).toBe("DELIVERED");
  } finally {
    first.close();
    second?.close();
    await server.stop(true);
  }
});

test("events received within the same second are relayed in arrival order", () => {
  const ids: string[] = [];
  for (let i = 0; i < 20; i++) {
    const record = db
      .insert(webhookEvents)
      .values({
        tunnelId: "t",
        collectionId: "c",
        method: "POST",
        contentType: "text/plain",
        payload: Buffer.from(`event-${i}`),
        headers: "{}",
        queryParams: "{}",
        sourceIp: "127.0.0.1",
        receivedAt: new Date(1_000_000),
      })
      .returning()
      .get();
    ids.push(record.id);
    prepareDelivery(record.id);
  }
  const agent = socket();
  relayService.register("t", agent.ws);
  expect(packets(agent.frames[1] ?? "{}").map((item) => item.eventId)).toEqual(ids);
});

test("a result for a source the server no longer has is confirmed, so the agent stops re-sending", () => {
  const agent = socket();
  relayService.register("t", agent.ws, { resultReceipts: true, acceptDeliveries: false });
  const replayId = crypto.randomUUID();
  relayService.acknowledge(
    "t",
    agent.ws,
    JSON.stringify({ type: "ack_replayed", deliveryId: "pruned", replayId, status: "SUCCESS" }),
  );
  relayService.acknowledge(
    "t",
    agent.ws,
    JSON.stringify({ type: "ack_relayed", deliveryId: "pruned", status: "FAILED" }),
  );
  const confirmed = agent.frames
    .filter((frame) => frame.includes("result_committed"))
    .map((frame) => z.object({ resultId: z.string() }).parse(JSON.parse(frame)).resultId);
  expect(confirmed).toEqual([replayId, "pruned"]);
  expect(agent.closed).toHaveLength(0);
  expect(deliveries()).toHaveLength(0);
});
