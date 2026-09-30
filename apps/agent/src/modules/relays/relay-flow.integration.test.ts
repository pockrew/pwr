import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { localDb } from "@agent/db/client";
import {
  getEndpointSecret,
  relayApiKey,
  relayKeyStatus,
  setEndpointSecret,
  setEndpointTarget,
} from "@agent/modules/relays/credentials.repository";
import {
  createLocalReplay,
  getRelayPackage,
  receiveRelayPackage,
  relayReports,
} from "@agent/modules/relays/repository";
import { relayRoutes as localRelayRoutes } from "@agent/modules/relays/routes";
import { AgentTunnelManager, tunnelManager } from "@agent/modules/relays/service";
import type { AppEnv } from "@server/platform/types";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { forwardRelayPackage } from "@pockrew/pwr-core";
import {
  AgentRelayConnectSchema,
  ApiSuccessResponseSchema,
  RelayClientAckSchema,
  RelayPackageSchema,
} from "@pockrew/pwr-shared/schemas";

const TEST_RELAY_API_KEY = "test-explicit-relay-key";

// Integration fixture imports real server routes; production agent imports only AppType.
// scripts/test.setup.ts isolates both databases from the user's files.
process.env["BETTER_AUTH_SECRET"] = "agent-relay-integration-secret-long-enough";
process.env["ADMIN_EMAIL"] = "agent-test@example.com";
process.env["ADMIN_PASSWORD"] = "agent-test-password";
const { db } = await import("@server/db/client");
const { tunnels, collections, endpoints, webhookEvents, webhookDeliveries, apiKeys } =
  await import("@server/db/schemas");
const { relayRoutes, websocket } = await import("@server/modules/relays/routes");
const { ingressRoutes } = await import("@server/modules/ingress/routes");
const { relayService } = await import("@server/modules/relays/service");
const { DeliveryAckSchema } = await import("@server/modules/relays/delivery.service");
const { env } = await import("@server/platform/env");

let manager: AgentTunnelManager;
let upstream: ReturnType<typeof Bun.serve>;
let target: ReturnType<typeof createServer>;
let baseUrl: string;
let targetUrl: string;
let releaseTarget: () => void = () => {};
let targetGate: Promise<void> = Promise.resolve();
let targetStatus = 200;
let dropReceipt = false;
let dropResults = false;
const received: { body: Buffer; url: string; headers: Headers; method: string }[] = [];
const frames: string[] = [];
const handshakes: { url: string; key: string | null }[] = [];
const rows = () => db.select().from(webhookDeliveries).all();
const scope = () => ({ serverUrl: baseUrl, slug: "agent-flow" });

/** Waits for an observable integration state, failing rather than hanging a test. */
const until = async (condition: () => boolean): Promise<void> => {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for relay state");
    await Bun.sleep(5);
  }
};

/** Captures raw provider bytes through the real ingress HTTP route. */
const ingest = async (
  body: Buffer,
  query = "tag=a&tag=b&x=%2f&empty=",
  headers: Record<string, string> = {},
) => {
  const response = await fetch(`${baseUrl}/ingress/agent-flow/c?${query}`, {
    method: "POST",
    body,
    headers: {
      "x-api-key": "provider-test-key",
      "content-type": "application/octet-stream",
      ...headers,
    },
  });
  expect(response.status).toBe(200);
  await response.arrayBuffer();
  await Bun.sleep(0);
};

/** Uses the existing local connect API shape; tunnelId and server slug deliberately differ. */
const connect = (apiKey?: string) =>
  manager.connect({
    tunnelId: "local-alias",
    slug: "agent-flow",
    serverWsUrl: baseUrl.replace("http:", "ws:"),
    apiKey,
  });

