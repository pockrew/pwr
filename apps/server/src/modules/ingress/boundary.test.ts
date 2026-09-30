import { afterAll, afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IWsConnection } from "@server/modules/relays/service";

import { closeLogging, configureLogging } from "@pockrew/pwr-core";
import { RelayServerMessageSchema } from "@pockrew/pwr-shared/schemas";

process.env["BETTER_AUTH_SECRET"] = "ingress-boundary-test-secret-long-enough";
process.env["ADMIN_EMAIL"] = "ingress-boundary@example.com";
process.env["ADMIN_PASSWORD"] = "ingress-boundary-password";
const { app } = await import("@server/app");
const { db, sqliteClient } = await import("@server/db/client");
const {
  audit_logs,
  apiKeys,
  collections,
  endpoints,
  ingressSigning,
  tunnels,
  webhookDeliveries,
  webhookEvents,
} = await import("@server/db/schemas");
const { relayService } = await import("@server/modules/relays/service");
const { setSigningConfig } = await import("@server/modules/ingress/signing");
const key = "only-a-disposable-provider-key";
let server: ReturnType<typeof Bun.serve>;

/** Raw HTTP allows a GET/HEAD body; Fetch clients may discard it before the server sees it. */
const send = (method: string, body = Buffer.alloc(0)): Promise<number> =>
  new Promise((resolve, reject) => {
    const port = server.port;
    if (!port) {
      reject(new Error("Test server has no listening port"));
      return;
    }
    const socket = createConnection({ host: "127.0.0.1", port });
    let response = "";
    socket.on("connect", () => {
      socket.write(
        Buffer.concat([
          Buffer.from(
            `${method} /ingress/verify/collection HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\nx-api-key: ${key}\r\nContent-Type: application/octet-stream\r\nContent-Length: ${body.length}\r\n\r\n`,
          ),
          body,
        ]),
      );
    });
    socket.on("data", (chunk) => {
      response += chunk.toString();
    });
    socket.on("end", () => resolve(Number(response.split(" ")[1])));
    socket.on("error", reject);
  });

beforeEach(() => {
  // Signature-failure audits are throttled per tunnel and minute; each test starts a new window.
  setSystemTime(new Date(Date.now() + 5 * 60_000));
  relayService.closeAll("reset");
  for (const table of [
    webhookDeliveries,
    webhookEvents,
    audit_logs,
    apiKeys,
    ingressSigning,
    endpoints,
    collections,
    tunnels,
  ])
    db.delete(table).run();
  db.insert(tunnels).values({ id: "t", slug: "verify", name: "Verify" }).run();
  db.insert(collections).values({ id: "collection", tunnelId: "t" }).run();
  db.insert(endpoints)
    .values({
      id: "endpoint",
      collectionId: "collection",
      pathName: "target",
    })
    .run();
  db.insert(apiKeys)
    .values({
      tunnelId: "t",
      types: "inbound",
      name: "provider",
      keyPrefix: "test",
      keyHash: createHash("sha256").update(key).digest("hex"),
    })
    .run();
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
});

afterEach(() => {
  sqliteClient.run("DROP TRIGGER IF EXISTS reject_ingress_boundary");
  sqliteClient.run("DROP TRIGGER IF EXISTS reject_hmac_audit");
  relayService.closeAll("test complete");
  server.stop(true);
});
afterAll(() => setSystemTime());

test("provider OPTIONS is stored; unsupported methods cannot poison a later valid relay batch", async () => {
  const original = Buffer.from([0, 255, 13, 10]);
  expect(await send("OPTIONS", original)).toBe(200);
  expect(db.select().from(webhookEvents).all()[0]?.payload).toEqual(original);
  for (const method of ["TRACE", "PROPFIND"])
    expect(await send(method, Buffer.from(method))).toBe(400);
  expect(db.select().from(webhookEvents).all()).toHaveLength(1);
  expect(await send("POST", original)).toBe(200);
  await Bun.sleep(0);
  expect(db.select().from(webhookDeliveries).all()).toHaveLength(2);
  const frames: string[] = [];
  const ws: IWsConnection = {
    data: {},
    readyState: 1,
    getBufferedAmount: () => 0,
    send: (value) => {
      frames.push(String(value));
      return 1;
    },
    close: () => {},
  };
  relayService.register("t", ws);
  expect(
    frames.map((encoded) => RelayServerMessageSchema.safeParse(JSON.parse(encoded)).success),
  ).toEqual([true, true]);
});

