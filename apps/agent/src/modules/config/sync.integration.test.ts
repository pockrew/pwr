import { createHash } from "node:crypto";
import { localDb } from "@agent/db/client";
import { configRoutes } from "@agent/modules/config/routes";
import {
  getEndpointSecret,
  getEndpointTarget,
  relayApiKey,
  setEndpointSecret,
  setEndpointTarget,
} from "@agent/modules/relays/credentials.repository";
import {
  getRelayPackage,
  nextRelayPackage,
  receiveRelayPackage,
  saveRelaySession,
} from "@agent/modules/relays/repository";
import { AgentTunnelManager } from "@agent/modules/relays/service";
import type { AppEnv } from "@server/platform/types";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import {
  ConfigCollectionSchema,
  ConfigDocumentSchema,
  ConfigMutationResultSchema,
  RelayPackageSchema,
} from "@pockrew/pwr-shared/schemas";

import {
  acceptRemoteConfig,
  bindConfigScope,
  configState,
  getConfig,
  pendingConfig,
  resolveConfig,
} from "./repository";
import { createCollection, createEndpoint, updateCollection, updateEndpoint } from "./service";
import { syncConfig } from "./sync";

process.env["BETTER_AUTH_SECRET"] = "config-sync-integration-secret-long-enough";
process.env["ADMIN_EMAIL"] = "config-test@example.com";
process.env["ADMIN_PASSWORD"] = "config-test-password";
const { db } = await import("@server/db/client");
const { tunnels, collections, endpoints, apiKeys, audit_logs, webhookDeliveries, webhookEvents } =
  await import("@server/db/schemas");
const { tunnelManagementRoutes } = await import("@server/modules/tunnels/routes");
const { relayRoutes, websocket } = await import("@server/modules/relays/routes");
const { relayService } = await import("@server/modules/relays/service");
const { ingressRoutes } = await import("@server/modules/ingress/routes");
const { handleError } = await import("@server/platform/error.handlers");
const { requestIdMiddleware } = await import("@server/platform/securities.middleware");
const { deleteCollection } = await import("@server/modules/tunnels/service");

let upstream: ReturnType<typeof Bun.serve>;
let target: ReturnType<typeof Bun.serve>;
let manager: AgentTunnelManager;
let baseUrl = "";
let targetUrl = "";
let dropPush = false;
let rejectPush = false;
let onPush: () => void = () => {};
const requests: { path: string; bytes: string; secret: string | null }[] = [];
const scope = () => ({ serverUrl: baseUrl, slug: "sync" });
const sync = () => syncConfig(scope(), "t", new AbortController().signal);

/** Bound observable waits; a failed reconnect must fail the test rather than hang. */
const until = async (condition: () => boolean) => {
  const end = Date.now() + 8000;
  while (!condition()) {
    if (Date.now() > end) throw new Error("Timed out waiting for config sync");
    await Bun.sleep(10);
  }
};

beforeEach(async () => {
  manager = new AgentTunnelManager();
  requests.length = 0;
  dropPush = false;
  rejectPush = false;
  onPush = () => {};
  for (const table of [
    webhookDeliveries,
    webhookEvents,
    apiKeys,
    endpoints,
    collections,
    tunnels,
    audit_logs,
  ])
    db.delete(table).run();
  for (const table of [
    "local_config",
    "local_config_state",
    "local_relay_packages",
    "local_deliveries",
    "local_events",
    "local_relay_sessions",
    "local_relay_keys",
    "local_endpoint_secrets",
    "local_endpoint_targets",
  ])
    localDb.run(`DELETE FROM ${table}`);
  target = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      requests.push({
        path: new URL(request.url).pathname,
        bytes: Buffer.from(await request.arrayBuffer()).toString("base64"),
        secret: request.headers.get("x-target-secret"),
      });
      return new Response("ok");
    },
  });
  targetUrl = `http://127.0.0.1:${target.port}`;
  const app = new Hono<AppEnv>()
    .use(requestIdMiddleware)
    .route("/api/tunnels", tunnelManagementRoutes)
    .route("/relay", relayRoutes)
    .route("/ingress", ingressRoutes)
    .onError(handleError);
  upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    websocket,
    fetch: async (request, server) => {
      const response = await app.fetch(request, server);
      if (request.method === "POST" && request.url.endsWith("/config-sync")) {
        onPush();
        if (dropPush) return new Response("response lost after commit", { status: 503 });
        if (rejectPush)
          return Response.json({ code: "VALIDATION_ERROR", requestId: "x" }, { status: 422 });
      }
      return response;
    },
  });
  baseUrl = `http://127.0.0.1:${upstream.port}`;
  db.insert(tunnels)
    .values([
      { id: "t", slug: "sync", name: "Sync" },
      { id: "other", slug: "other", name: "Other" },
    ])
    .run();
  db.insert(collections)
    .values([
      { id: "c", tunnelId: "t", slug: "c" },
      { id: "foreign", tunnelId: "other", slug: "foreign" },
    ])
    .run();
  db.insert(endpoints).values({ id: "e", collectionId: "c", pathName: "hook" }).run();
  for (const [types, key] of [
    ["outbound", "relay-key"],
    ["inbound", "provider-key"],
  ] as const) {
    if (!types || !key) throw new Error("Invalid fixture key");
    db.insert(apiKeys)
      .values({
        tunnelId: "t",
        types,
        name: "Local agent",
        keyHash: createHash("sha256").update(key).digest("hex"),
        keyPrefix: "test",
      })
      .run();
  }
  relayApiKey(scope(), "relay-key");
  saveRelaySession({ ...scope(), tunnelId: "alias", enabled: true });
});

