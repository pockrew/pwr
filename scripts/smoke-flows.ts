/**
 * Cross-process smoke of control flows: endpoint and tunnel pause/resume, several tunnels on one
 * agent, one agent per tunnel (refusal and takeover), and signed ingress for GitHub, Stripe,
 * Standard Webhooks, Shopify, Slack and a custom HMAC.
 * Usage: `bun scripts/smoke-flows.ts` (`SMOKE_BASE_PORT` + 40 picks its port block).
 */
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createChecks,
  createProcesses,
  jsonClient,
  pick,
  startTarget,
  str,
  until,
} from "./smoke/harness";

const BASE = Number(process.env["SMOKE_BASE_PORT"] ?? 28787) + 40;
const SERVER = `http://localhost:${BASE}`;
const TARGET = `http://127.0.0.1:${BASE + 12}`;
const root = mkdtempSync(join(tmpdir(), "pwr-smoke-flows-"));
const { check, fail, failures } = createChecks();
const procs = createProcesses(root);
const target = startTarget(BASE + 12);
const agentClient = (name: string, port: number) =>
  jsonClient(`http://127.0.0.1:${port}`, {
    authorization: `Bearer ${readFileSync(join(root, name, ".pockrew", "agent.token"), "utf8").trim()}`,
  });
const healthy = (url: string) => until(async () => (await fetch(url)).ok);