beforeEach(async () => {
  manager = new AgentTunnelManager();
  received.length = frames.length = handshakes.length = 0;
  targetGate = Promise.resolve();
  targetStatus = 200;
  dropReceipt = dropResults = false;
  env.RELAY_ACK_TIMEOUT_MS = 30_000;
  for (const table of [webhookDeliveries, webhookEvents, apiKeys, endpoints, collections, tunnels])
    db.delete(table).run();
  for (const table of [
    "local_relay_packages",
    "local_events",
    "local_deliveries",
    "local_relay_keys",
    "local_endpoint_secrets",
    "local_endpoint_targets",
    "local_relay_sessions",
  ])
    localDb.run(`DELETE FROM ${table}`);
  // Native HTTP fixture observes GET bodies too; Fetch Request intentionally hides them.
  target = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    received.push({
      body: Buffer.concat(chunks),
      url: `${targetUrl}${request.url}`,
      headers,
      method: request.method ?? "GET",
    });
    await targetGate;
    response.writeHead(targetStatus);
    response.end("target result");
  });
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
  const address = target.address();
  if (!address || typeof address === "string") throw new Error("Missing target port");
  targetUrl = `http://127.0.0.1:${address.port}`;
  const app = new Hono<AppEnv>().route("/relay", relayRoutes).route("/ingress", ingressRoutes);
  upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request, server) => {
      if (new URL(request.url).pathname.startsWith("/relay/"))
        handshakes.push({ url: request.url, key: request.headers.get("x-api-key") });
      return app.fetch(request, server);
    },
    websocket: {
      ...websocket,
      message: (ws, message) => {
        const encoded = String(message);
        frames.push(encoded);
        const ack = RelayClientAckSchema.parse(JSON.parse(encoded));
        expect(DeliveryAckSchema.safeParse(ack).success).toBe(true);
        if (dropReceipt && ack.type === "ack_received") return;
        if (dropResults && ack.type !== "ack_received") return;
        websocket.message?.(ws, message);
      },
    },
  });
  baseUrl = `http://127.0.0.1:${upstream.port}`;
  relayApiKey(scope(), TEST_RELAY_API_KEY);
  db.insert(tunnels)
    .values({ id: "server-tunnel-id", slug: "agent-flow", name: "Agent flow" })
    .run();
  db.insert(collections).values({ id: "c", tunnelId: "server-tunnel-id" }).run();
  // Routing lives on the server; each target is agent-owned.
  for (const id of ["a", "b"]) {
    db.insert(endpoints).values({ id, collectionId: "c", pathName: id }).run();
    setEndpointTarget(scope(), id, `${targetUrl}/${id}`);
  }
  for (const [types, key] of [
    ["inbound", "provider-test-key"],
    ["outbound", TEST_RELAY_API_KEY],
  ] as const) {
    if (!types || !key) throw new Error("Invalid test credential");
    db.insert(apiKeys)
      .values({
        tunnelId: "server-tunnel-id",
        types,
        name: "test",
        keyPrefix: "test",
        keyHash: createHash("sha256").update(key).digest("hex"),
      })
      .run();
  }
});

afterEach(async () => {
  releaseTarget();
  await manager.shutdown();
  await tunnelManager.shutdown();
  relayService.closeAll("test complete");
  await upstream.stop(true);
  target.closeAllConnections();
  await new Promise<void>((resolve) => target.close(() => resolve()));
  localDb.run("DROP TRIGGER IF EXISTS reject_relay_event");
});

test("real ingress -> sync/live -> local targets preserves bytes/query and separates receipt from result", async () => {
  const binary = Buffer.from([0, 255, 13, 10, 128, 65]);
  const gzip = gzipSync(Buffer.from('{ "original" : true }\n'));
  setEndpointSecret(scope(), "a", "Bearer local-only-a");
  setEndpointSecret(scope(), "b", "local-only-b", "x-target-secret");
  await ingest(binary);
  await ingest(gzip, "q=%2F&q=+&q=%20", { "content-encoding": "gzip" });
  expect(rows()).toHaveLength(4);
  expect(rows().every((row) => row.status === "PENDING")).toBe(true);
  targetGate = new Promise<void>((resolve) => {
    releaseTarget = resolve;
  });
  connect();
  await until(() => rows().every((row) => row.status === "DELIVERED"));
  expect(rows().every((row) => row.relayStatus === null)).toBe(true);
  expect(localDb.query("SELECT id FROM local_relay_packages").all()).toHaveLength(4);
  releaseTarget();
  await until(() => rows().every((row) => row.relayStatus === "SUCCESS"));
  expect(received).toHaveLength(4);
  for (const request of received) {
    const isGzip = request.headers.get("content-encoding") === "gzip";
    expect(request.body).toEqual(isGzip ? gzip : binary);
    expect(new URL(request.url).search.slice(1)).toBe(
      isGzip ? "q=%2F&q=+&q=%20" : "tag=a&tag=b&x=%2f&empty=",
    );
    expect(request.headers.get("x-pwr-raw-bypassed")).toBeNull();
    expect(request.headers.get("x-api-key")).toBeNull();
    if (new URL(request.url).pathname === "/a")
      expect(request.headers.get("authorization")).toBe("Bearer local-only-a");
    else expect(request.headers.get("x-target-secret")).toBe("local-only-b");
  }
  const rawJson = Buffer.from('\ufeff{ "x":1, "x":2 }\r\n');
  await ingest(rawJson);
  await until(() => rows().length === 6 && rows().every((row) => row.relayStatus === "SUCCESS"));
  expect(received.slice(-2).every((request) => request.body.equals(rawJson))).toBe(true);
  expect(handshakes[0]?.key).toBe(TEST_RELAY_API_KEY);
  expect(handshakes[0]?.url).toBe(`${baseUrl}/relay/agent-flow`);
  expect(frames.join("")).not.toContain("local-only-");
  expect(JSON.stringify(manager.getTunnels())).not.toContain(TEST_RELAY_API_KEY);
  expect(relayReports(scope())).toHaveLength(6);
});

