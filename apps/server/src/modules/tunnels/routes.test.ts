import { createHash } from "node:crypto";
import type { IWsConnection } from "@server/modules/relays/service";
import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { ZodType } from "zod";

import {
  ApiErrorResponseSchema,
  ApiSuccessResponseSchema,
  ManagedCollectionPageSchema,
  ManagedCollectionSchema,
  ManagedEndpointPageSchema,
  ManagedEndpointSchema,
  RelayServerMessageSchema,
  type RelayClientAck,
} from "@pockrew/pwr-shared/schemas";

// Exercise the mounted production routes against migrations in an isolated in-memory DB.
process.env["BETTER_AUTH_SECRET"] = "management-test-secret-at-least-32-characters";
process.env["ADMIN_EMAIL"] = "management-test@example.com";
process.env["ADMIN_PASSWORD"] = "management-test-password";
const { app } = await import("@server/app");
const { db, sqliteClient } = await import("@server/db/client");
const { tunnels, collections, endpoints, apiKeys, webhookEvents, webhookDeliveries } =
  await import("@server/db/schemas");
const { relayService } = await import("@server/modules/relays/service");
const { env } = await import("@server/platform/env");
const keyId = crypto.randomUUID();
const token = `${keyId}.${Buffer.alloc(32, 1).toString("base64url")}`;
const otherKeyId = crypto.randomUUID();
const otherToken = `${otherKeyId}.${Buffer.alloc(32, 2).toString("base64url")}`;
let keyHash = "";
let otherHash = "";

beforeAll(async () => {
  keyHash = await Bun.password.hash(token, {
    algorithm: "argon2id",
    memoryCost: 4096,
    timeCost: 1,
  });
  otherHash = await Bun.password.hash(otherToken, {
    algorithm: "argon2id",
    memoryCost: 4096,
    timeCost: 1,
  });
});
beforeEach(() => {
  relayService.closeAll("reset management fixture");
  for (const table of [webhookDeliveries, webhookEvents, apiKeys, endpoints, collections, tunnels])
    db.delete(table).run();
  db.insert(tunnels)
    .values([
      { id: "t", slug: "management", name: "Management" },
      { id: "other", slug: "other", name: "Other" },
    ])
    .run();
  db.insert(apiKeys)
    .values([
      {
        id: keyId,
        tunnelId: "t",
        types: "admin",
        permissions: ["collections", "endpoints"],
        name: "CLI",
        keyPrefix: "test",
        keyHash,
      },
      {
        id: otherKeyId,
        tunnelId: "other",
        types: "admin",
        permissions: ["collections", "endpoints"],
        name: "Other CLI",
        keyPrefix: "other",
        keyHash: otherHash,
      },
      {
        tunnelId: "t",
        types: "inbound",
        name: "Provider",
        keyPrefix: "provider",
        keyHash: createHash("sha256").update("provider-key").digest("hex"),
      },
    ])
    .run();
});
afterEach(() => relayService.closeAll("management test complete"));

