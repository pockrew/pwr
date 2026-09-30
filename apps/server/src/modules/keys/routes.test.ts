import { createHash } from "node:crypto";
import type { IWsConnection } from "@server/modules/relays/service";
import { afterAll, afterEach, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { ZodType } from "zod";

import {
  ApiSuccessResponseSchema,
  GeneratedKeySchema,
  ManagedKeyPageSchema,
  ManagedKeySchema,
  ManagedTunnelPageSchema,
  ManagedTunnelSchema,
  ManagementPermissionSchema,
} from "@pockrew/pwr-shared/schemas";

process.env["BETTER_AUTH_SECRET"] = "key-generation-tests-secret-at-least-32-characters";
process.env["ADMIN_EMAIL"] = "keys-test@example.com";
process.env["ADMIN_PASSWORD"] = "keys-test-password";
const { app } = await import("@server/app");
const { websocket } = await import("@server/modules/relays/routes");
const { db } = await import("@server/db/client");
const { tunnels, collections, endpoints, apiKeys, webhookEvents, webhookDeliveries } =
  await import("@server/db/schemas");
const { user } = await import("@server/db/schemas/auth");
const { env } = await import("@server/platform/env");
const { auth } = await import("@server/modules/auth/configs");
const { relayService } = await import("@server/modules/relays/service");
let cookie = "";

beforeAll(async () => {
  await auth.api.signUpEmail({
    body: { name: "Admin", email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD ?? "" },
  });
  const res = await auth.api.signInEmail({
    body: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD ?? "" },
    asResponse: true,
  });
  expect(res.status).toBe(200);
  cookie = res.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
});
beforeEach(() => {
  relayService.closeAll("reset keys test");
  for (const table of [webhookDeliveries, webhookEvents, apiKeys, endpoints, collections, tunnels])
    db.delete(table).run();
  db.insert(tunnels)
    .values([
      { id: "t", slug: "keys-test", name: "Keys" },
      { id: "other", slug: "other", name: "Other" },
    ])
    .run();
  db.insert(collections).values({ id: "c", tunnelId: "t", slug: "collection" }).run();
  db.insert(endpoints).values({ id: "e", collectionId: "c", pathName: "hook" }).run();
});
afterEach(() => relayService.closeAll("keys test complete"));
afterAll(() => db.delete(user).where(eq(user.email, env.ADMIN_EMAIL)).run());