try {
  // 1. Server with two tunnels, each with keys, a collection and an endpoint.
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
  const admin = jsonClient(`${SERVER}/api`, { cookie, origin: SERVER });
  const setup = async (slug: string) => {
    const tunnelId = str(pick((await admin("POST", "/tunnels", { slug, name: slug })).data, "id"));
    const key = async (types: string) =>
      str(
        pick(
          (await admin("POST", `/tunnels/${tunnelId}/keys`, { types, name: types })).data,
          "token",
        ),
      );
    const collectionId = str(
      pick((await admin("POST", `/tunnels/${tunnelId}/collections`, { slug: "c" })).data, "id"),
    );
    const endpointId = str(
      pick(
        (
          await admin("POST", `/tunnels/${tunnelId}/collections/${collectionId}/endpoints`, {
            pathName: "/hook",
          })
        ).data,
        "id",
      ),
    );
    return {
      slug,
      tunnelId,
      inbound: await key("inbound"),
      outbound: await key("outbound"),
      collectionId,
      endpointId,
    };
  };
  const one = await setup("flows-one");
  const two = await setup("flows-two");
  check("two tunnels created", Boolean(one.endpointId && two.endpointId));

  const ingress = (
    t: typeof one,
    body: string,
    headers: Record<string, string> = { "x-api-key": t.inbound },
  ) => fetch(`${SERVER}/ingress/${t.slug}/${t.collectionId}`, { method: "POST", headers, body });

  // 2. One agent connects both tunnels; each endpoint forwards to its own target path.
  procs.agent("agentA", BASE + 1);
  check("agent A starts", await healthy(`http://127.0.0.1:${BASE + 1}/health`));
  const A = agentClient("agentA", BASE + 1);
  const connect = (client: typeof A, t: typeof one, extra: Record<string, unknown> = {}) =>
    client("POST", "/tunnels/connect", {
      tunnelId: t.slug,
      slug: t.slug,
      serverWsUrl: SERVER,
      apiKey: t.outbound,
      ...extra,
    });
  const session = async (client: typeof A, t: typeof one) =>
    pick((await client("GET", `/tunnels/${t.slug}`)).data, "tunnel");
  await connect(A, one);
  await connect(A, two);
  const connected = (client: typeof A, t: typeof one) => async () =>
    pick(await session(client, t), "status") === "connected";
  check(
    "agent A: both tunnels connected",
    (await until(connected(A, one))) && (await until(connected(A, two))),
  );
  const setTarget = async (client: typeof A, t: typeof one, path: string) => {
    const synced = async () =>
      (
        await client(
          "PATCH",
          `/tunnels/${t.slug}/collections/${t.collectionId}/endpoints/${t.endpointId}`,
          {
            localTarget: `${TARGET}${path}`,
          },
        )
      ).status === 200;
    return until(synced);
  };
  check("targets set", (await setTarget(A, one, "/one")) && (await setTarget(A, two, "/two")));
  await ingress(one, "both-1");
  await ingress(two, "both-2");
  check(
    "both tunnels deliver at the same time (switching in Studio is only a view)",
    await until(() => target.bodies("both-1") === 1 && target.bodies("both-2") === 1),
  );

  // 3. Endpoint pause: held (server keeps it PENDING), delivered once on resume.
  const epPath = `/tunnels/${one.slug}/collections/${one.collectionId}/endpoints/${one.endpointId}`;
  check("endpoint paused", (await A("PATCH", epPath, { isPaused: true })).status === 200);
  await Bun.sleep(1500);
  await ingress(one, "ep-paused");
  await Bun.sleep(2500);
  check("endpoint pause holds the delivery", target.bodies("ep-paused") === 0);
  check("endpoint resumed", (await A("PATCH", epPath, { isPaused: false })).status === 200);
  check(
    "held delivery sent once after resume",
    await until(() => target.bodies("ep-paused") === 1),
  );

  // 4. Tunnel pause: received and stored, not executed; re-saving the tunnel keeps it paused.
  check("tunnel paused", (await A("POST", `/tunnels/${one.slug}/pause`)).status === 200);
  await ingress(one, "tunnel-paused");
  await Bun.sleep(2500);
  check("tunnel pause holds the delivery", target.bodies("tunnel-paused") === 0);
  await connect(A, one, { apiKey: undefined });
  await until(connected(A, one));
  check(
    "re-saving a paused tunnel keeps it paused",
    pick(await session(A, one), "isPaused") === true,
  );
  await Bun.sleep(1500);
  check("still held after re-save", target.bodies("tunnel-paused") === 0);
  check("tunnel resumed", (await A("POST", `/tunnels/${one.slug}/resume`, {})).status === 200);
  check(
    "held delivery sent once after resume",
    await until(() => target.bodies("tunnel-paused") === 1),
  );

  // 5. One agent per tunnel: a second machine is refused, or replaces the first with takeover.
  procs.agent("agentB", BASE + 2);
  check("agent B starts", await healthy(`http://127.0.0.1:${BASE + 2}/health`));
  const B = agentClient("agentB", BASE + 2);
  await connect(B, one);
  const refused = async () => pick(await session(B, one), "lastError") === "tunnel_in_use";
  check("agent B refused while A owns the tunnel", await until(refused));
  await ingress(one, "owner-a");
  check("deliveries still go only to A", await until(() => target.bodies("owner-a") === 1));
  await connect(B, one, { takeover: true });
  check("agent B takes over", await until(connected(B, one)));
  check(
    "agent A loses the tunnel",
    await until(async () => pick(await session(A, one), "status") !== "connected"),
  );
  check("A keeps its other tunnel", pick(await session(A, two), "status") === "connected");
  check("B sets its own target", await setTarget(B, one, "/one-b"));
  await ingress(one, "owner-b");
  check("deliveries go to B only, once", await until(() => target.bodies("owner-b") === 1));
  check(
    "nothing duplicated to A's target",
    target.hits.filter((h) => h.path === "/one" && h.body.toString() === "owner-b").length === 0,
  );

  // 6. GitHub signed ingress replaces the API key for that tunnel.
  const signingPath = `/tunnels/${two.tunnelId}/ingress-signing`;
  const ghSecret = "github-smoke-secret";
  check(
    "GitHub signing enabled",
    (await admin("PUT", signingPath, { provider: "github", secret: ghSecret })).status === 200,
  );
  const ghBody = '{"action":"opened"}';
  const ghSig = `sha256=${createHmac("sha256", ghSecret).update(ghBody).digest("hex")}`;
  const ghOk = await ingress(two, ghBody, {
    "x-hub-signature-256": ghSig,
    "content-type": "application/json",
  });
  check("valid GitHub signature accepted", ghOk.status === 200, String(ghOk.status));
  const ghBad = await ingress(two, `${ghBody} `, { "x-hub-signature-256": ghSig });
  const ghKeyOnly = await ingress(two, ghBody);
  check(
    "tampered body or API key alone rejected",
    ghBad.status === 403 && ghKeyOnly.status === 403,
    `${ghBad.status}/${ghKeyOnly.status}`,
  );
  check("signed GitHub event delivered", await until(() => target.bodies(ghBody) === 1));

  // 7. Stripe signed ingress: t/v1 over `timestamp.body`, five-minute window.
  const stSecret = "whsec_smoke";
  check(
    "Stripe signing enabled",
    (await admin("PUT", signingPath, { provider: "stripe", secret: stSecret })).status === 200,
  );
  const stBody = '{"type":"payment_intent.succeeded"}';
  const stripeHeader = (t: number, body = stBody) =>
    `t=${t},v1=${createHmac("sha256", stSecret).update(`${t}.${body}`).digest("hex")}`;
  const now = Math.floor(Date.now() / 1000);
  const stOk = await ingress(two, stBody, { "stripe-signature": stripeHeader(now) });
  const stOld = await ingress(two, stBody, { "stripe-signature": stripeHeader(now - 600) });
  const stTampered = await ingress(two, `${stBody}x`, { "stripe-signature": stripeHeader(now) });
  check("valid Stripe signature accepted", stOk.status === 200, String(stOk.status));
  check(
    "expired or tampered Stripe signature rejected",
    stOld.status === 403 && stTampered.status === 403,
    `${stOld.status}/${stTampered.status}`,
  );
  check("signed Stripe event delivered", await until(() => target.bodies(stBody) === 1));
  // 8. Providers that cannot add headers: each signs the raw body its own way.
  const signedCase = async (
    name: string,
    signing: Record<string, unknown>,
    sign: (body: string, now: number) => Record<string, string>,
  ) => {
    const saved = await admin("PUT", signingPath, signing);
    const body = `{"provider":"${name}"}`;
    const now = Math.floor(Date.now() / 1000);
    const ok = await ingress(two, body, sign(body, now));
    const tampered = await ingress(two, `${body} `, sign(body, now));
    check(
      `${name}: valid accepted, tampered rejected`,
      saved.status === 200 && ok.status === 200 && tampered.status === 403,
      `${saved.status}/${ok.status}/${tampered.status}`,
    );
    check(`${name}: delivered`, await until(() => target.bodies(body) === 1));
  };
  const svixKey = Buffer.from("smoke-standard-webhooks-key");
  await signedCase(
    "standard_webhooks",
    { provider: "standard_webhooks", secret: `whsec_${svixKey.toString("base64")}` },
    (body, now) => ({
      "webhook-id": `msg_${now}`,
      "webhook-timestamp": String(now),
      "webhook-signature": `v1,${createHmac("sha256", svixKey).update(`msg_${now}.${now}.${body}`).digest("base64")}`,
    }),
  );
  await signedCase("shopify", { provider: "shopify", secret: "shopify-secret" }, (body) => ({
    "x-shopify-hmac-sha256": createHmac("sha256", "shopify-secret").update(body).digest("base64"),
  }));
  await signedCase("slack", { provider: "slack", secret: "slack-secret" }, (body, now) => ({
    "x-slack-request-timestamp": String(now),
    "x-slack-signature": `v0=${createHmac("sha256", "slack-secret").update(`v0:${now}:${body}`).digest("hex")}`,
  }));
  await signedCase(
    "custom hmac",
    {
      provider: "hmac",
      secret: "linear-secret",
      options: { header: "linear-signature", algorithm: "sha256", encoding: "hex", prefix: "" },
    },
    (body) => ({
      "linear-signature": createHmac("sha256", "linear-secret").update(body).digest("hex"),
    }),
  );
  check(
    "API-key mode restored",
    (await admin("DELETE", signingPath)).status === 200 &&
      (await ingress(two, "key-again")).status === 200,
  );
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