afterEach(async () => {
  await manager.shutdown();
  relayService.closeAll("test complete");
  await upstream.stop(true);
  await target.stop(true);
  localDb.run("DROP TRIGGER IF EXISTS reject_config");
});

test("automatic backup, offline create/edit/replay, restart and bidirectional reconnect keep secrets local", async () => {
  manager.restoreConnections();
  await until(() => configState(scope())?.lastSyncedAt != null);
  // Replicated endpoints are routing only; the destination is set on this agent.
  expect(getConfig(scope(), "endpoint", "e")?.value).not.toHaveProperty("localTarget");
  setEndpointTarget(scope(), "e", `${targetUrl}/original`);
  setEndpointSecret(scope(), "e", "local-secret-only", "x-target-secret");
  const bytes = Buffer.from([0, 255, 13, 10, 128]);
  expect(
    (
      await fetch(`${baseUrl}/ingress/sync/c`, {
        method: "POST",
        headers: { "x-api-key": "provider-key" },
        body: bytes,
      })
    ).status,
  ).toBe(200);
  await until(() => db.select().from(webhookDeliveries).get()?.relayStatus === "SUCCESS");
  const source = db.select().from(webhookDeliveries).get();
  if (!source) throw new Error("Missing delivery");
  await manager.shutdown();
  // No transport exists: local API edits and replay still complete against the local DB.
  const edited = await configRoutes.request("/tunnels/alias/collections/c/endpoints/e", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ localTarget: `${targetUrl}/offline` }),
  });
  expect(edited.status).toBe(200);
  const collection = createCollection(scope(), { slug: "offline", isActive: true });
  const endpoint = createEndpoint(scope(), collection.id, {
    pathName: "/new",
    localTarget: `${targetUrl}/new`,
    isActive: true,
    isPaused: false,
  });
  const replay = await manager.replayLocal(source.id);
  expect(requests.at(-1)).toEqual({
    path: "/offline",
    bytes: bytes.toString("base64"),
    secret: "local-secret-only",
  });
  expect(getRelayPackage(scope(), source.id)?.result?.targetUrl).toBe(`${targetUrl}/original`);
  expect(getRelayPackage(scope(), replay.id)?.result?.targetUrl).toBe(`${targetUrl}/offline`);
  expect(db.select().from(webhookDeliveries).all()).toHaveLength(1);
  // Recreate manager to prove the database, not runtime maps, owns edits and ACKs.
  db.insert(collections).values({ id: "remote-new", tunnelId: "t", slug: "remote" }).run();
  manager = new AgentTunnelManager();
  manager.restoreConnections();
  await until(
    () =>
      pendingConfig(scope(), "endpoint").length === 0 &&
      getConfig(scope(), "collection", "remote-new") !== null,
  );
  await until(() => db.select().from(webhookDeliveries).all().length === 2);
  expect(db.select().from(endpoints).where(eq(endpoints.id, endpoint.id)).get()?.collectionId).toBe(
    collection.id,
  );
  // The server never learns any target URL, before or after sync.
  expect(JSON.stringify(db.select().from(endpoints).all())).not.toContain(targetUrl);
  expect(
    db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, replay.id)).get()
      ?.replayOfDeliveryId,
  ).toBe(source.id);
  const audits = db.select().from(audit_logs).all();
  expect(audits.length).toBeGreaterThan(0);
  expect(
    audits.every(
      (row) =>
        row.details?.includes('"keyName":"Local agent"') &&
        row.details.includes('"ip":"127.0.0.1"'),
    ),
  ).toBe(true);
  expect(JSON.stringify(audits)).not.toContain("local-secret-only");
  // Online polling discovers remote edits without any new webhook or reconnect.
  db.update(collections)
    .set({ slug: "remote-changed" })
    .where(eq(collections.id, "remote-new"))
    .run();
  await until(
    () =>
      getConfig(scope(), "collection", "remote-new")?.value.kind === "collection" &&
      JSON.stringify(getConfig(scope(), "collection", "remote-new")?.value).includes(
        "remote-changed",
      ),
  );
}, 12_000);