test("GET/HEAD bodies fail before storage instead of receiving a false success", async () => {
  for (const method of ["GET", "HEAD"]) {
    expect(await send(method, Buffer.from(`body-${method}`))).toBe(400);
  }
  expect(db.select().from(webhookEvents).all()).toHaveLength(0);
  expect(await send("GET")).toBe(200);
  expect(db.select().from(webhookEvents).all()[0]?.payload).toEqual(Buffer.alloc(0));
});

test("ingress receipt and stored headers never expose its transport key", async () => {
  const body = Buffer.from("sensitive-provider-payload");
  const response = await app.request("/ingress/verify/collection?x=%2f&x=2", {
    method: "POST",
    headers: { "x-api-key": key, "x-hub-signature-256": "sha256=provider-signature" },
    body,
  });
  expect(response.status).toBe(200);
  const receipt = await response.text();
  expect(JSON.parse(receipt)).toEqual({
    data: { id: expect.any(String) },
    requestId: expect.any(String),
  });
  expect(receipt).not.toContain(key);
  expect(receipt).not.toContain(body.toString());
  const event = db.select().from(webhookEvents).all()[0];
  expect(event?.payload).toEqual(body);
  expect(event?.rawQuery).toBe("x=%2f&x=2");
  const headers = JSON.parse(event?.headers ?? "{}");
  expect(headers["x-hub-signature-256"]).toBe("sha256=provider-signature");
  expect(headers).not.toHaveProperty("x-api-key");
});

test("a database write failure returns 500 without printing provider bytes or API key", async () => {
  sqliteClient.run(
    "CREATE TRIGGER reject_ingress_boundary BEFORE INSERT ON webhook_events BEGIN SELECT RAISE(ABORT, 'test failure'); END",
  );
  // The real pipeline: what the rotating log file (and any other sink) actually receives.
  const logDir = mkdtempSync(join(tmpdir(), "pwr-boundary-logs-"));
  const logFile = join(logDir, "server.log");
  await configureLogging(
    { category: ["pwr", "server"], file: logFile, console: false },
    { level: "debug", maxSizeMb: 1, maxFiles: 1 },
  );
  try {
    expect(await send("POST", Buffer.from("sensitive-provider-payload"))).toBe(500);
    await closeLogging();
    const diagnostic = readFileSync(logFile, "utf8");
    expect(diagnostic).toContain("request.unhandled");
    expect(diagnostic).not.toContain("sensitive-provider-payload");
    expect(diagnostic).not.toContain(key);
    expect(db.select().from(webhookEvents).all()).toHaveLength(0);
  } finally {
    await closeLogging();
    rmSync(logDir, { recursive: true, force: true });
  }
});

