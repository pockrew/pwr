import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { localDb } from "@agent/db/client";
import { configScope } from "@agent/modules/config/repository";
import { createCollection, createEndpoint } from "@agent/modules/config/service";
import { agentStreamBroker } from "@agent/modules/relays/broker";
import { getEndpointSecret, relayApiKey } from "@agent/modules/relays/credentials.repository";
import { receiveRelayPackage, saveRelaySession } from "@agent/modules/relays/repository";
import { tunnelManager } from "@agent/modules/relays/service";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { z } from "zod";

import {
  AgentRelayConnectSchema,
  ApiErrorResponseSchema,
  ApiSuccessResponseSchema,
  RelayPackageSchema,
} from "@pockrew/pwr-shared/schemas";

import { app } from "./app";
import { agentToken } from "./platform/local-auth";

const scope = { serverUrl: "http://127.0.0.1:1", slug: "remote-slug" };
let collectionId: string;
let endpointId: string;
let target: ReturnType<typeof Bun.serve>;
const targetRequests: { bytes: string; secret: string | null }[] = [];

/** Call a local JSON boundary; assertions inspect runtime responses without unchecked casts. */
const call = (path: string, method = "GET", body?: unknown) =>
  app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const secretPath = () =>
  `/tunnels/local/collections/${collectionId}/endpoints/${endpointId}/secret`;
const packet = (id: string, eventId = id, method: "POST" | "GET" = "POST") =>
  RelayPackageSchema.parse({
    id,
    eventId,
    endpointId,
    tunnelId: "canonical-server-id",
    trigger: "live",
    replayOfDeliveryId: null,
    relayStatus: null,
    method,
    contentType: "application/octet-stream",
    payloadBase64: Buffer.from([0, 255, 10, 42]).toString("base64"),
    headers: "{}",
    queryParams: "{}",
    rawQuery: "tag=a&tag=b&x=%2f",
    localTarget: `http://127.0.0.1:${target.port}/target`,
    eventReceivedAt: "2026-09-23T00:00:00.000Z",
  });

beforeEach(async () => {
  await tunnelManager.shutdown();
  for (const table of [
    "local_config",
    "local_config_state",
    "local_relay_packages",
    "local_deliveries",
    "local_events",
    "local_relay_sessions",
    "local_relay_keys",
    "local_endpoint_secrets",
  ])
    localDb.run(`DELETE FROM ${table}`);
  targetRequests.length = 0;
  target = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      targetRequests.push({
        bytes: Buffer.from(await request.arrayBuffer()).toString("base64"),
        secret: request.headers.get("x-target-key"),
      });
      return new Response("local result");
    },
  });
  saveRelaySession({ ...scope, tunnelId: "local", projectId: "project-a", enabled: false });
  saveRelaySession({
    serverUrl: scope.serverUrl,
    slug: "other-slug",
    tunnelId: "other",
    projectId: "project-b",
    enabled: false,
  });
  collectionId = createCollection(scope, { slug: "collection", isActive: true }).id;
  endpointId = createEndpoint(scope, collectionId, {
    pathName: "target",
    localTarget: `http://127.0.0.1:${target.port}/target`,
    isActive: true,
    isPaused: false,
  }).id;
});
afterEach(async () => {
  await tunnelManager.shutdown();
  target?.stop(true);
});

test("JSON API uses one success/error envelope and matching request IDs", async () => {
  const success = await call("/api/health");
  const health = ApiSuccessResponseSchema(z.object({ status: z.string() })).parse(
    await success.json(),
  );
  expect(success.headers.get("x-request-id")).toBe(health.requestId);

  for (const [path, method, body, expectedStatus, expectedCode] of [
    ["/api/proxy", "POST", { mode: "invalid" }, 400, "VALIDATION_ERROR"],
    ["/api/tunnels/missing/pause", "POST", {}, 404, "NOT_FOUND"],
    ["/api/no-such-route", "GET", undefined, 404, "API_NOT_FOUND"],
    ["/no-such-route", "GET", undefined, 404, "API_NOT_FOUND"],
  ] as const) {
    const response = await call(path, method, body);
    expect(response.status).toBe(expectedStatus);
    const error = ApiErrorResponseSchema.parse(await response.json());
    expect(error.code).toBe(expectedCode);
    expect(response.headers.get("x-request-id")).toBe(error.requestId);
  }

  const forbidden = await app.request("http://localhost/api/health", {
    headers: { host: "remote" },
  });
  expect(forbidden.status).toBe(403);
  expect(ApiErrorResponseSchema.parse(await forbidden.json()).code).toBe("FORBIDDEN");

  const tooLarge = await call("/api/proxy", "POST", { noProxy: "x".repeat(300_000) });
  expect(tooLarge.status).toBe(413);
  expect(ApiErrorResponseSchema.parse(await tooLarge.json()).code).toBe("REQUEST_TOO_LARGE");
});