test("a held delivery released by one target+secret edit carries the secret on its first call", async () => {
  manager.restoreConnections();
  await until(() => configState(scope())?.lastSyncedAt != null);
  // 1. No local target yet: the receipt commits and ACKs, but the target is never called.
  const ingress = await fetch(`${baseUrl}/ingress/sync/c`, {
    method: "POST",
    headers: { "x-api-key": "provider-key" },
    body: "held until configured",
  });
  expect(ingress.status).toBe(200);
  await until(() => db.select().from(webhookDeliveries).get()?.status === "DELIVERED");
  await manager.drainTunnel("alias");
  expect(requests).toHaveLength(0);
  // 2. Target and secret commit in one request, so no drain can see the target alone.
  const edited = await configRoutes.request("/tunnels/alias/collections/c/endpoints/e", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      localTarget: `${targetUrl}/held`,
      secret: { headerName: "x-target-secret", secret: "held-secret" },
    }),
  });
  expect(edited.status).toBe(200);
  expect(await edited.text()).not.toContain("held-secret");
  await manager.drainTunnel("alias");
  expect(requests).toEqual([
    {
      path: "/held",
      bytes: Buffer.from("held until configured").toString("base64"),
      secret: "held-secret",
    },
  ]);
  // 3. The secret stays local: never queued for config sync or stored by the server.
  expect(JSON.stringify(pendingConfig(scope(), "endpoint"))).not.toContain("held-secret");
  expect(JSON.stringify(db.select().from(endpoints).all())).not.toContain("held-secret");
  // 4. `secret: null` clears it; a create can carry target and secret together too.
  await configRoutes.request("/tunnels/alias/collections/c/endpoints/e", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret: null }),
  });
  expect(getEndpointSecret(scope(), "e")).toBeNull();
  const created = await configRoutes.request("/tunnels/alias/collections/c/endpoints", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pathName: "/together",
      localTarget: `${targetUrl}/together`,
      secret: { secret: "created-secret" },
    }),
  });
  expect(created.status).toBe(201);
  const { id } = z.object({ data: z.object({ id: z.string() }) }).parse(await created.json()).data;
  expect(getEndpointSecret(scope(), id)).toEqual({
    headerName: "authorization",
    secret: "created-secret",
  });
});

test("pending live packages use the current local target and wait for local availability", async () => {
  await sync();
  updateEndpoint(scope(), "c", "e", { localTarget: `${targetUrl}/local`, isPaused: true });
  const packet = RelayPackageSchema.parse({
    id: crypto.randomUUID(),
    eventId: crypto.randomUUID(),
    endpointId: "e",
    tunnelId: "t",
    trigger: "live",
    replayOfDeliveryId: null,
    relayStatus: null,
    method: "POST",
    contentType: "application/octet-stream",
    payloadBase64: Buffer.from("offline backlog").toString("base64"),
    headers: "{}",
    queryParams: "{}",
    rawQuery: null,
    localTarget: `${targetUrl}/stale-server-target`,
    eventReceivedAt: new Date().toISOString(),
  });
  receiveRelayPackage(scope(), packet, "default");
  // A server-sent target is ignored entirely.
  expect(JSON.stringify(getRelayPackage(scope(), packet.id)?.packet)).not.toContain(
    "stale-server-target",
  );
  expect(nextRelayPackage(scope())).toBeUndefined();

  updateEndpoint(scope(), "c", "e", { isPaused: false });
  expect(nextRelayPackage(scope())).toBe(packet.id);
  // Without a local target the package waits instead of blocking the queue.
  updateEndpoint(scope(), "c", "e", { localTarget: null });
  expect(nextRelayPackage(scope())).toBeUndefined();
  updateEndpoint(scope(), "c", "e", { localTarget: `${targetUrl}/local` });
  expect(nextRelayPackage(scope())).toBe(packet.id);
  updateCollection(scope(), "c", { isActive: false });
  expect(nextRelayPackage(scope())).toBeUndefined();
  updateCollection(scope(), "c", { isActive: true });
  expect(nextRelayPackage(scope())).toBe(packet.id);
  db.update(endpoints)
    .set({ deletedAt: new Date(), isActive: false })
    .where(eq(endpoints.id, "e"))
    .run();
  await sync();
  expect(getConfig(scope(), "endpoint", "e")?.hasConflict).toBe(true);
  resolveConfig(scope(), "endpoint", "e", "server");
  // A server deletion prevents future dispatch but cannot revoke this accepted receipt.
  expect(nextRelayPackage(scope())).toBe(packet.id);
});

