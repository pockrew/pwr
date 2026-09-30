import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { app as localApp } from "@agent/app";
import { localDb } from "@agent/db/client";
import { getStorageStatus, runRetention } from "@agent/modules/storage/retention.service";
import type { AppEnv } from "@server/platform/types";
import { Hono } from "hono";

import { loadTomlConfig, saveTomlConfig } from "@pockrew/pwr-core";
import {
  RelayClientAckSchema,
  RelayPackageSchema,
  type RelayClientAck,
} from "@pockrew/pwr-shared/schemas";

import { setEndpointTarget } from "./credentials.repository";
import {
  completeRelayPackage,
  getRelayPackage,
  receiveRelayPackage,
  relayReports,
} from "./repository";
import { tunnelManager } from "./service";

process.env["BETTER_AUTH_SECRET"] = "result-retention-integration-secret-at-least-32-characters";
process.env["ADMIN_EMAIL"] = "retention@example.com";
process.env["ADMIN_PASSWORD"] = "retention-test-password";
const { db } = await import("@server/db/client");
const { tunnels, collections, endpoints, webhookEvents, webhookDeliveries, apiKeys } =
  await import("@server/db/schemas");
const { relayRoutes, websocket } = await import("@server/modules/relays/routes");
const { relayService } = await import("@server/modules/relays/service");
const { prepareDelivery } = await import("@server/modules/relays/delivery.service");

const originalConfig = loadTomlConfig();
const key = "retention-test-relay-key";
let server: ReturnType<typeof Bun.serve>;
let target: ReturnType<typeof Bun.serve>;
let received = 0;
const frames: RelayClientAck[] = [];
const accepts: (string | null)[] = [];
const scope = () => ({ serverUrl: `http://127.0.0.1:${server.port}`, slug: "retention" });
const rows = () => db.select().from(webhookDeliveries).all();
const connect = () =>
  tunnelManager.connect({
    tunnelId: "retention-alias",
    slug: scope().slug,
    serverWsUrl: scope().serverUrl,
    apiKey: key,
  });

/** Wait only for observable persisted/transport state; timeout exposes a stuck report or queue. */
const until = async (condition: () => boolean) => {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for committed retention state");
    await Bun.sleep(5);
  }
};
const store = (body: Buffer) => {
  const event = db
    .insert(webhookEvents)
    .values({
      tunnelId: "retention-tunnel",
      collectionId: "retention-c",
      method: "POST",
      contentType: "application/octet-stream",
      payload: body,
      headers: "{}",
      queryParams: "{}",
      sourceIp: "127.0.0.1",
    })
    .returning()
    .get();
  if (!event) throw new Error("Missing stored event");
  prepareDelivery(event.id);
  const delivery = rows().find((row) => row.eventId === event.id);
  if (!delivery) throw new Error("Missing delivery");
  return RelayPackageSchema.parse({
    ...delivery,
    tunnelId: event.tunnelId,
    method: event.method,
    contentType: event.contentType,
    payloadBase64: body.toString("base64"),
    headers: event.headers,
    queryParams: event.queryParams,
    rawQuery: null,
    eventReceivedAt: event.receivedAt.toISOString(),
  });
};

beforeEach(async () => {
  await tunnelManager.shutdown();
  relayService.closeAll("reset");
  saveTomlConfig({
    ...originalConfig,
    retention: { maxEvents: 1000, retentionDays: 7, maxDbSizeMb: 50, autoVacuum: true },
  });
  for (const table of [webhookDeliveries, webhookEvents, apiKeys, endpoints, collections, tunnels])
    db.delete(table).run();
  for (const table of [
    "local_relay_packages",
    "local_relay_tombstones",
    "local_events",
    "local_deliveries",
    "local_relay_keys",
    "local_relay_sessions",
    "local_endpoint_targets",
    "local_config",
    "local_config_state",
  ])
    localDb.run(`DELETE FROM ${table}`);
  runRetention();
  received = 0;
  frames.length = accepts.length = 0;
  target = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      await request.arrayBuffer();
      received++;
      return new Response("committed target result");
    },
  });
  const app = new Hono<AppEnv>().route("/relay", relayRoutes);
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request, raw) => {
      if (new URL(request.url).pathname.startsWith("/relay/"))
        accepts.push(request.headers.get("x-relay-accept-deliveries"));
      return app.fetch(request, raw);
    },
    websocket: {
      ...websocket,
      message: (ws, data) => {
        frames.push(RelayClientAckSchema.parse(JSON.parse(String(data))));
        websocket.message?.(ws, data);
      },
    },
  });
  db.insert(tunnels).values({ id: "retention-tunnel", slug: "retention", name: "Retention" }).run();
  db.insert(collections).values({ id: "retention-c", tunnelId: "retention-tunnel" }).run();
  db.insert(endpoints)
    .values({ id: "retention-e", collectionId: "retention-c", pathName: "target" })
    .run();
  setEndpointTarget(scope(), "retention-e", `http://127.0.0.1:${target.port}`);
  db.insert(apiKeys)
    .values({
      tunnelId: "retention-tunnel",
      types: "outbound",
      name: "test",
      keyPrefix: "test",
      keyHash: createHash("sha256").update(key).digest("hex"),
    })
    .run();
});
afterEach(async () => {
  localDb.run("DROP TRIGGER IF EXISTS reject_result_receipt");
  await tunnelManager.shutdown();
  relayService.closeAll("test finished");
  server.stop(true);
  target.stop(true);
  saveTomlConfig(originalConfig);
});