test("local credential APIs persist offline, validate ownership/headers and never return values", async () => {
  expect(
    (await call(secretPath(), "PUT", { headerName: "X-Target-Key", secret: "target-private" }))
      .status,
  ).toBe(200);
  expect(getEndpointSecret(scope, endpointId)).toEqual({
    headerName: "x-target-key",
    secret: "target-private",
  });
  const status = await call(secretPath());
  expect(await status.json()).toMatchObject({
    data: { configured: true, headerName: "x-target-key" },
  });
  for (const input of [
    { headerName: "Host", secret: "target" },
    { headerName: "x-key", secret: "a\r\nb" },
    { secret: "" },
    { secret: "test", extra: true },
  ])
    expect((await call(secretPath(), "PUT", input)).status).toBe(400);
  expect(
    (await call(secretPath().replace("/local/", "/other/"), "PUT", { secret: "wrong-scope" }))
      .status,
  ).toBe(404);
  for (const path of [
    "/tunnels",
    "/tunnels/local",
    "/tunnels/local/config?kind=endpoint",
    secretPath(),
  ])
    expect(await (await call(path)).text()).not.toContain("target-private");
  expect((await call(secretPath(), "DELETE")).status).toBe(200);
  expect(getEndpointSecret(scope, endpointId)).toBeNull();
  expect((await call("/tunnels/local/relay-key")).status).toBe(200);
  const missingRelayKey = await call("/tunnels/connect", "POST", {
    tunnelId: "local",
    slug: scope.slug,
    serverWsUrl: scope.serverUrl,
  });
  expect(missingRelayKey.status).toBe(409);
  expect(ApiErrorResponseSchema.parse(await missingRelayKey.json()).code).toBe("CONFLICT");
  expect(() => relayApiKey(scope)).toThrow();
  expect((await call("/tunnels/local/relay-key", "PUT", { apiKey: "relay-private" })).status).toBe(
    200,
  );
  expect(relayApiKey(scope)).toBe("relay-private");
  expect(await (await call("/tunnels/local/relay-key")).text()).not.toContain("relay-private");
  expect((await call("/tunnels/local/relay-key", "DELETE")).status).toBe(200);
  expect(() => relayApiKey(scope)).toThrow();
  expect(tunnelManager.getTunnel("local")?.status).toBe("disconnected");
  expect(
    AgentRelayConnectSchema.safeParse({
      tunnelId: "x",
      serverWsUrl: scope.serverUrl,
      apiKey: "bad\nkey",
    }).success,
  ).toBe(false);
});

test("HTTP and MCP share scoped history, deterministic pagination and immutable offline replay", async () => {
  for (const [id, method] of [
    ["a", "POST"],
    ["b", "GET"],
    ["c", "POST"],
  ] satisfies [string, "POST" | "GET"][])
    receiveRelayPackage(scope, packet(id, id, method), "project-a");
  const page = z.object({
    items: z.array(z.object({ id: z.string() })),
    nextCursor: z.string().nullable(),
  });
  const first = ApiSuccessResponseSchema(page).parse(
    await (await call("/requests?tunnelId=local&method=POST&limit=1")).json(),
  ).data;
  expect(first.items.map((item) => item.id)).toEqual(["c"]);
  const second = ApiSuccessResponseSchema(page).parse(
    await (
      await call(`/requests?tunnelId=local&method=POST&limit=1&cursor=${first.nextCursor}`)
    ).json(),
  ).data;
  expect(second.items.map((item) => item.id)).toEqual(["a"]);
  expect(second.nextCursor).toBeNull();
  expect((await call("/requests?tunnelId=other&cursor=c")).status).toBe(400);
  expect((await call("/requests/a?tunnelId=other")).status).toBe(404);
  expect((await call("/requests/a?projectId=project-b")).status).toBe(404);
  expect((await call("/replay/a?tunnelId=other", "POST", {})).status).toBe(404);
  expect(targetRequests).toHaveLength(0);
  expect(
    (await call(secretPath(), "PUT", { headerName: "x-target-key", secret: "only-local" })).status,
  ).toBe(200);
  const source = await (await call("/requests/a?tunnelId=local")).text();
  // Before any target call the event is pending: no invented status or latency.
  const outcome = z.object({
    status: z.number().optional(),
    executionTimeMs: z.number().optional(),
    deliveries: z.object({ total: z.number(), pending: z.number(), succeeded: z.number() }),
    queryParams: z.record(z.string(), z.string()).optional(),
  });
  const pending = ApiSuccessResponseSchema(outcome).parse(JSON.parse(source)).data;
  expect(pending).toMatchObject({ deliveries: { total: 1, pending: 1, succeeded: 0 } });
  expect(pending.status).toBeUndefined();
  expect(pending.executionTimeMs).toBeUndefined();
  expect(pending.queryParams).toEqual({ tag: "a, b", x: "/" });
  expect((await call("/replay/a?tunnelId=local", "POST", {})).status).toBe(200);
  const replayed = ApiSuccessResponseSchema(outcome).parse(
    await (await call("/requests/a?tunnelId=local")).json(),
  ).data;
  expect(replayed).toMatchObject({ status: 200, deliveries: { total: 2, succeeded: 1 } });
  expect(targetRequests).toEqual([{ bytes: packet("a").payloadBase64, secret: "only-local" }]);
  // The original event's replay counter may change; provider bytes remain immutable.
  expect(
    ApiSuccessResponseSchema(z.object({ rawPayloadBase64: z.string() })).parse(JSON.parse(source))
      .data.rawPayloadBase64,
  ).toBe(packet("a").payloadBase64);
  expect(
    ApiSuccessResponseSchema(z.object({ rawPayloadBase64: z.string() })).parse(
      await (await call("/requests/a")).json(),
    ).data.rawPayloadBase64,
  ).toBe(packet("a").payloadBase64);
  const rpc = (name: string, args: unknown) =>
    call("/mcp", "POST", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    });
  expect(
    await (await rpc("list_deliveries", { request_id: "a", tunnel_id: "local" })).text(),
  ).toContain("replayOfDeliveryId");
  expect(
    await (await rpc("get_request", { request_id: "a", tunnel_id: "other" })).text(),
  ).toContain("NOT_FOUND");
  expect(await (await rpc("list_requests", { limit: -1 })).text()).toContain("INVALID_TOOL_INPUT");
  // Replay through MCP is opt-in: a webhook body read by an LLM must not trigger target calls.
  expect(await (await rpc("replay_request", { request_id: "a" })).text()).toContain(
    "REPLAY_DISABLED",
  );
  expect(
    await (await call("/mcp", "POST", { jsonrpc: "2.0", id: 2, method: "tools/list" })).text(),
  ).not.toContain("replay_request");
  expect(targetRequests).toHaveLength(1);
  expect(
    (await call("/mcp", "POST", { jsonrpc: "2.0", method: "notifications/initialized" })).status,
  ).toBe(204);
  expect((await call("/proxy", "POST", { mode: "typo" })).status).toBe(400);
  expect((await call("/proxy", "POST", { mode: "manual" })).status).toBe(400);
  expect((await call("/maintenance/clean", "POST", { action: "sync", days: 7 })).status).toBe(400);
  expect(await (await call("/retention")).json()).toMatchObject({
    data: {
      capabilities: { relayHistoryPruning: true, hardSizeLimit: false, intakeBackpressure: true },
    },
  });
});