test("conflicts keep both versions, allow explicit choices, and prevent deleted IDs from resurrecting", async () => {
  await sync();
  updateCollection(scope(), "c", { slug: "local" });
  db.update(collections).set({ slug: "remote" }).where(eq(collections.id, "c")).run();
  await sync();
  expect(getConfig(scope(), "collection", "c")).toMatchObject({
    hasConflict: true,
    dirty: true,
    value: { slug: "local" },
    remote: { slug: "remote" },
  });
  expect(pendingConfig(scope(), "collection")).toHaveLength(0);
  resolveConfig(scope(), "collection", "c", "local");
  await sync();
  expect(db.select().from(collections).where(eq(collections.id, "c")).get()?.slug).toBe("local");
  updateEndpoint(scope(), "c", "e", { pathName: "local-path", localTarget: `${targetUrl}/local` });
  db.update(endpoints).set({ pathName: "remote-path" }).where(eq(endpoints.id, "e")).run();
  await sync();
  expect(getConfig(scope(), "endpoint", "e")?.hasConflict).toBe(true);
  expect(
    (
      await configRoutes.request("/tunnels/alias/config/endpoint/e/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ choice: "server" }),
      })
    ).status,
  ).toBe(200);
  expect(getConfig(scope(), "endpoint", "e")).toMatchObject({
    dirty: false,
    value: { pathName: "remote-path" },
  });
  // Choosing the server's routing never touches the agent-owned target.
  expect(getEndpointTarget(scope(), "e")).toBe(`${targetUrl}/local`);
  updateCollection(scope(), "c", { slug: "retained-local" });
  const orphan = createEndpoint(scope(), "c", {
    pathName: "unsynced",
    localTarget: `${targetUrl}/unsynced`,
    isActive: true,
    isPaused: false,
  });
  deleteCollection("t", "c");
  await sync();
  expect(getConfig(scope(), "collection", "c")).toMatchObject({
    hasConflict: true,
    remote: { deleted: true },
  });
  expect(getConfig(scope(), "endpoint", "e")?.value.deleted).toBe(true);
  expect(() => resolveConfig(scope(), "collection", "c", "local")).toThrow();
  resolveConfig(scope(), "collection", "c", "server");
  expect(getConfig(scope(), "collection", "c")?.value.deleted).toBe(true);
  await sync();
  expect(getConfig(scope(), "endpoint", orphan.id)?.hasConflict).toBe(true);
  expect(() => resolveConfig(scope(), "endpoint", orphan.id, "local")).toThrow();
  resolveConfig(scope(), "endpoint", orphan.id, "server");
  expect(getConfig(scope(), "endpoint", orphan.id)).toBeNull();
});

test("lost responses retry idempotently and edits made during a push remain pending", async () => {
  await sync();
  const collection = createCollection(scope(), { slug: "new", isActive: true });
  dropPush = true;
  await expect(sync()).rejects.toThrow();
  expect(getConfig(scope(), "collection", collection.id)?.dirty).toBe(true);
  dropPush = false;
  await sync();
  expect(db.select().from(collections).where(eq(collections.id, collection.id)).all()).toHaveLength(
    1,
  );
  expect(getConfig(scope(), "collection", collection.id)?.dirty).toBe(false);
  updateCollection(scope(), "c", { slug: "first" });
  onPush = () => {
    updateCollection(scope(), "c", { slug: "second" });
    onPush = () => {};
  };
  await sync();
  expect(getConfig(scope(), "collection", "c")).toMatchObject({
    dirty: true,
    value: { slug: "second" },
    baseline: { slug: "first" },
  });
  await sync();
  expect(db.select().from(collections).where(eq(collections.id, "c")).get()?.slug).toBe("second");
  expect(getConfig(scope(), "collection", "c")?.dirty).toBe(false);
});