const request = (path: string, method = "GET", body?: unknown, credential = token) =>
  app.request(`/api/tunnels/${path}`, {
    method,
    headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const success = async <T>(
  response: Response | Promise<Response>,
  schema: ZodType<T>,
  status = 200,
) => {
  const res = await response;
  expect(res.status).toBe(status);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  return ApiSuccessResponseSchema(schema).parse(await res.json()).data;
};
const rejected = async (response: Response | Promise<Response>, status: number) => {
  const res = await response;
  expect(res.status).toBe(status);
  return ApiErrorResponseSchema.parse(await res.json());
};
const collection = (slug = "payments", tunnel = "t", credential = token) =>
  success(
    request(`${tunnel}/collections`, "POST", { slug }, credential),
    ManagedCollectionSchema,
    201,
  );
const endpoint = (collectionId: string, fields: Record<string, unknown> = {}) =>
  success(
    request(`t/collections/${collectionId}/endpoints`, "POST", {
      pathName: "/hooks/payment",
      ...fields,
    }),
    ManagedEndpointSchema,
    201,
  );
const ingress = async (path: string, body = Buffer.from([0, 255, 123, 10])) => {
  const res = await app.request(`/ingress/management/${path}?tag=a&tag=b&encoded=%2B`, {
    method: "POST",
    headers: { "x-api-key": "provider-key", "content-type": "application/octet-stream" },
    body,
  });
  expect(res.status).toBe(200);
  // The stored-event subscriber runs independently of the HTTP storage response.
  await Promise.resolve();
  return body;
};

const agent = () => {
  const frames: string[] = [];
  const ws: IWsConnection = {
    data: {},
    readyState: 1,
    getBufferedAmount: () => 0,
    send: (data) => {
      frames.push(String(data));
      return 1;
    },
    close: () => {},
  };
  relayService.register("t", ws);
  return {
    ack: (ack: RelayClientAck) => relayService.acknowledge("t", ws, JSON.stringify(ack)),
    packages: () =>
      frames.flatMap((text) => {
        const message = RelayServerMessageSchema.parse(JSON.parse(text));
        return message.type === "sync"
          ? message.deliveries
          : message.type === "webhook_event"
            ? message.events
            : [];
      }),
  };
};

test("only admin credentials manage resources, with CLI scope and complete parent ownership checks", async () => {
  await rejected(app.request("/api/tunnels/t/collections"), 403);
  await rejected(
    app.request("/api/tunnels/t/collections", { headers: { "x-api-key": "provider-key" } }),
    403,
  );
  await rejected(request("t/collections", "GET", undefined, "provider-key"), 403);
  await rejected(request("other/collections"), 403);
  await rejected(
    request(
      "t/collections",
      "GET",
      undefined,
      `${keyId}.${Buffer.alloc(32, 9).toString("base64url")}`,
    ),
    403,
  );
  const own = await collection();
  const foreign = await collection("payments", "other", otherToken);
  const child = await endpoint(own.id);
  const base = `t/collections/${foreign.id}`;
  for (const method of ["GET", "PATCH", "DELETE"]) {
    await rejected(request(base, method, method === "PATCH" ? { slug: "stolen" } : undefined), 404);
    await rejected(
      request(
        `${base}/endpoints/${child.id}`,
        method,
        method === "PATCH" ? { isPaused: true } : undefined,
      ),
      404,
    );
  }
  await rejected(request(`${base}/endpoints`, "POST", { pathName: "x" }), 404);
  await rejected(request(`${base}/endpoints`), 404);
  const sibling = await collection("sibling");
  await rejected(request(`t/collections/${sibling.id}/endpoints/${child.id}`, "DELETE"), 404);
  expect(
    (await success(request(`t/collections/${own.id}/endpoints/${child.id}`), ManagedEndpointSchema))
      .deletedAt,
  ).toBeNull();
  // An otherwise valid Argon2 token with a transport role still cannot authorize management.
  for (const types of ["inbound", "outbound"] as const) {
    db.update(apiKeys).set({ types }).where(eq(apiKeys.id, keyId)).run();
    await rejected(request("t/collections"), 403);
  }
  db.update(apiKeys)
    .set({ types: "admin", permissions: ["collections", "endpoints"], deletedAt: new Date() })
    .where(eq(apiKeys.id, keyId))
    .run();
  await rejected(request("t/collections"), 403);
});

test("CRUD is bounded, PATCH preserves flags, slug conflicts do not overwrite, secrets stay local", async () => {
  const a = await collection("first");
  const b = await collection("second");
  await rejected(request("t/collections", "POST", { slug: "first" }), 409);
  await rejected(request(`t/collections/${b.id}`, "PATCH", { slug: "first" }), 409);
  await success(
    request(`t/collections/${a.id}`, "PATCH", { isActive: false }),
    ManagedCollectionSchema,
  );
  const renamed = await success(
    request(`t/collections/${a.id}`, "PATCH", { slug: "renamed" }),
    ManagedCollectionSchema,
  );
  expect(renamed.isActive).toBe(false);
  const page1 = await success(request("t/collections?limit=1"), ManagedCollectionPageSchema);
  const page2 = await success(
    request(`t/collections?limit=1&cursor=${page1.nextCursor}`),
    ManagedCollectionPageSchema,
  );
  expect(page1.items.concat(page2.items).map((row) => row.id)).toEqual([a.id, b.id].sort());
  expect(page2.nextCursor).toBeNull();
  await rejected(request("t/collections?limit=101"), 400);
  await rejected(request("t/collections?limit=0"), 400);
  await rejected(request(`t/collections/${a.id}`, "PATCH", {}), 400);
  await rejected(request(`t/collections/${a.id}`, "PATCH", { tunnelId: "other" }), 400);
  const e1 = await endpoint(a.id, { isActive: false, isPaused: true });
  const e2 = await endpoint(a.id); // Identical paths are valid fanout destinations.
  const epPath = `t/collections/${a.id}/endpoints/${e1.id}`;
  expect(e1.pathName).toBe("hooks/payment");
  const changed = await success(
    request(epPath, "PATCH", { pathName: "hooks/renamed" }),
    ManagedEndpointSchema,
  );
  expect(changed).toMatchObject({ isActive: false, isPaused: true, pathName: "hooks/renamed" });
  const ep1 = await success(
    request(`t/collections/${a.id}/endpoints?limit=1`),
    ManagedEndpointPageSchema,
  );
  const ep2 = await success(
    request(`t/collections/${a.id}/endpoints?limit=1&cursor=${ep1.nextCursor}`),
    ManagedEndpointPageSchema,
  );
  expect(ep1.items.concat(ep2.items).map((row) => row.id)).toEqual([e1.id, e2.id].sort());
  expect(ep2.nextCursor).toBeNull();
  for (const body of [
    {},
    { secretToken: "never-server-side" },
    { collectionId: b.id },
    // Targets are agent-owned: the server rejects any attempt to set one.
    { localTarget: "http://localhost:4000/new" },
    { pathName: "a/../b" },
    { pathName: "a?x=1" },
    { pathName: "%2Fadmin" },
    { pathName: "//other" },
  ])
    await rejected(request(epPath, "PATCH", body), 400);
  for (const extra of [
    { secretToken: "local-only" },
    { id: "chosen" },
    { collectionId: b.id },
    { localTarget: "http://localhost" },
  ])
    await rejected(
      request(`t/collections/${a.id}/endpoints`, "POST", { pathName: "hook", ...extra }),
      400,
    );
  await success(request(epPath, "DELETE"), ManagedEndpointSchema);
  await rejected(request(epPath), 404);
  expect(
    (
      await success(request(`t/collections/${a.id}/endpoints`), ManagedEndpointPageSchema)
    ).items.map((row) => row.id),
  ).toEqual([e2.id]);
  await success(request(`t/collections/${a.id}`, "DELETE"), ManagedCollectionSchema);
  await rejected(request(`t/collections/${a.id}/endpoints`, "POST", { pathName: "hook" }), 404);
  await rejected(request("t/collections", "POST", { slug: "renamed" }), 409);
  expect(
    (await success(request("t/collections"), ManagedCollectionPageSchema)).items.map(
      (row) => row.id,
    ),
  ).toEqual([b.id]);
});

test("pause persists ingress; resume fans out unchanged bytes; delete retains all three ACK histories", async () => {
  const c = await collection();
  const first = await endpoint(c.id, { isPaused: true });
  const second = await endpoint(c.id, { isPaused: true });
  const body = await ingress("target/hooks/payment");
  expect(
    db
      .select()
      .from(webhookDeliveries)
      .all()
      .map((row) => row.status),
  ).toEqual(["PENDING", "PENDING"]);
  const live = agent();
  expect(live.packages()).toHaveLength(0);
  await success(
    request(`t/collections/${c.id}/endpoints/${first.id}`, "PATCH", { isPaused: false }),
    ManagedEndpointSchema,
  );
  expect(live.packages()).toHaveLength(1);
  const received = live.packages()[0];
  if (!received) throw new Error("Resume did not send the pending package");
  live.ack({ type: "ack_received", deliveryId: received.id });
  // Disabling a collection holds existing packages and excludes future events from fanout.
  await success(
    request(`t/collections/${c.id}`, "PATCH", { isActive: false }),
    ManagedCollectionSchema,
  );
  for (const target of [first, second])
    await success(
      request(`t/collections/${c.id}/endpoints/${target.id}`, "PATCH", { isPaused: false }),
      ManagedEndpointSchema,
    );
  await ingress(c.id);
  expect(db.select().from(webhookEvents).all()).toHaveLength(2);
  expect(db.select().from(webhookDeliveries).all()).toHaveLength(2);
  expect(live.packages()).toHaveLength(1);
  await success(
    request(`t/collections/${c.id}`, "PATCH", { isActive: true }),
    ManagedCollectionSchema,
  );
  expect(live.packages()).toHaveLength(2);
  for (const packet of live.packages()) {
    expect(Buffer.from(packet.payloadBase64, "base64").equals(body)).toBe(true);
    expect(packet.rawQuery).toBe("tag=a&tag=b&encoded=%2B");
  }
  // Config deletion cannot cancel packages already handed to the agent.
  await success(request(`t/collections/${c.id}`, "DELETE"), ManagedCollectionSchema);
  for (const packet of live.packages()) {
    live.ack({ type: "ack_received", deliveryId: packet.id });
    live.ack({
      type: "ack_relayed",
      deliveryId: packet.id,
      status: "SUCCESS",
      responseStatus: 204,
    });
    const replayId = crypto.randomUUID();
    live.ack({
      type: "ack_replayed",
      deliveryId: packet.id,
      replayId,
      status: "FAILED",
      responseStatus: 500,
    });
    live.ack({
      type: "ack_replayed",
      deliveryId: packet.id,
      replayId,
      status: "FAILED",
      responseStatus: 500,
    });
  }
  const history = db.select().from(webhookDeliveries).all();
  expect(history).toHaveLength(4);
  expect(
    history
      .filter((row) => row.trigger === "live")
      .every((row) => row.status === "DELIVERED" && row.relayStatus === "SUCCESS"),
  ).toBe(true);
  expect(
    history
      .filter((row) => row.trigger === "replay")
      .every((row) => row.replayOfDeliveryId && row.relayStatus === "FAILED"),
  ).toBe(true);
  expect(
    db
      .select()
      .from(endpoints)
      .all()
      .every((row) => row.deletedAt && !row.isActive),
  ).toBe(true);
  expect(
    db
      .select()
      .from(webhookEvents)
      .all()
      .every((row) => row.payload?.equals(body)),
  ).toBe(true);
  await ingress(c.id);
  expect(db.select().from(webhookEvents).all()).toHaveLength(3);
  expect(db.select().from(webhookDeliveries).all()).toHaveLength(4);
});

test("relay packages never carry a target; soft-deleted pending endpoints never dispatch", async () => {
  const c = await collection();
  const keep = await endpoint(c.id);
  const remove = await endpoint(c.id);
  await ingress(c.id);
  await success(
    request(`t/collections/${c.id}/endpoints/${remove.id}`, "DELETE"),
    ManagedEndpointSchema,
  );
  const live = agent();
  expect(live.packages()).toHaveLength(1);
  expect(live.packages()[0]).toMatchObject({ endpointId: keep.id });
  expect(live.packages()[0]).not.toHaveProperty("localTarget");
  expect(db.select().from(webhookDeliveries).all()).toHaveLength(2);
});

test("collection deletion rolls back parent and children together on storage failure", async () => {
  const c = await collection();
  await endpoint(c.id);
  sqliteClient.run(
    "CREATE TEMP TRIGGER reject_management_delete BEFORE UPDATE OF deleted_at ON endpoints BEGIN SELECT RAISE(ABORT, 'test unavailable'); END",
  );
  try {
    await rejected(request(`t/collections/${c.id}`, "DELETE"), 500);
    expect(
      (await success(request(`t/collections/${c.id}`), ManagedCollectionSchema)).deletedAt,
    ).toBeNull();
    expect(
      db
        .select()
        .from(endpoints)
        .all()
        .every((row) => row.deletedAt === null && row.isActive),
    ).toBe(true);
  } finally {
    sqliteClient.run("DROP TRIGGER reject_management_delete");
  }
});

test("configured account can manage any live tunnel; cookie writes require trusted Origin and revoked sessions fail", async () => {
  const { auth } = await import("@server/modules/auth/configs");
  const { session, user } = await import("@server/db/schemas/auth");
  await auth.api.signUpEmail({
    body: { name: "Admin", email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD ?? "" },
  });
  const login = await auth.api.signInEmail({
    body: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD ?? "" },
    asResponse: true,
  });
  expect(login.status).toBe(200);
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  expect(cookie).toContain("session_token=");
  const post = (origin?: string) =>
    app.request("/api/tunnels/other/collections", {
      method: "POST",
      headers: { cookie, "content-type": "application/json", ...(origin ? { origin } : {}) },
      body: JSON.stringify({ slug: "admin-created" }),
    });
  try {
    await rejected(post(), 403);
    await rejected(post("https://attacker.example"), 403);
    await success(post(new URL(env.PUBLIC_URL).origin), ManagedCollectionSchema, 201);
    db.update(tunnels).set({ isActive: false }).where(eq(tunnels.id, "t")).run();
    await collection("disabled-tunnel-is-manageable");
    db.update(tunnels).set({ deletedAt: new Date() }).where(eq(tunnels.id, "t")).run();
    await rejected(request("t/collections"), 403);
    await rejected(app.request("/api/tunnels/t/collections", { headers: { cookie } }), 404);
    db.delete(session).run();
    await rejected(app.request("/api/tunnels/other/collections", { headers: { cookie } }), 403);
  } finally {
    db.delete(user).where(eq(user.email, env.ADMIN_EMAIL)).run();
  }
});