test("lost receipt reconnects automatically, resends result, and does not execute a completed target again", async () => {
  db.delete(endpoints).where(eq(endpoints.id, "b")).run();
  env.RELAY_ACK_TIMEOUT_MS = 100;
  dropReceipt = true;
  await ingest(Buffer.from("receipt may be lost"));
  connect();
  await until(() => rows()[0]?.relayStatus === "SUCCESS");
  expect(rows()[0]?.status).toBe("PENDING");
  dropReceipt = false;
  await until(() => handshakes.length >= 2 && rows()[0]?.status === "DELIVERED");
  expect(received).toHaveLength(1);
  expect(localDb.query("SELECT id FROM local_deliveries").all()).toHaveLength(1);
});

test("offline result/replay survive manager restart and keep identical replay IDs on repeated ACK", async () => {
  db.delete(endpoints).where(eq(endpoints.id, "b")).run();
  dropResults = true;
  await ingest(Buffer.from("offline replay bytes"));
  connect();
  await until(() => relayReports(scope()).length === 1 && rows()[0]?.status === "DELIVERED");
  const sourceId = rows()[0]?.id;
  if (!sourceId) throw new Error("Missing source delivery");
  await manager.shutdown();
  await manager.replayLocal(sourceId);
  expect(relayReports(scope())).toHaveLength(2);
  expect(rows()).toHaveLength(1);
  expect(rows()[0]?.relayStatus).toBeNull();
  expect(received).toHaveLength(2);
  dropResults = false;
  manager = new AgentTunnelManager();
  expect(manager.restoreConnections()).toBe(1);
  await until(() => rows().length === 2 && rows().every((row) => row.relayStatus === "SUCCESS"));
  const replay = rows().find((row) => row.trigger === "replay");
  expect(replay?.replayOfDeliveryId).toBe(sourceId);
  expect(
    localDb.query("SELECT id FROM local_deliveries WHERE id = ?").get(replay?.id ?? ""),
  ).not.toBeNull();
  expect(rows().find((row) => row.id === sourceId)?.trigger).toBe("live");
  manager.disconnect("local-alias");
  connect();
  await until(() => handshakes.length === 3);
  await Bun.sleep(30);
  expect(rows()).toHaveLength(2);
  expect(received).toHaveLength(2);
  expect(
    frames
      .filter((frame) => JSON.parse(frame).type === "ack_replayed")
      .every((frame) => JSON.parse(frame).replayId === replay?.id),
  ).toBe(true);
});