const call = (path = "", method = "GET", body?: unknown, token?: string) =>
  app.request(`/api/tunnels${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token === undefined
        ? { cookie, origin: new URL(env.PUBLIC_URL).origin }
        : { authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const success = async <T>(
  response: Promise<Response> | Response,
  schema: ZodType<T>,
  status = 200,
) => {
  const res = await response;
  expect(res.status).toBe(status);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  return ApiSuccessResponseSchema(schema).parse(await res.json()).data;
};
const generate = (
  types: "inbound" | "outbound" | "admin",
  permissions = ManagementPermissionSchema.options,
  tunnelId = "t",
  token?: string,
) =>
  success(
    call(
      `/${tunnelId}/keys`,
      "POST",
      { types, name: "Test", ...(types === "admin" ? { permissions } : {}) },
      token,
    ),
    GeneratedKeySchema,
    201,
  );
const connect = (url: string, token: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { "x-api-key": token } });
    ws.onerror = () => reject(new Error("Socket failed to authenticate"));
    ws.onmessage = () => resolve(ws); // Wait for the subscribed frame, not merely TCP upgrade.
  });

test("account creates and manages tunnels; identity fields, empty patches and duplicate slugs are rejected", async () => {
  expect(
    (
      await app.request("/api/tunnels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "new", name: "New" }),
      })
    ).status,
  ).toBe(403);
  const created = await success(
    call("", "POST", { slug: "new", name: "New" }),
    ManagedTunnelSchema,
    201,
  );
  expect(created).toMatchObject({ orgId: "default", isActive: true });
  expect((await call("", "POST", { slug: "new", name: "Duplicate" })).status).toBe(409);
  expect((await call("", "POST", { slug: "bad/path", name: "Bad" })).status).toBe(400);
  expect(
    (await call("", "POST", { slug: "injected", name: "Bad", orgId: "elsewhere" })).status,
  ).toBe(400);
  const path = `/${created.id}`;
  expect((await call(path, "PATCH", {})).status).toBe(400);
  await success(call(path, "PATCH", { isActive: false }), ManagedTunnelSchema);
  expect(
    (await success(call(path, "PATCH", { name: "Renamed" }), ManagedTunnelSchema)).isActive,
  ).toBe(false);
  expect((await call(path, "PATCH", { slug: "other" })).status).toBe(409);
  const page = await success(call("?limit=1"), ManagedTunnelPageSchema);
  expect(page.items).toHaveLength(1);
  expect(page.nextCursor).not.toBeNull();
  const next = await success(call(`?cursor=${page.nextCursor}`), ManagedTunnelPageSchema);
  expect(new Set([...page.items, ...next.items].map((row) => row.id)).size).toBe(3);
  await success(call(path, "DELETE"), ManagedTunnelSchema);
  expect((await call(path)).status).toBe(404);
  expect((await call("", "POST", { slug: "new", name: "Reserved" })).status).toBe(409);
});

test("generated transport keys use existing ingress/relay guards; revocation closes only the matching live socket", async () => {
  const inbound = await generate("inbound");
  const outbound = await generate("outbound");
  const spare = await generate("outbound");
  for (const issued of [inbound, outbound]) {
    const row = db.select().from(apiKeys).where(eq(apiKeys.id, issued.key.id)).get();
    expect(row?.keyHash).toBe(createHash("sha256").update(issued.token).digest("hex"));
    expect(issued.key.permissions).toEqual([]);
  }
  const providerRequest = (key: string) =>
    app.request("/ingress/keys-test/c", {
      method: "POST",
      headers: { "x-api-key": key },
      body: "original payload",
    });
  expect((await providerRequest(outbound.token)).status).toBe(403);
  expect((await providerRequest(inbound.token)).status).toBe(200);
  expect((await call("/t/keys", "GET", undefined, inbound.token)).status).toBe(403);
  // Ordinary HTTP attempts using the wrong direction are rejected before upgrade.
  expect(
    (await app.request("/relay/keys-test", { headers: { "x-api-key": inbound.token } })).status,
  ).toBe(403);
  // The agent's credential check applies the same guards without registering a socket.
  const check = (key: string, slug = "keys-test") =>
    app.request(`/relay/${slug}/check`, { headers: { "x-api-key": key } });
  expect((await check(inbound.token)).status).toBe(403);
  expect((await check(outbound.token, "missing")).status).toBe(404);
  const checked = await check(outbound.token);
  expect(checked.status).toBe(200);
  expect(await checked.json()).toMatchObject({ data: { slug: "keys-test" } });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch, websocket });
  let socket: WebSocket | undefined;
  try {
    socket = await connect(`ws://127.0.0.1:${server.port}/relay/keys-test`, outbound.token);
    await success(call(`/t/keys/${spare.key.id}`, "DELETE"), ManagedKeySchema);
    expect(socket.readyState).toBe(WebSocket.OPEN);
    const closed = new Promise<number>((resolve) => {
      if (socket) socket.onclose = (event) => resolve(event.code);
    });
    await success(call(`/t/keys/${outbound.key.id}`, "DELETE"), ManagedKeySchema);
    expect(await closed).toBe(1008);
    expect(
      (await app.request("/relay/keys-test", { headers: { "x-api-key": outbound.token } })).status,
    ).toBe(403);
    expect(db.select().from(webhookDeliveries).get()?.status).toBe("PENDING");
    // Revocation during the HTTP->WS handoff must not resurrect the credential.
    const closeCodes: number[] = [];
    const late: IWsConnection = {
      data: {},
      readyState: 1,
      getBufferedAmount: () => 0,
      send: () => {
        throw new Error("Revoked key sent data");
      },
      close: (code) => {
        closeCodes.push(code ?? 0);
      },
    };
    relayService.register("t", late, { keyId: outbound.key.id });
    expect(closeCodes).toEqual([1008]);
    const unavailable = spyOn(db, "select").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    try {
      relayService.register("t", late, { keyId: outbound.key.id });
      expect(closeCodes).toEqual([1008, 1011]);
    } finally {
      unavailable.mockRestore();
    }
  } finally {
    socket?.close();
    await server.stop(true);
  }
  await success(call(`/t/keys/${inbound.key.id}`, "DELETE"), ManagedKeySchema);
  expect((await providerRequest(inbound.token)).status).toBe(403);
});