test("GitHub signed ingress stores exact bytes without an API key and rejects tampered attempts", async () => {
  setSigningConfig("t", { provider: "github", secret: "github-signing-secret" });
  const body = Buffer.from([0, 255, 13, 10]);
  const signature = `sha256=${createHmac("sha256", "github-signing-secret").update(body).digest("hex")}`;
  const signed = (payload: Buffer, extraHeaders: Record<string, string> = {}) =>
    app.request("/ingress/verify/collection", {
      method: "POST",
      headers: { "x-hub-signature-256": signature, ...extraHeaders },
      body: payload,
    });
  expect((await signed(Buffer.from("tampered"), { "x-api-key": key })).status).toBe(403);
  expect((await signed(body, { "x-hub-signature-256": "sha256=broken" })).status).toBe(403);
  expect(db.select().from(webhookEvents).all()).toHaveLength(0);
  expect(db.select().from(webhookDeliveries).all()).toHaveLength(0);
  // One audit row per tunnel and minute: unauthenticated traffic cannot grow the table per request.
  expect(db.select().from(audit_logs).all()).toHaveLength(1);
  setSystemTime(new Date(Date.now() + 61_000));
  expect((await signed(body, { "x-hub-signature-256": "sha256=broken" })).status).toBe(403);
  const failures = db.select().from(audit_logs).all();
  expect(failures).toHaveLength(2);
  expect(
    failures.every((row) => row.action === "ingress.hmac_failed" && row.entityId === "t"),
  ).toBe(true);
  expect(failures.map((row) => JSON.parse(row.details ?? "{}"))).toContainEqual({
    provider: "github",
    sourceIp: expect.any(String),
    requestId: expect.any(String),
    method: "POST",
    suppressedSinceLastAudit: 1,
  });
  expect(JSON.stringify(failures)).not.toContain(key);
  expect(JSON.stringify(failures)).not.toContain("github-signing-secret");
  expect((await signed(body)).status).toBe(200);
  const event = db.select().from(webhookEvents).all()[0];
  expect(event?.payload).toEqual(body);
  expect(JSON.parse(event?.headers ?? "{}")["x-hub-signature-256"]).toBe(signature);
  expect(db.select().from(ingressSigning).get()?.encryptedSecret).not.toContain(
    "github-signing-secret",
  );
});

test("Stripe signed ingress requires a recent v1 signature over timestamp and exact body", async () => {
  setSigningConfig("t", { provider: "stripe", secret: "whsec_stripe-test-secret" });
  const body = Buffer.from('{ "id": "evt_1" }\n');
  const sign = (timestamp: number, payload = body) =>
    `t=${timestamp},v1=${createHmac("sha256", "whsec_stripe-test-secret")
      .update(Buffer.concat([Buffer.from(`${timestamp}.`), payload]))
      .digest("hex")}`;
  const request = (signature: string, payload = body) =>
    app.request("/ingress/verify/collection", {
      method: "POST",
      headers: { "stripe-signature": signature },
      body: payload,
    });
  const now = Math.floor(Date.now() / 1000);
  expect((await request(sign(now), Buffer.from("changed"))).status).toBe(403);
  expect((await request(sign(now - 301))).status).toBe(403);
  expect((await request(`t=${now},v1=bad`)).status).toBe(403);
  expect(db.select().from(webhookEvents).all()).toHaveLength(0);
  expect(db.select().from(webhookDeliveries).all()).toHaveLength(0);
  expect(db.select().from(audit_logs).all()).toHaveLength(1);
  const signature = sign(now);
  expect((await request(signature)).status).toBe(200);
  const event = db.select().from(webhookEvents).all()[0];
  expect(event?.payload).toEqual(body);
  expect(JSON.parse(event?.headers ?? "{}")["stripe-signature"]).toBe(signature);
});

test("failed HMAC audit writes must not return an unaudited 403", async () => {
  setSigningConfig("t", { provider: "github", secret: "github-signing-secret" });
  sqliteClient.run(
    "CREATE TRIGGER reject_hmac_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'test audit failure'); END",
  );
  const response = await app.request("/ingress/verify/collection", {
    method: "POST",
    headers: { "x-hub-signature-256": "sha256=broken" },
    body: "unauthenticated payload",
  });
  expect(response.status).toBe(503);
  expect(db.select().from(webhookEvents).all()).toHaveLength(0);
  expect(db.select().from(webhookDeliveries).all()).toHaveLength(0);
});

test("unreadable signing configuration is audited and fails closed", async () => {
  setSigningConfig("t", { provider: "github", secret: "github-signing-secret" });
  db.update(ingressSigning).set({ encryptedSecret: "invalid" }).run();
  const response = await app.request("/ingress/verify/collection", {
    method: "POST",
    headers: { "x-hub-signature-256": "sha256=broken" },
    body: "unauthenticated payload",
  });
  expect(response.status).toBe(500);
  expect(db.select().from(audit_logs).all()).toHaveLength(1);
  expect(db.select().from(webhookEvents).all()).toHaveLength(0);
  expect(db.select().from(webhookDeliveries).all()).toHaveLength(0);
});