test("a paused durable receipt resumes after restart even when server pending queue is empty", async () => {
  db.delete(endpoints).where(eq(endpoints.id, "b")).run();
  await ingest(Buffer.alloc(0));
  connect();
  manager.pauseTunnel("local-alias");
  await until(() => rows()[0]?.status === "DELIVERED");
  expect(received).toHaveLength(0);
  expect(localDb.query("SELECT id FROM local_events").all()).toHaveLength(1);
  await manager.shutdown();
  manager = new AgentTunnelManager();
  expect(manager.restoreConnections()).toBe(1);
  await until(() => manager.getTunnel("local-alias")?.status === "connected");
  expect(manager.getTunnel("local-alias")?.isPaused).toBe(true);
  expect(received).toHaveLength(0);
  await manager.resumeTunnel("local-alias");
  await until(() => rows()[0]?.relayStatus === "SUCCESS");
  expect(received).toHaveLength(1);
  expect(received[0]?.body).toEqual(Buffer.alloc(0));
});

test("storage failure never ACKs receipt and pending data recovers after reconnect", async () => {
  db.delete(endpoints).where(eq(endpoints.id, "b")).run();
  await ingest(Buffer.from("must commit first"));
  localDb.run(
    "CREATE TRIGGER reject_relay_event BEFORE INSERT ON local_events BEGIN SELECT RAISE(ABORT, 'test storage failure'); END",
  );
  connect();
  await until(() => handshakes.length > 0);
  await Bun.sleep(30);
  expect(frames).toHaveLength(0);
  expect(rows()[0]?.status).toBe("PENDING");
  expect(received).toHaveLength(0);
  localDb.run("DROP TRIGGER reject_relay_event");
  await until(() => rows()[0]?.relayStatus === "SUCCESS");
  expect(received).toHaveLength(1);
});

test("failed target is a terminal relay result; each explicit replay gets a separate record", async () => {
  db.delete(endpoints).where(eq(endpoints.id, "b")).run();
  targetStatus = 503;
  await ingest(Buffer.from("target failure"));
  connect();
  await until(() => rows()[0]?.relayStatus === "FAILED");
  const sourceId = rows()[0]?.id;
  if (!sourceId) throw new Error("Missing source");
  await manager.drainTunnel("local-alias");
  expect(received).toHaveLength(1);
  targetStatus = 200;
  await manager.replayLocal(sourceId);
  await manager.replayLocal(sourceId);
  await until(() => rows().length === 3);
  expect(
    rows().filter((row) => row.trigger === "replay" && row.relayStatus === "SUCCESS"),
  ).toHaveLength(2);
  expect(rows().find((row) => row.id === sourceId)?.relayStatus).toBe("FAILED");
});

test("GET bytes use the raw forwarder; remote secret fields cannot enter local credentials or ACKs", async () => {
  expect(statSync(join(homedir(), ".pockrew", "agent.db")).mode & 0o077).toBe(0);
  const packet = RelayPackageSchema.parse({
    id: crypto.randomUUID(),
    eventId: crypto.randomUUID(),
    endpointId: "a",
    tunnelId: "server-tunnel-id",
    trigger: "live",
    replayOfDeliveryId: null,
    relayStatus: null,
    method: "GET",
    contentType: "application/octet-stream",
    payloadBase64: Buffer.from([0, 255, 128]).toString("base64"),
    headers: JSON.stringify({
      "x-api-key": "legacy-ingress-key",
      "x-hub-signature-256": "sha256=provider-signature",
    }),
    queryParams: "{}",
    rawQuery: "x=%2f&x=+",
    // A server can no longer choose where deliveries go: this field is stripped on receipt.
    localTarget: "https://attacker.example/steal",
    eventReceivedAt: new Date().toISOString(),
    secretToken: "remote-secret-must-not-be-used",
  });
  receiveRelayPackage(scope(), packet, "default");
  const outcome = await forwardRelayPackage(
    packet,
    `${targetUrl}/a`,
    "default",
    getEndpointSecret(scope(), packet.endpointId),
  );
  expect(outcome.ack.type).toBe("ack_relayed");
  // Only outcome metadata goes upstream; the response body stays local.
  expect(JSON.stringify(outcome.ack)).not.toContain("target result");
  expect(outcome.result.responseBody).toBe("target result");
  expect(received[0]?.headers.get("x-pwr-delivery-id")).toBe(packet.id);
  expect(
    JSON.stringify(localDb.query("SELECT metadata FROM local_relay_packages").all()),
  ).not.toContain("attacker.example");
  expect(received[0]?.method).toBe("GET");
  expect(received[0]?.body).toEqual(Buffer.from([0, 255, 128]));
  expect(received[0]?.headers.get("authorization")).toBeNull();
  expect(received[0]?.headers.get("x-api-key")).toBeNull();
  expect(received[0]?.headers.get("x-hub-signature-256")).toBe("sha256=provider-signature");
  expect(
    JSON.stringify(localDb.query("SELECT metadata FROM local_relay_packages").all()),
  ).not.toContain("remote-secret");
  expect(JSON.stringify(localDb.query("SELECT headers FROM local_events").all())).not.toContain(
    "legacy-ingress-key",
  );
  expect(
    JSON.stringify(localDb.query("SELECT metadata FROM local_relay_packages").all()),
  ).not.toContain("legacy-ingress-key");
  setEndpointSecret(scope(), "a", "local-secret");
  expect(getEndpointSecret({ ...scope(), slug: "different" }, "a")).toBeNull();
  expect(relayApiKey(scope(), "saved-local-key")).toBe("saved-local-key");
  expect(relayApiKey(scope())).toBe("saved-local-key");
  expect(() => relayApiKey({ ...scope(), slug: "different" })).toThrow(
    "Configure a local relay key",
  );
});