test("lost commit confirmation is retried after reconnect; confirmed results stop resending", async () => {
  const packet = store(Buffer.from("lost confirmation"));
  localDb.run(
    "CREATE TRIGGER reject_result_receipt BEFORE UPDATE OF reported_at ON local_relay_packages BEGIN SELECT RAISE(ABORT, 'simulate crash before confirmation persisted'); END",
  );
  connect();
  await until(() => rows()[0]?.relayStatus === "SUCCESS");
  // The server row commits before its confirmation frame reaches the agent; wait for the failed
  // confirmation to force a reconnect so the trigger is proven to have fired.
  await until(() => accepts.length >= 2);
  expect(getRelayPackage(scope(), packet.id)?.reportedAt).toBeNull();
  expect(relayReports(scope(), 0, true)).toHaveLength(1);
  localDb.run("DROP TRIGGER reject_result_receipt");
  await until(() => getRelayPackage(scope(), packet.id)?.reportedAt !== null);
  expect(relayReports(scope(), 0, true)).toHaveLength(0);
  expect(received).toBe(1);
  const reports = frames.filter((frame) => frame.type === "ack_relayed").length;
  expect(reports).toBeGreaterThan(1);
  await tunnelManager.shutdown();
  tunnelManager.restoreConnections();
  await until(
    () => accepts.length >= 3 && tunnelManager.getTunnel("retention-alias")?.status === "connected",
  );
  await Bun.sleep(20);
  expect(frames.filter((frame) => frame.type === "ack_relayed")).toHaveLength(reports);
  expect(received).toBe(1);
});

test("an unfinished durable receipt is retried even when the server no longer dispatches its endpoint", async () => {
  const packet = store(Buffer.from("stored before receipt frame was lost"));
  receiveRelayPackage(scope(), packet, "default");
  db.update(endpoints).set({ isPaused: true }).run();
  tunnelManager.connect(
    {
      tunnelId: "retention-alias",
      slug: scope().slug,
      serverWsUrl: scope().serverUrl,
      apiKey: key,
    },
    true,
  );
  await until(() => rows().find((row) => row.id === packet.id)?.status === "DELIVERED");
  expect(
    frames.some((frame) => frame.type === "ack_received" && frame.deliveryId === packet.id),
  ).toBe(true);
  expect(getRelayPackage(scope(), packet.id)?.result).toBeNull();
  expect(received).toBe(0);
});

test("a full agent reports on a paused socket, never ACKs rejected payload, then manual clean resumes intake", async () => {
  const old = store(Buffer.alloc(600 * 1024, 255));
  receiveRelayPackage(scope(), old, "default");
  completeRelayPackage(
    scope(),
    old.id,
    {
      id: old.id,
      webhookId: old.eventId,
      tunnelId: old.tunnelId,
      orgId: "default",
      projectId: "default",
      targetUrl: `http://127.0.0.1:${target.port}`,
      statusCode: 200,
      latencyMs: 1,
      deliveredAt: Date.now(),
    },
    { type: "ack_relayed", deliveryId: old.id, status: "SUCCESS" },
  );
  localDb.run("UPDATE local_relay_packages SET completed_at = ? WHERE id = ?", [
    Date.now() - 8 * 86_400_000,
    old.id,
  ]);
  // Its receipt was also lost. The full agent must report without downloading it again.
  const incoming = store(Buffer.alloc(128 * 1024));
  saveTomlConfig({
    ...loadTomlConfig(),
    retention: { ...loadTomlConfig().retention, maxDbSizeMb: 1 },
  });
  connect();
  await until(() => getStorageStatus().state === "blocked" && accepts.includes("0"));
  await until(() => getRelayPackage(scope(), old.id)?.reportedAt !== null);
  expect(rows().find((row) => row.id === incoming.id)?.status).toBe("PENDING");
  expect(
    frames.some((frame) => frame.type === "ack_received" && frame.deliveryId === incoming.id),
  ).toBe(false);
  expect(getRelayPackage(scope(), incoming.id)).toBeNull();
  expect(received).toBe(0);
  const health = await localApp.request("/health");
  expect(await health.json()).toMatchObject({
    data: { status: "storage_blocked", storage: { state: "blocked" } },
  });
  const cleaned = await localApp.request("/maintenance/clean", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "clean", days: 7 }),
  });
  expect(cleaned.status).toBe(200);
  expect(await cleaned.json()).toMatchObject({
    data: { deletedPackages: 1, storage: { state: "ready" } },
  });
  await until(() => rows().find((row) => row.id === incoming.id)?.relayStatus === "SUCCESS");
  expect(accepts.at(-1)).toBe("1");
  expect(received).toBe(1);
  expect(getRelayPackage(scope(), incoming.id)?.packet.payloadBase64).toBe(incoming.payloadBase64);
});