test("admin capabilities are explicit and independent; a delegated key cannot escape its tunnel", async () => {
  for (const permission of ManagementPermissionSchema.options) {
    const issued = await generate("admin", [permission]);
    const row = db.select().from(apiKeys).where(eq(apiKeys.id, issued.key.id)).get();
    expect(row?.keyHash.startsWith("$argon2id$")).toBe(true);
    expect(await Bun.password.verify(issued.token, row?.keyHash ?? "")).toBe(true);
    for (const [needed, path, method, body] of [
      ["tunnel", "/t", "PATCH", { name: "Managed" }],
      ["keys", "/t/keys", "POST", { types: "inbound", name: "Provider" }],
      ["collections", "/t/collections/c", "PATCH", { slug: "managed" }],
      ["endpoints", "/t/collections/c/endpoints/e", "PATCH", { isPaused: true }],
    ] satisfies [string, string, string, unknown][]) {
      expect((await call(path, method, body, issued.token)).status).toBe(
        needed === permission ? (method === "POST" ? 201 : 200) : 403,
      );
    }
    expect(
      (await call("", "POST", { name: "Escaped", slug: "escaped" }, issued.token)).status,
    ).toBe(403);
    for (const method of ["GET", "PATCH", "DELETE"])
      expect(
        (
          await call(
            "/other",
            method,
            method === "PATCH" ? { name: "Stolen" } : undefined,
            issued.token,
          )
        ).status,
      ).toBe(403);
    expect(
      (await call("/other/keys", "POST", { types: "inbound", name: "Escaped" }, issued.token))
        .status,
    ).toBe(403);
    if (permission === "tunnel")
      expect(
        (
          await success(call("", "GET", undefined, issued.token), ManagedTunnelPageSchema)
        ).items.map((item) => item.id),
      ).toEqual(["t"]);
    else expect((await call("", "GET", undefined, issued.token)).status).toBe(403);
  }
}, 12_000);

test("keys permission delegates transport issuance/revocation but cannot create or revoke admin keys", async () => {
  const manager = await generate("admin", ["keys"]);
  const transport = await generate("inbound", [], "t", manager.token);
  expect(
    (
      await call(
        "/t/keys",
        "POST",
        { types: "admin", name: "Escalation", permissions: ["tunnel"] },
        manager.token,
      )
    ).status,
  ).toBe(403);
  expect((await call(`/t/keys/${manager.key.id}`, "DELETE", undefined, manager.token)).status).toBe(
    403,
  );
  const other = await generate("inbound", [], "other");
  expect((await call(`/t/keys/${other.key.id}`, "DELETE", undefined, manager.token)).status).toBe(
    404,
  );
  await success(
    call(`/t/keys/${transport.key.id}`, "DELETE", undefined, manager.token),
    ManagedKeySchema,
  );
  const listed = await success(
    call("/t/keys?limit=1", "GET", undefined, manager.token),
    ManagedKeyPageSchema,
  );
  expect(listed.items.map((key) => key.id)).toEqual([manager.key.id]);
  // Public schemas are strict: no token or hash can appear in metadata/revoke responses.
  await success(call(`/t/keys/${manager.key.id}`, "DELETE"), ManagedKeySchema);
  expect((await call("/t/keys", "GET", undefined, manager.token)).status).toBe(403);
});

test("key inputs reject implicit permissions, unknown grants and caller-controlled secrets", async () => {
  for (const body of [
    { types: "admin", name: "Missing grants" },
    { types: "admin", name: "Empty", permissions: [] },
    { types: "admin", name: "Unknown", permissions: ["root"] },
    { types: "admin", name: "Duplicate", permissions: ["keys", "keys"] },
    { types: "inbound", name: "Escalation", permissions: ["keys"] },
    { types: "outbound", name: "Injected", keyHash: "chosen" },
    { types: "inbound", name: "Injected", tunnelId: "other" },
    { types: "inbound", name: "Injected", token: "chosen" },
  ])
    expect((await call("/t/keys", "POST", body)).status).toBe(400);
  const issued = await generate("admin", ["endpoints"]);
  db.update(apiKeys).set({ permissions: [] }).where(eq(apiKeys.id, issued.key.id)).run();
  expect((await call("/t/collections/c/endpoints", "GET", undefined, issued.token)).status).toBe(
    403,
  );
});

test("tunnel permission closes active relays on disable/delete while preserving config and stored history", async () => {
  const manager = await generate("admin", ["tunnel"]);
  const outbound = await generate("outbound");
  const closed: number[] = [];
  const ws: IWsConnection = {
    data: {},
    readyState: 1,
    getBufferedAmount: () => 0,
    send: () => 1,
    close: (code) => {
      closed.push(code ?? 0);
    },
  };
  relayService.register("t", ws, { keyId: outbound.key.id });
  await success(call("/t", "PATCH", { isActive: false }, manager.token), ManagedTunnelSchema);
  expect(closed).toEqual([1008]);
  expect(
    (await app.request("/relay/keys-test", { headers: { "x-api-key": outbound.token } })).status,
  ).toBe(404);
  await success(call("/t", "PATCH", { isActive: true }, manager.token), ManagedTunnelSchema);
  relayService.register("t", ws, { keyId: outbound.key.id });
  await success(call("/t", "DELETE", undefined, manager.token), ManagedTunnelSchema);
  expect(closed).toEqual([1008, 1008]);
  expect((await call("/t/collections")).status).toBe(404);
  expect((await call("/t", "GET", undefined, manager.token)).status).toBe(403);
  expect(db.select().from(endpoints).all()).toHaveLength(1);
  expect((await call("/t/keys", "POST", { types: "inbound", name: "Dead parent" })).status).toBe(
    404,
  );
});
