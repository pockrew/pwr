import { createHash } from "node:crypto";
import type { IWsConnection } from "@server/modules/relays/service";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { RELAY_CLOSE_TUNNEL_IN_USE } from "@pockrew/pwr-shared/schemas";

process.env["BETTER_AUTH_SECRET"] = "ingress-hardening-test-secret-long-enough";
process.env["ADMIN_EMAIL"] = "ingress-hardening@example.com";
process.env["ADMIN_PASSWORD"] = "ingress-hardening-password";
const { app } = await import("@server/app");
const { db, sqliteClient } = await import("@server/db/client");
const { apiKeys, collections, endpoints, tunnels, webhookDeliveries, webhookEvents, audit_logs } =
  await import("@server/db/schemas");
const { relayService } = await import("@server/modules/relays/service");
const { recoverIngressEvents } = await import("@server/modules/ingress/events");
const { runServerRetention } = await import("@server/modules/retention/service");
const { env } = await import("@server/platform/env");

const key = "hardening-provider-key";
const DAY = 86_400_000;

const post = (path: string, headers: Record<string, string> = {}, body = "{}") =>
  app.request(`/ingress/hardening/${path}`, {
    method: "POST",
    headers: { "x-api-key": key, "content-type": "application/json", ...headers },
    body,
  });

/** Minimal socket double recording frames and close codes. */
const socket = () => {
  const closes: number[] = [];
  const ws: IWsConnection = {
    data: {},
    readyState: 1,
    getBufferedAmount: () => 0,
    send: () => 1,
    close: (code) => {
      closes.push(code ?? 0);
    },
  };
  return { ws, closes };
};

beforeEach(() => {
  relayService.closeAll("reset");
  for (const table of [webhookDeliveries, webhookEvents, apiKeys, endpoints, collections, tunnels])
    db.delete(table).run();
  db.insert(tunnels).values({ id: "ht", slug: "hardening", name: "Hardening" }).run();
  db.insert(collections).values({ id: "hc", tunnelId: "ht" }).run();
  db.insert(endpoints).values({ id: "he", collectionId: "hc", pathName: "hook" }).run();
  db.insert(apiKeys)
    .values({
      tunnelId: "ht",
      types: "inbound",
      name: "provider",
      keyPrefix: "test",
      keyHash: createHash("sha256").update(key).digest("hex"),
    })
    .run();
});

afterEach(() => {
  sqliteClient.run("DROP TRIGGER IF EXISTS reject_one_event");
  relayService.closeAll("test complete");
});

test("unauthenticated requests never consume the tunnel's daily quota", async () => {
  for (let i = 0; i < 20; i += 1)
    expect((await post("hc", { "x-api-key": "wrong-key" })).status).toBe(403);
  const ok = await post("hc");
  expect(ok.status).toBe(200);
  // Only the one authenticated request was charged.
  expect(ok.headers.get("x-quota-daily-remaining")).toBe(String(env.TUNNEL_DAILY_QUOTA - 1));
});

test("provider retries dedupe by delivery ID within one ingress selector", async () => {
  const headers = { "x-github-delivery": "gh-delivery-1" };
  const eventId = async (response: Response) =>
    z.object({ data: z.object({ id: z.string() }) }).parse(await response.json()).data.id;
  const first = await eventId(await post("hc", headers));
  const retry = await eventId(await post("hc", headers));
  expect(retry).toBe(first);
  expect(db.select().from(webhookEvents).all()).toHaveLength(1);
  // The same provider ID sent to another selector (e.g. Stripe fan-out) is a separate event.
  expect((await post("target/hook", headers)).status).toBe(200);
  expect(db.select().from(webhookEvents).all()).toHaveLength(2);
  // Stripe carries its event ID in the body.
  const stripe = { "stripe-signature": "t=1,v1=x" };
  expect((await post("hc", { ...stripe, "x-api-key": key }, '{"id":"evt_1"}')).status).toBe(200);
  expect((await post("hc", { ...stripe, "x-api-key": key }, '{"id":"evt_1"}')).status).toBe(200);
  expect(db.select().from(webhookEvents).all()).toHaveLength(3);
});

test("one active agent per tunnel: a second agent is rejected unless it takes over", () => {
  const a = socket();
  relayService.register("ht", a.ws, { agentId: "agent-a" });
  const b = socket();
  relayService.register("ht", b.ws, { agentId: "agent-b" });
  expect(b.closes).toEqual([RELAY_CLOSE_TUNNEL_IN_USE]);
  expect(a.closes).toEqual([]);
  // The same agent reconnecting over a half-open socket replaces itself.
  const a2 = socket();
  relayService.register("ht", a2.ws, { agentId: "agent-a" });
  expect(a.closes).toEqual([1000]);
  // An explicit takeover replaces a different agent, which is told the tunnel is in use so it
  // stops reconnecting instead of taking it back.
  const c = socket();
  relayService.register("ht", c.ws, { agentId: "agent-c", takeover: true });
  expect(a2.closes).toEqual([RELAY_CLOSE_TUNNEL_IN_USE]);
  expect(c.closes).toEqual([]);
});