test("pagination, reserved slugs, local validation, scope isolation and auth protect sync", async () => {
  for (let i = 0; i < 105; i++)
    db.insert(collections)
      .values({ id: `page-${String(i).padStart(3, "0")}`, tunnelId: "t", slug: `page-${i}` })
      .run();
  await sync();
  expect(getConfig(scope(), "collection", "page-104")).not.toBeNull();
  expect(getConfig(scope(), "collection", "foreign")).toBeNull();
  expect(() => bindConfigScope(scope(), "replacement")).toThrow();
  const duplicate = createCollection(scope(), { slug: "c", isActive: true });
  const child = createEndpoint(scope(), duplicate.id, {
    pathName: "child",
    localTarget: `${targetUrl}/child`,
    isActive: true,
    isPaused: false,
  });
  await sync();
  expect(getConfig(scope(), "collection", duplicate.id)?.hasConflict).toBe(true);
  expect(getConfig(scope(), "endpoint", child.id)).toMatchObject({
    dirty: true,
    hasConflict: false,
  });
  updateCollection(scope(), duplicate.id, { slug: "resolved-parent" });
  resolveConfig(scope(), "collection", duplicate.id, "local");
  await sync();
  expect(getConfig(scope(), "endpoint", child.id)?.dirty).toBe(false);
  expect(db.select().from(endpoints).where(eq(endpoints.id, child.id)).get()?.collectionId).toBe(
    duplicate.id,
  );
  // Existing null-slug collections remain editable without inventing a slug during sync.
  db.insert(collections).values({ id: "legacy-null", tunnelId: "t" }).run();
  await sync();
  updateCollection(scope(), "legacy-null", { isActive: false });
  await sync();
  expect(
    db.select().from(collections).where(eq(collections.id, "legacy-null")).get(),
  ).toMatchObject({ slug: null, isActive: false });
  const value = ConfigCollectionSchema.parse({
    kind: "collection",
    id: "foreign",
    slug: "attack",
    isActive: true,
    deleted: false,
  });
  for (const [key, tunnel] of [
    ["relay-key", "t"],
    ["relay-key", "other"],
    ["provider-key", "t"],
  ]) {
    const response = await fetch(`${baseUrl}/api/tunnels/${tunnel}/config-sync`, {
      method: "POST",
      headers: { "x-api-key": String(key), "content-type": "application/json" },
      body: JSON.stringify({ base: null, value }),
    });
    expect(response.status).toBe(403);
  }
  expect(
    (
      await configRoutes.request("/tunnels/alias/collections/c/endpoints/e", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: "never-sync-this" }),
      })
    ).status,
  ).toBe(400);
  const listed = await configRoutes.request("/tunnels/alias/config?kind=collection&limit=2");
  const page = z
    .object({ data: z.object({ items: z.array(z.unknown()), nextCursor: z.string() }) })
    .parse(await listed.json());
  expect(page.data.items).toHaveLength(2);
  localDb.run(
    "CREATE TRIGGER reject_config BEFORE INSERT ON local_config BEGIN SELECT RAISE(ABORT, 'storage failure'); END",
  );
  expect(() => createCollection(scope(), { slug: "not-saved", isActive: true })).toThrow();
  expect(
    (
      await configRoutes.request("/tunnels/alias/collections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "not-saved" }),
      })
    ).status,
  ).toBe(500);
});

test("server detects changes since conflict choice and local pull does not overwrite an in-flight edit", async () => {
  await sync();
  const base = getConfig(scope(), "collection", "c")?.value;
  if (!base) throw new Error("Missing config");
  updateCollection(scope(), "c", { slug: "pending" });
  acceptRemoteConfig(scope(), base);
  expect(getConfig(scope(), "collection", "c")?.hasConflict).toBe(false);
  db.update(collections).set({ slug: "changed-again" }).where(eq(collections.id, "c")).run();
  const response = await fetch(`${baseUrl}/api/tunnels/t/config-sync`, {
    method: "POST",
    headers: { "x-api-key": "relay-key", "content-type": "application/json" },
    body: JSON.stringify({ base, value: ConfigDocumentSchema.parse({ ...base, slug: "pending" }) }),
  });
  const result = z.object({ data: ConfigMutationResultSchema }).parse(await response.json());
  expect(result.data.status).toBe("conflict");
  expect(result.data.current).toMatchObject({ slug: "changed-again" });
});

test("a rejected push becomes a visible per-record conflict and never blocks the pull", async () => {
  await sync();
  const rejected = createCollection(scope(), { slug: "rejected", isActive: true });
  db.update(collections).set({ slug: "renamed-on-server" }).where(eq(collections.id, "c")).run();
  rejectPush = true;
  await sync();
  expect(getConfig(scope(), "collection", rejected.id)?.hasConflict).toBe(true);
  expect(JSON.stringify(getConfig(scope(), "collection", "c")?.value)).toContain(
    "renamed-on-server",
  );
  expect(configState(scope())?.error).toBeNull();
});