test("offline replay chains report parents first after restart; explicit disconnect stays disabled", async () => {
  db.delete(endpoints).where(eq(endpoints.id, "b")).run();
  dropResults = true;
  await ingest(Buffer.from("replay chain"));
  connect();
  await until(() => relayReports(scope()).length === 1 && rows()[0]?.status === "DELIVERED");
  const source = rows()[0];
  if (!source) throw new Error("Missing source");
  await manager.shutdown();
  const first = await manager.replayLocal(source.id);
  const second = await manager.replayLocal(first.id);
  expect(relayReports(scope()).map((row) => row.id)).toEqual([source.id, first.id, second.id]);
  dropResults = false;
  manager = new AgentTunnelManager();
  expect(manager.restoreConnections()).toBe(1);
  await until(() => rows().length === 3 && rows().every((row) => row.relayStatus === "SUCCESS"));
  expect(rows().find((row) => row.id === second.id)?.replayOfDeliveryId).toBe(first.id);
  expect(received).toHaveLength(3);
  manager.disconnect("local-alias");
  manager = new AgentTunnelManager();
  expect(manager.restoreConnections()).toBe(0);
});

test("local relay routes expose fanout IDs, reject payload overrides and return the stable replay ID", async () => {
  await ingest(Buffer.from([0, 255, 13, 10]));
  connect();
  await until(() => rows().length === 2 && rows().every((row) => row.relayStatus === "SUCCESS"));
  const eventId = rows()[0]?.eventId;
  if (!eventId) throw new Error("Missing event");
  const listed = await localRelayRoutes.request(`/requests/${eventId}/deliveries`);
  expect(listed.status).toBe(200);
  const body = ApiSuccessResponseSchema(
    z.object({ count: z.number(), items: z.array(z.object({ id: z.string() })) }),
  ).parse(await listed.json()).data;
  expect(body.count).toBe(2);
  const sourceId = body.items[0]?.id;
  if (!sourceId) throw new Error("Missing listed delivery");
  const before = received.length;
  for (const overrides of [
    { targetUrl: `${targetUrl}/different` },
    { payloadBase64: "YQ==" },
    { headers: { authorization: "override" } },
  ]) {
    const response = await localRelayRoutes.request(`/replay/${sourceId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(overrides),
    });
    expect(response.status).toBe(400);
  }
  expect(received).toHaveLength(before);
  const replayResponse = await localRelayRoutes.request(`/replay/${sourceId}`, { method: "POST" });
  expect(replayResponse.status).toBe(200);
  const replay = ApiSuccessResponseSchema(
    z.object({ delivery: z.object({ id: z.string() }) }),
  ).parse(await replayResponse.json()).data;
  expect(replay.delivery.id).not.toBe(sourceId);
  expect(received).toHaveLength(before + 1);
  expect(received.at(-1)?.body).toEqual(Buffer.from([0, 255, 13, 10]));
  // Route execution used the singleton while transport used the test manager: reconnect flushes its durable ACK.
  await manager.shutdown();
  manager = new AgentTunnelManager();
  manager.restoreConnections();
  await until(() => rows().some((row) => row.id === replay.delivery.id));
  expect(rows().find((row) => row.id === replay.delivery.id)?.replayOfDeliveryId).toBe(sourceId);
  expect((await localRelayRoutes.request("/requests?limit=-1")).status).toBe(400);
  for (const value of [{ serverWsUrl: "http://user:secret@server" }, { projectId: "x".repeat(65) }])
    expect(
      AgentRelayConnectSchema.safeParse({ tunnelId: "t", serverWsUrl: "http://server", ...value })
        .success,
    ).toBe(false);
  expect(
    (
      await localRelayRoutes.request("/tunnels/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tunnelId: "t", serverWsUrl: "http://server?key=secret" }),
      })
    ).status,
  ).toBe(400);
});

test("restart drains an unfinished local replay and accepts historical results without an embedded ID", async () => {
  db.delete(endpoints).where(eq(endpoints.id, "b")).run();
  await ingest(Buffer.from("pending replay after crash"));
  connect();
  await until(() => rows()[0]?.relayStatus === "SUCCESS");
  const sourceId = rows()[0]?.id;
  if (!sourceId) throw new Error("Missing source");
  await manager.shutdown();
  // Simulate the pre-Drizzle result encoding and a process exit after replay creation.
  localDb.run("UPDATE local_relay_packages SET result = json_remove(result, '$.id') WHERE id = ?", [
    sourceId,
  ]);
  expect(getRelayPackage(scope(), sourceId)?.result?.id).toBe(sourceId);
  const replayId = createLocalReplay(scope(), sourceId);
  expect(getRelayPackage(scope(), replayId)?.result).toBeNull();
  manager = new AgentTunnelManager();
  manager.restoreConnections();
  await until(() => rows().some((row) => row.id === replayId && row.relayStatus === "SUCCESS"));
  expect(getRelayPackage(scope(), replayId)?.result?.id).toBe(replayId);
  expect(received).toHaveLength(2);
  expect(received[1]?.body).toEqual(received[0]?.body);
});

test("tunnel key check reports the server verdict without storing the key or opening a relay socket", async () => {
  const check = async (body: Record<string, string>) => {
    const response = await localRelayRoutes.request("/tunnels/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    return ApiSuccessResponseSchema(z.object({ result: z.string() })).parse(await response.json())
      .data.result;
  };
  const input = { serverWsUrl: baseUrl, slug: "agent-flow", apiKey: TEST_RELAY_API_KEY };
  expect(await check(input)).toBe("ok");
  // Without a key, the one saved for this server/slug is checked.
  expect(await check({ serverWsUrl: baseUrl, slug: "agent-flow" })).toBe("ok");
  expect(await check({ ...input, apiKey: "wrong-key" })).toBe("unauthorized");
  expect(await check({ ...input, apiKey: "provider-test-key" })).toBe("unauthorized");
  expect(await check({ ...input, slug: "missing" })).toBe("not_found");
  expect(await check({ ...input, serverWsUrl: "http://127.0.0.1:1" })).toBe("unreachable");
  // Only the side-effect-free check route was called; nothing was saved locally.
  expect(handshakes.every(({ url }) => new URL(url).pathname.endsWith("/check"))).toBe(true);
  expect(relayKeyStatus({ serverUrl: baseUrl, slug: "missing" }).configured).toBe(false);
  expect(tunnelManager.getTunnels()).toEqual([]);
});

test("an agent whose tunnel is taken over stops reconnecting, also after a restart", async () => {
  connect();
  await until(() => manager.getTunnel("local-alias")?.status === "connected");
  // Another machine takes the tunnel over.
  relayService.register(
    "server-tunnel-id",
    { data: {}, readyState: 1, getBufferedAmount: () => 0, send: () => 1, close: () => {} },
    { agentId: "another-machine", takeover: true },
  );
  await until(() => manager.getTunnel("local-alias")?.status === "disconnected");
  expect(manager.getTunnel("local-alias")?.lastError).toBe("tunnel_in_use");
  const attempts = handshakes.length;
  // Longer than the first reconnect backoff (1s ± 20%): no attempt to take the tunnel back.
  await Bun.sleep(1300);
  expect(handshakes).toHaveLength(attempts);
  expect(new AgentTunnelManager().restoreConnections()).toBe(0);
});