test("a failing event is backed off and cannot block the events behind it", async () => {
  expect((await post("hc", {}, '{"n":1}')).status).toBe(200);
  expect((await post("hc", {}, '{"n":2}')).status).toBe(200);
  await Bun.sleep(0);
  const [poison, healthy] = db.select().from(webhookEvents).orderBy(webhookEvents.receivedAt).all();
  if (!poison || !healthy) throw new Error("Missing fixtures");
  // Reset both to unprepared, then make preparation of the first one fail.
  db.delete(webhookDeliveries).run();
  db.update(webhookEvents).set({ deliveryPreparedAt: null }).run();
  sqliteClient.run(
    `CREATE TRIGGER reject_one_event BEFORE INSERT ON webhook_deliveries WHEN NEW.event_id = '${poison.id}' BEGIN SELECT RAISE(ABORT, 'poison'); END`,
  );
  recoverIngressEvents();
  await Bun.sleep(10);
  const rows = db.select().from(webhookEvents).all();
  const failed = rows.find((row) => row.id === poison.id);
  expect(failed?.deliveryPreparedAt).toBeNull();
  expect(failed?.prepareAttempts).toBe(1);
  expect(failed?.nextRetryAt).toBeGreaterThan(Date.now());
  expect(rows.find((row) => row.id === healthy.id)?.deliveryPreparedAt).not.toBeNull();
  // While backed off, recovery does not retry it.
  recoverIngressEvents();
  await Bun.sleep(10);
  expect(
    db.select().from(webhookEvents).where(eq(webhookEvents.id, poison.id)).get()?.prepareAttempts,
  ).toBe(1);
});

test("server retention prunes only settled events and old audit rows", async () => {
  expect((await post("hc", {}, '{"settled":true}')).status).toBe(200);
  expect((await post("hc", {}, '{"pending":true}')).status).toBe(200);
  await Bun.sleep(0);
  const [settled, pending] = db
    .select()
    .from(webhookEvents)
    .orderBy(webhookEvents.receivedAt)
    .all();
  if (!settled || !pending) throw new Error("Missing fixtures");
  db.update(webhookDeliveries)
    .set({ status: "DELIVERED", relayStatus: "SUCCESS" })
    .where(eq(webhookDeliveries.eventId, settled.id))
    .run();
  db.run(sql`UPDATE webhook_events SET received_at = received_at - ${(40 * DAY) / 1000}`);
  db.insert(audit_logs)
    .values({
      action: "old",
      entityType: "t",
      entityId: "x",
      createdAt: new Date(Date.now() - 100 * DAY),
    })
    .run();
  const result = runServerRetention();
  expect(result).toMatchObject({ payloads: 1, events: 1, audit: 1 });
  const remaining = db.select().from(webhookEvents).all();
  expect(remaining.map((row) => row.id)).toEqual([pending.id]);
  // Pending work keeps its payload no matter how old.
  expect(remaining[0]?.payload).not.toBeNull();
});

test("retention prunes never-sendable deliveries of a deleted endpoint, not paused or received work", async () => {
  db.insert(endpoints).values({ id: "paused", collectionId: "hc", pathName: "hook" }).run();
  db.insert(endpoints).values({ id: "later", collectionId: "hc", pathName: "hook" }).run();
  expect((await post("hc", {}, '{"old":true}')).status).toBe(200);
  await Bun.sleep(0);
  expect(db.select().from(webhookDeliveries).all()).toHaveLength(3);
  db.run(sql`UPDATE webhook_events SET received_at = received_at - ${(40 * DAY) / 1000}`);
  // 1. A paused endpoint's delivery can still be sent later: the event stays.
  db.update(endpoints).set({ isPaused: true }).where(eq(endpoints.id, "paused")).run();
  db.update(endpoints)
    .set({ isActive: false, deletedAt: new Date() })
    .where(sql`${endpoints.id} IN ('he', 'later')`)
    .run();
  expect(runServerRetention()).toMatchObject({ payloads: 0, events: 0 });
  // 2. A received delivery may still report its result after its endpoint is deleted.
  db.update(endpoints).set({ isActive: false, deletedAt: new Date() }).run();
  db.update(webhookDeliveries)
    .set({ status: "DELIVERED" })
    .where(eq(webhookDeliveries.endpointId, "later"))
    .run();
  expect(runServerRetention()).toMatchObject({ payloads: 0, events: 0 });
  // 3. Once only never-sent deliveries of deleted endpoints remain, the event is prunable.
  db.update(webhookDeliveries)
    .set({ relayStatus: "SUCCESS" })
    .where(eq(webhookDeliveries.endpointId, "later"))
    .run();
  expect(runServerRetention()).toMatchObject({ payloads: 1, events: 1 });
  expect(db.select().from(webhookEvents).all()).toHaveLength(0);
});
