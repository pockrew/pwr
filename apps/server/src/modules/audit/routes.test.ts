import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { AppEnv } from "@server/platform/types";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z, type ZodType } from "zod";

import {
  ApiSuccessResponseSchema,
  ManagedCollectionPageSchema,
  ManagedCollectionSchema,
  ManagedEndpointPageSchema,
  ManagedEndpointSchema,
} from "@pockrew/pwr-shared/schemas";

process.env["BETTER_AUTH_SECRET"] = "relay-audit-tests-secret-at-least-32-characters";
process.env["ADMIN_EMAIL"] = "audit-test@example.com";
process.env["ADMIN_PASSWORD"] = "audit-test-password";
const { app } = await import("@server/app");
const { db, sqliteClient } = await import("@server/db/client");
const { apiKeys, tunnels, collections, endpoints, webhookDeliveries, webhookEvents, audit_logs } =
  await import("@server/db/schemas");
const { relayService } = await import("@server/modules/relays/service");
const { resolveClientIp } = await import("@server/platform/securities.middleware");
const { env } = await import("@server/platform/env");
const { adminGuard } = await import("@server/modules/auth/guard");
const { handleError } = await import("@server/platform/error.handlers");
const token = "relay-audit-key";
const keyId = crypto.randomUUID();
const keyName = "Local agent • payments";
const detailsSchema = z.strictObject({
  requestId: z.string(),
  keyId: z.string(),
  keyName: z.string(),
  ip: z.string(),
  tunnelId: z.string(),
  method: z.string(),
  path: z.string(),
  status: z.number().nullable(),
});
const peer = (address = "203.0.113.7") => ({
  requestIP: () => ({ address, port: 12345, family: "IPv4" }),
});
const call = (
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = { "x-api-key": token },
) =>
  app.request(
    `/api/tunnels${path}`,
    {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    peer(),
  );
const success = async <T>(
  result: Response | Promise<Response>,
  schema: ZodType<T>,
  status = 200,
) => {
  const res = await result;
  expect(res.status).toBe(status);
  return ApiSuccessResponseSchema(schema).parse(await res.json()).data;
};
const audits = () =>
  db
    .select()
    .from(audit_logs)
    .all()
    .map((row) => ({ ...row, details: detailsSchema.parse(JSON.parse(row.details ?? "{}")) }));

beforeEach(() => {
  relayService.closeAll("audit reset");
  for (const table of [
    audit_logs,
    webhookDeliveries,
    webhookEvents,
    apiKeys,
    endpoints,
    collections,
    tunnels,
  ])
    db.delete(table).run();
  db.insert(tunnels)
    .values([
      { id: "t", slug: "audit-relay", name: "Audit" },
      { id: "other", slug: "other", name: "Other" },
    ])
    .run();
  db.insert(collections)
    .values([
      { id: "c", tunnelId: "t", slug: "owned" },
      { id: "foreign", tunnelId: "other", slug: "foreign" },
    ])
    .run();
  db.insert(endpoints).values({ id: "e", collectionId: "c", pathName: "hook" }).run();
  db.insert(apiKeys)
    .values({
      id: keyId,
      tunnelId: "t",
      types: "outbound",
      name: keyName,
      keyPrefix: "relay",
      keyHash: createHash("sha256").update(token).digest("hex"),
      permissions: [],
    })
    .run();
});
afterEach(() => relayService.closeAll("audit complete"));

test("relay key manages all collection/endpoint routes and records the verified key name, peer and outcome", async () => {
  const collection = await success(
    call("/t/collections", "POST", { slug: "new" }),
    ManagedCollectionSchema,
    201,
  );
  const root = `/t/collections/${collection.id}`;
  await success(call("/t/collections"), ManagedCollectionPageSchema);
  await success(call(root), ManagedCollectionSchema);
  await success(call(root, "PATCH", { slug: "renamed" }), ManagedCollectionSchema);
  const target = await success(
    call(`${root}/endpoints`, "POST", { pathName: "payment" }),
    ManagedEndpointSchema,
    201,
  );
  await success(call(`${root}/endpoints`), ManagedEndpointPageSchema);
  await success(call(`${root}/endpoints/${target.id}`), ManagedEndpointSchema);
  await success(
    call(`${root}/endpoints/${target.id}`, "PATCH", { isPaused: true }),
    ManagedEndpointSchema,
  );
  await success(call(`${root}/endpoints/${target.id}`, "DELETE"), ManagedEndpointSchema);
  await success(call(root, "DELETE"), ManagedCollectionSchema);
  const rows = audits();
  expect(rows).toHaveLength(10);
  expect(new Set(rows.map((row) => row.details.requestId)).size).toBe(10);
  for (const row of rows) {
    expect(row).toMatchObject({
      action: "relay.management.request",
      entityType: "api_key",
      entityId: keyId,
    });
    expect(row.details).toMatchObject({ keyId, keyName, ip: "203.0.113.7", tunnelId: "t" });
    expect(row.details.status === 200 || row.details.status === 201).toBe(true);
  }
  db.update(apiKeys).set({ name: "Renamed later" }).where(eq(apiKeys.id, keyId)).run();
  expect(audits().every((row) => row.details.keyName === keyName)).toBe(true);
});

test("relay cannot manage tunnels/keys or escape parent ownership; authenticated denials remain audited", async () => {
  for (const [path, method, body, status] of [
    ["", "GET", undefined, 403],
    ["", "POST", { name: "Forbidden", slug: "forbidden" }, 403],
    ["/t", "PATCH", { isActive: false }, 403],
    ["/t", "DELETE", undefined, 403],
    ["/t/keys", "GET", undefined, 403],
    ["/t/keys", "POST", { types: "admin", name: "Escalation", permissions: ["keys"] }, 403],
    [`/t/keys/${keyId}`, "DELETE", undefined, 403],
    ["/other/collections", "GET", undefined, 403],
    ["/t/collections/foreign", "DELETE", undefined, 404],
    ["/t/collections/foreign/endpoints/e", "PATCH", { isPaused: true }, 404],
    ["/t/collections/c/endpoints/e", "PATCH", { secretToken: "do-not-log-body" }, 400],
  ] satisfies [string, string, unknown, number][]) {
    const response = await call(path, method, body, {
      "x-api-key": token,
      "x-forwarded-for": "10.1.2.3",
      "x-real-ip": "10.1.2.3",
    });
    expect(response.status).toBe(status);
    expect(
      audits().find((row) => row.details.requestId === response.headers.get("x-request-id"))
        ?.details.status,
    ).toBe(status);
  }
  expect(audits().every((row) => row.details.ip === "203.0.113.7")).toBe(true);
  expect(JSON.stringify(audits())).not.toContain("do-not-log-body");
  expect(db.select().from(endpoints).get()?.isPaused).toBe(false);
  expect(db.select().from(apiKeys).all()).toHaveLength(1);
});

test("inbound, invalid, revoked, disabled and mixed credentials never gain relay management or fabricated audits", async () => {
  expect((await call("/t/collections", "GET", undefined, { "x-api-key": "wrong" })).status).toBe(
    403,
  );
  expect(
    (
      await call("/t/collections", "GET", undefined, {
        "x-api-key": token,
        authorization: "Bearer wrong",
      })
    ).status,
  ).toBe(403);
  expect(
    (await call("/t/collections", "GET", undefined, { authorization: `Bearer ${token}` })).status,
  ).toBe(403);
  db.update(apiKeys).set({ types: "inbound" }).where(eq(apiKeys.id, keyId)).run();
  expect((await call("/t/collections")).status).toBe(403);
  db.update(apiKeys)
    .set({ types: "outbound", deletedAt: new Date() })
    .where(eq(apiKeys.id, keyId))
    .run();
  expect((await call("/t/collections")).status).toBe(403);
  db.update(apiKeys).set({ deletedAt: null }).where(eq(apiKeys.id, keyId)).run();
  db.update(tunnels).set({ isActive: false }).where(eq(tunnels.id, "t")).run();
  expect((await call("/t/collections")).status).toBe(403);
  db.update(tunnels)
    .set({ isActive: true, deletedAt: new Date() })
    .where(eq(tunnels.id, "t"))
    .run();
  expect((await call("/t/collections")).status).toBe(403);
  expect(audits()).toHaveLength(0);
  db.update(tunnels).set({ deletedAt: null }).where(eq(tunnels.id, "t")).run();
  const accountOnly = new Hono<AppEnv>()
    .use(adminGuard({ sessionOnly: true }))
    .get("/", (c) => c.text("allowed"))
    .onError(handleError);
  expect((await accountOnly.request("/", { headers: { "x-api-key": token } })).status).toBe(403);
});

test("audit insert failure blocks reads and writes before config can change", async () => {
  sqliteClient.run(
    "CREATE TEMP TRIGGER fail_audit_insert BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit storage unavailable'); END",
  );
  try {
    expect((await call("/t/collections/c/endpoints/e", "PATCH", { isPaused: true })).status).toBe(
      503,
    );
    expect((await call("/t/collections", "POST", { slug: "never-created" })).status).toBe(503);
    expect((await call("/t/collections")).status).toBe(503);
    expect(db.select().from(endpoints).get()?.isPaused).toBe(false);
    expect(db.select().from(collections).all()).toHaveLength(2);
    expect(audits()).toHaveLength(0);
  } finally {
    sqliteClient.run("DROP TRIGGER fail_audit_insert");
  }
});

test("failed audit outcome write retains the durable attempt and does not report a committed mutation as failed", async () => {
  sqliteClient.run(
    "CREATE TEMP TRIGGER fail_audit_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'outcome unavailable'); END",
  );
  try {
    await success(
      call("/t/collections", "POST", { slug: "committed" }),
      ManagedCollectionSchema,
      201,
    );
    expect(audits()).toHaveLength(1);
    expect(audits()[0]?.details).toMatchObject({ keyName, ip: "203.0.113.7", status: null });
    expect(db.select().from(collections).all()).toHaveLength(3);
  } finally {
    sqliteClient.run("DROP TRIGGER fail_audit_update");
  }
});

test("real HTTP audit uses the connection IP and never logs auth headers or URL query", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.port}/api/tunnels/t/collections?unexpected=query-secret`,
      {
        headers: { "x-api-key": token, "x-forwarded-for": "192.0.2.55", "x-real-ip": "192.0.2.55" },
      },
    );
    expect(response.status).toBe(400);
    await response.text();
    expect(audits()[0]?.details).toMatchObject({
      keyName,
      ip: "127.0.0.1",
      status: 400,
      path: "/api/tunnels/t/collections",
    });
    expect(JSON.stringify(audits())).not.toContain(token);
    expect(JSON.stringify(audits())).not.toContain("query-secret");
  } finally {
    await server.stop(true);
  }
});

test("client IP accepts forwarded hops only from configured socket peers", async () => {
  const probe = new Hono<AppEnv>().get("/", (c) => c.text(resolveClientIp(c)));
  const configured = env.TRUSTED_PROXIES === "192.0.2.10,192.0.2.11";
  // Run this test in both default mode and with the documented two-proxy fixture.
  for (const [address, headers, expected] of [
    ["203.0.113.7", { "x-forwarded-for": "6.6.6.6", "x-real-ip": "192.0.2.10" }, "203.0.113.7"],
    [
      "192.0.2.10",
      { "x-forwarded-for": "6.6.6.6, 203.0.113.9, 192.0.2.11" },
      configured ? "203.0.113.9" : "192.0.2.10",
    ],
    ["192.0.2.10", { "x-real-ip": "203.0.113.9" }, configured ? "203.0.113.9" : "192.0.2.10"],
    ["192.0.2.10", { "x-forwarded-for": "not-an-ip" }, "192.0.2.10"],
  ] satisfies [string, Record<string, string>, string][]) {
    expect(await (await probe.request("/", { headers }, peer(address))).text()).toBe(expected);
  }
  expect(
    await (await probe.request("/", { headers: { "x-forwarded-for": "6.6.6.6" } })).text(),
  ).toBe("unknown");
});

test("relay key can only read audit of its own tunnel and is blocked from other tunnels", async () => {
  // 1. Seed audit records for tunnel 't' and tunnel 'other'
  db.insert(audit_logs)
    .values([
      {
        id: crypto.randomUUID(),
        action: "ingress.hmac_failed",
        entityType: "tunnel",
        entityId: "t",
        details: JSON.stringify({ tunnelId: "t", reason: "bad_sig" }),
      },
      {
        id: crypto.randomUUID(),
        action: "relay.management.request",
        entityType: "api_key",
        entityId: keyId,
        details: JSON.stringify({ tunnelId: "t", keyId, keyName }),
      },
      {
        id: crypto.randomUUID(),
        action: "ingress.hmac_failed",
        entityType: "tunnel",
        entityId: "other",
        details: JSON.stringify({ tunnelId: "other", reason: "foreign_sig" }),
      },
    ])
    .run();

  // 2. Relay key for tunnel 't' calling GET /api/audit is scoped to tunnel 't'
  const resDefault = await app.request("/api/audit", {
    method: "GET",
    headers: { "x-api-key": token },
  });
  expect(resDefault.status).toBe(200);
  const dataDefault = (await resDefault.json()) as {
    data: { items: { entityId: string; details: { tunnelId?: string } }[] };
  };
  expect(dataDefault.data.items.length).toBeGreaterThan(0);
  for (const item of dataDefault.data.items) {
    const isOwned =
      item.entityId === "t" || item.entityId === keyId || item.details.tunnelId === "t";
    expect(isOwned).toBe(true);
    expect(item.entityId).not.toBe("other");
    expect(item.details.tunnelId).not.toBe("other");
  }

  // 3. Relay key for tunnel 't' querying ?tunnelId=other must be rejected with 403
  const resForbidden = await app.request("/api/audit?tunnelId=other", {
    method: "GET",
    headers: { "x-api-key": token },
  });
  expect(resForbidden.status).toBe(403);

  // 4. Relay key for tunnel 't' querying ?tunnelId=t succeeds
  const resOwned = await app.request("/api/audit?tunnelId=t", {
    method: "GET",
    headers: { "x-api-key": token },
  });
  expect(resOwned.status).toBe(200);
  const dataOwned = (await resOwned.json()) as {
    data: { items: { entityId: string; details: { tunnelId?: string } }[] };
  };
  expect(dataOwned.data.items.length).toBeGreaterThan(0);
  for (const item of dataOwned.data.items) {
    expect(item.entityId).not.toBe("other");
    expect(item.details.tunnelId).not.toBe("other");
  }
});