test("SSE resolves saved aliases and does not leak another server/slug channel", async () => {
  const response = await call("/events/stream/local");
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing SSE reader");
  try {
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("connected");
    const event = receiveRelayPackage(scope, packet("sse-event"), "project-a");
    if (!event) throw new Error("Expected a new event");
    agentStreamBroker.broadcast({ ...event, id: "wrong-channel" }, configScope("other"));
    agentStreamBroker.broadcast(event, scope);
    const frame = new TextDecoder().decode((await reader.read()).value);
    expect(frame).toContain("sse-event");
    expect(frame).toContain("canonical-server-id");
    expect(frame).not.toContain("wrong-channel");
  } finally {
    await reader.cancel();
  }
  expect((await call("/events/stream/unknown")).status).toBe(404);
});

test("settings round-trip safely and a failed save never reports success", async () => {
  const proxy = {
    mode: "disabled",
    noProxy: 'localhost,"quoted"',
    caCertPath: '/tmp/CA "dev".pem',
  };
  expect((await call("/proxy", "POST", proxy)).status).toBe(200);
  expect(await (await call("/proxy")).json()).toMatchObject({ data: { config: proxy } });
  const retention = { maxEvents: 200, retentionDays: 3, maxDbSizeMb: 25, autoVacuum: false };
  expect((await call("/retention", "PUT", retention)).status).toBe(200);
  expect(await (await call("/retention")).json()).toMatchObject({ data: { config: retention } });
  // The test preload redirects homedir to a temporary directory; no user settings are touched.
  const path = join(homedir(), ".pockrew", "config.toml");
  const previous = readFileSync(path);
  rmSync(path);
  mkdirSync(path);
  try {
    const retentionError = await call("/retention", "PUT", retention);
    const proxyError = await call("/proxy", "POST", proxy);
    for (const response of [retentionError, proxyError]) {
      expect(response.status).toBe(500);
      expect(ApiErrorResponseSchema.parse(await response.json()).code).toBe("INTERNAL_ERROR");
    }
  } finally {
    rmSync(path, { recursive: true });
    writeFileSync(path, previous);
  }
});

test("local API requires the owner-only token; Studio exchanges it for a strict session cookie", async () => {
  process.env["PWR_AGENT_AUTH"] = "on";
  try {
    const token = agentToken();
    expect((await call("/tunnels")).status).toBe(401);
    expect((await call("/mcp", "POST", { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(
      401,
    );
    // Liveness stays open for the CLI's daemon probe.
    expect((await call("/health")).status).toBe(200);
    const bearer = await app.request("/tunnels", { headers: { authorization: `Bearer ${token}` } });
    expect(bearer.status).toBe(200);
    expect((await app.request("/auth?token=wrong")).status).toBe(401);
    const login = await app.request(`/auth?token=${token}`);
    expect(login.status).toBe(303);
    const cookie = login.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    const session = cookie.split(";")[0] ?? "";
    expect((await app.request("/api/tunnels", { headers: { cookie: session } })).status).toBe(200);
  } finally {
    delete process.env["PWR_AGENT_AUTH"];
  }
});
