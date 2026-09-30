/**
 * Cross-process release smoke: real server + agent processes on temporary databases and spare
 * ports, a recording local target, and provider HTTP requests. Usage: `bun run smoke`
 * (`SMOKE_BASE_PORT`, default 28787, picks the port block). Logs are kept only on failure.
 */
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createChecks,
  createProcesses,
  jsonClient,
  list,
  pick,
  startTarget,
  str,
  until,
} from "./smoke/harness";

const BASE = Number(process.env["SMOKE_BASE_PORT"] ?? 28787);
const SERVER = `http://localhost:${BASE}`;
const root = mkdtempSync(join(tmpdir(), "pwr-smoke-"));
const { check, fail, failures } = createChecks();
const procs = createProcesses(root);
const target = startTarget(BASE + 12);
const targetUrl = `http://127.0.0.1:${BASE + 12}/hook`;

const agentClient = (name: string, port: number) =>
  jsonClient(`http://127.0.0.1:${port}`, {
    authorization: `Bearer ${readFileSync(join(root, name, ".pockrew", "agent.token"), "utf8").trim()}`,
  });
const healthy = (url: string) => until(async () => (await fetch(url)).ok);

try {
  // 1. Server + admin setup through the public management API.
  procs.server(BASE, SERVER);
  check("server starts", await healthy(`${SERVER}/api/ready`));
  const signIn = await fetch(`${SERVER}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: SERVER },
    body: JSON.stringify({ email: "smoke@example.com", password: "smoke-password-123" }),
  });
  const cookie = signIn.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
  check("admin sign-in", signIn.ok, String(signIn.status));
  const admin = jsonClient(`${SERVER}/api`, { cookie, origin: SERVER });
  const tunnelId = str(
    pick((await admin("POST", "/tunnels", { slug: "smoke", name: "Smoke" })).data, "id"),
  );
  const issue = async (types: string) =>
    str(
      pick(
        (await admin("POST", `/tunnels/${tunnelId}/keys`, { types, name: types })).data,
        "token",
      ),
    );
  const inbound = await issue("inbound");
  const outbound = await issue("outbound");
  const colId = str(
    pick(
      (await admin("POST", `/tunnels/${tunnelId}/collections`, { slug: "payments" })).data,
      "id",
    ),
  );
  const epPath = `/tunnels/${tunnelId}/collections/${colId}/endpoints`;
  const epId = str(pick((await admin("POST", epPath, { pathName: "/hooks" })).data, "id"));
  check(
    "tunnel, keys, collection, endpoint created",
    Boolean(tunnelId && inbound && outbound && colId && epId),
  );

  // 2. Agent: key check stores nothing; connect with the outbound key.
  procs.agent("agentA", BASE + 1);
  check("agent starts", await healthy(`http://127.0.0.1:${BASE + 1}/health`));
  const A = agentClient("agentA", BASE + 1);
  check(
    "agent API requires its token",
    (await fetch(`http://127.0.0.1:${BASE + 1}/tunnels`)).status === 401,
  );
  const keyCheck = async (apiKey?: string) =>
    str(
      pick(
        (
          await A("POST", "/tunnels/test", {
            serverWsUrl: SERVER,
            slug: "smoke",
            ...(apiKey ? { apiKey } : {}),
          })
        ).data,
        "result",
      ),
    );
  const verdicts = [
    await keyCheck("bogus"),
    await keyCheck(inbound),
    await keyCheck(outbound),
  ].join("/");
  check(
    "key check: bogus + inbound rejected, outbound ok",
    verdicts === "unauthorized/unauthorized/ok",
    verdicts,
  );
  check(
    "key check saves nothing",
    list(pick((await A("GET", "/tunnels")).data, "tunnels")).length === 0,
  );
  await A("POST", "/tunnels/connect", {
    tunnelId: "smoke",
    slug: "smoke",
    serverWsUrl: SERVER,
    apiKey: outbound,
  });
  const status = async (client = A) =>
    str(pick((await client("GET", "/tunnels/smoke")).data, "tunnel", "status"));
  check("agent connected", await until(async () => (await status()) === "connected"));
  const synced = async () =>
    list(pick((await A("GET", "/tunnels/smoke/config?kind=endpoint")).data, "items")).some(
      (item) => pick(item, "value", "id") === epId,
    );
  check("server config synced to agent", await until(synced));

  // 3. Ingress while the endpoint has no local target: stored, held, never forwarded.
  const ingress = async (
    path: string,
    body: Uint8Array | string,
    headers: Record<string, string> = {},
  ) => {
    const res = await fetch(`${SERVER}/ingress/smoke/${path}`, {
      method: "POST",
      headers: { "x-api-key": inbound, "content-type": "application/octet-stream", ...headers },
      body,
    });
    return { status: res.status, id: str(pick(await res.json(), "data", "id")) };
  };
  const bytes = new Uint8Array([0, 255, 13, 10, 0x7b, 0xc3, 0x28, 1, 2, 3]);
  const first = await ingress(`${colId}?b=2&a=1&a=0&e=%2F&x=`, bytes);
  check(
    "ingress returns 200 + event id",
    first.status === 200 && Boolean(first.id),
    String(first.status),
  );
  const rejected = [
    (await fetch(`${SERVER}/ingress/smoke/${colId}`, { method: "POST", body: "x" })).status,
    (
      await fetch(`${SERVER}/ingress/smoke/${colId}`, {
        method: "POST",
        body: "x",
        headers: { "x-api-key": outbound },
      })
    ).status,
  ];
  check(
    "ingress rejects missing and outbound keys",
    rejected.every((s) => s >= 400),
    rejected.join("/"),
  );
  await Bun.sleep(1500);
  check("held: no target call without a local target", target.hits.length === 0);

  // 4. Target + secret in ONE request: the released delivery carries the secret on its first call.
  const edit = await A("PATCH", `/tunnels/smoke/collections/${colId}/endpoints/${epId}`, {
    localTarget: targetUrl,
    secret: { headerName: "x-target-secret", secret: "target-secret-value" },
  });
  check(
    "target + secret saved together",
    edit.status === 200 && !JSON.stringify(edit.data).includes("target-secret-value"),
  );
  check("held delivery released", await until(() => target.hits.length >= 1));
  const hit = target.hits[0];
  check(
    "first released call carries the secret",
    hit?.headers["x-target-secret"] === "target-secret-value",
  );
  check(
    "body bytes preserved exactly",
    Boolean(hit && Buffer.compare(hit.body, Buffer.from(bytes)) === 0),
  );
  check("raw query preserved", hit?.query === "b=2&a=1&a=0&e=%2F&x=", hit?.query);
  check("inbound x-api-key not forwarded", hit !== undefined && !("x-api-key" in hit.headers));
  const deliveryId = hit?.headers["x-pwr-delivery-id"] ?? "";
  check("x-pwr-delivery-id present", Boolean(deliveryId));

  const db = new Database(join(root, "server", "server.sqlite"), { readonly: true });
  const delivery = (id: string): unknown =>
    db.query("select * from webhook_deliveries where id = ?").get(id);
  const deliveredOk = (id: string) =>
    pick(delivery(id), "status") === "DELIVERED" &&
    pick(delivery(id), "relay_status") === "SUCCESS";
  check("server: DELIVERED + SUCCESS", await until(() => deliveredOk(deliveryId)));
  const reported = async () =>
    Boolean(
      pick(
        list(pick((await A("GET", `/requests/${first.id}/deliveries`)).data, "items"))[0],
        "reportedAt",
      ),
    );
  check("agent: result confirmed by server", await until(reported));
  const storedHeaders = str(
    pick(db.query("select headers from webhook_events where id = ?").get(first.id), "headers"),
  );
  check("server history omits the inbound key", !storedHeaders.toLowerCase().includes("x-api-key"));

  // 5. Replay: new ID, same bytes, source untouched, recorded on the server.
  const beforeReplay = target.hits.length;
  check("replay accepted", (await A("POST", `/replay/${deliveryId}`, {})).status === 200);
  check("replay reached target", await until(() => target.hits.length === beforeReplay + 1));
  const replay = target.hits.at(-1);
  const replayId = replay?.headers["x-pwr-delivery-id"] ?? "";
  check(
    "replay has x-pwr-replay-of + new id",
    replay?.headers["x-pwr-replay-of"] === deliveryId && replayId !== deliveryId,
  );
  check(
    "replay body identical",
    Boolean(replay && Buffer.compare(replay.body, Buffer.from(bytes)) === 0),
  );
  const replayRecorded = (id: string) =>
    pick(delivery(id), "trigger") === "replay" &&
    pick(delivery(id), "replay_of_delivery_id") === deliveryId;
  check("server recorded the replay", await until(() => replayRecorded(replayId)));

  // 6. Provider retries dedupe; failed targets are terminal and do not block the queue.
  const dupA = await ingress(colId, "dup", { "x-github-delivery": "gh-1" });
  const dupB = await ingress(colId, "dup", { "x-github-delivery": "gh-1" });
  check("provider retry deduped to one event", Boolean(dupA.id) && dupA.id === dupB.id);
  await until(() => target.bodies("dup") >= 1);
  target.setStatus(500);
  const failed = await ingress(colId, "will-fail");
  await until(() => target.bodies("will-fail") >= 1);
  target.setStatus(200);
  await ingress(colId, "after-fail");
  check(
    "queue continues after a failed target",
    await until(() => target.bodies("after-fail") === 1),
  );
  await Bun.sleep(1000);
  check(
    "dedupe delivered once; failure not retried",
    target.bodies("dup") === 1 && target.bodies("will-fail") === 1,
  );
  const failedRow = db
    .query("select relay_status, response_status from webhook_deliveries where event_id = ?")
    .get(failed.id);
  check(
    "server: FAILED result with HTTP 500",
    pick(failedRow, "relay_status") === "FAILED" && pick(failedRow, "response_status") === 500,
  );

  // 7. Agent offline: backlog stays PENDING, then drains after restart.
  await procs.stop("agentA");
  const off = [await ingress(colId, "offline-1"), await ingress("target/hooks", "offline-2")];
  await Bun.sleep(1000);
  check(
    "offline: server keeps deliveries PENDING",
    off.every(
      (e) =>
        pick(
          db.query("select status from webhook_deliveries where event_id = ?").get(e.id),
          "status",
        ) === "PENDING",
    ),
  );
  procs.agent("agentA", BASE + 1);
  check(
    "restart drains the backlog",
    await until(() => target.bodies("offline-1") === 1 && target.bodies("offline-2") === 1, 20_000),
  );

  // 8. Server offline: replay still works locally and is reported after reconnect.
  await procs.stop("server");
  const beforeOffline = target.hits.length;
  const offlineReplay = await A("POST", `/replay/${deliveryId}`, {});
  check(
    "replay works while the server is down",
    offlineReplay.status === 200 && (await until(() => target.hits.length === beforeOffline + 1)),
  );
  const offlineReplayId = target.hits.at(-1)?.headers["x-pwr-delivery-id"] ?? "";
  procs.server(BASE, SERVER);
  check(
    "agent reconnects after server restart",
    await until(async () => (await status()) === "connected", 30_000),
  );
  check(
    "offline replay reported after reconnect",
    await until(() => replayRecorded(offlineReplayId), 20_000),
  );

  // 9. One agent per tunnel; revoking the key disconnects the agent.
  procs.agent("agentB", BASE + 2);
  check("second agent starts", await healthy(`http://127.0.0.1:${BASE + 2}/health`));
  const B = agentClient("agentB", BASE + 2);
  await B("POST", "/tunnels/connect", {
    tunnelId: "smoke",
    slug: "smoke",
    serverWsUrl: SERVER,
    apiKey: outbound,
  });
  const refused = async () =>
    str(pick((await B("GET", "/tunnels/smoke")).data, "tunnel", "lastError")) === "tunnel_in_use";
  check("second agent refused (tunnel_in_use)", await until(refused));
  check("first agent stays connected", (await status()) === "connected");
  await B("POST", "/tunnels/disconnect", { tunnelId: "smoke" });
  const keys = list(pick((await admin("GET", `/tunnels/${tunnelId}/keys`)).data, "items"));
  const outboundKeyId = str(
    pick(
      keys.find((k) => pick(k, "types") === "outbound"),
      "id",
    ),
  );
  await admin("DELETE", `/tunnels/${tunnelId}/keys/${outboundKeyId}`);
  check(
    "revoking the outbound key disconnects the agent",
    await until(async () => (await status()) !== "connected"),
  );
  check("saved (revoked) key now fails the check", (await keyCheck()) === "unauthorized");
  db.close();
} catch (error) {
  fail("unexpected error", error);
} finally {
  await procs.stopAll();
  target.stop();
  if (failures() === 0) rmSync(root, { recursive: true, force: true });
  else console.log(`\nLogs and databases kept in ${root}`);
  console.log(failures() === 0 ? "\nALL PASS" : `\n${failures()} FAILURE(S)`);
  process.exit(failures() === 0 ? 0 : 1);
}
