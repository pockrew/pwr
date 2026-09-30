import { afterEach, beforeEach, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";
import { localDb } from "@agent/db/client";
import { agentDbFile } from "@agent/platform/data-dir";

import { forwardRelayPackage } from "@pockrew/pwr-core";
import { RelayPackageSchema, type RelayClientAck } from "@pockrew/pwr-shared/schemas";

import { setEndpointTarget } from "./credentials.repository";
import { PackageExecutor } from "./execution";
import { getRelayPackage, receiveRelayPackage } from "./repository";

const scope = { serverUrl: "http://execution.test", slug: "execution" };
let target: ReturnType<typeof Bun.serve>;
let calls = 0;

const packet = (id: string, headers = "{}") =>
  RelayPackageSchema.parse({
    id,
    eventId: `event-${id}`,
    endpointId: "endpoint",
    tunnelId: "tunnel",
    trigger: "live",
    replayOfDeliveryId: null,
    relayStatus: null,
    method: "POST",
    contentType: "application/json",
    payloadBase64: Buffer.from("{}").toString("base64"),
    headers,
    queryParams: "{}",
    rawQuery: null,
    eventReceivedAt: new Date().toISOString(),
  });

beforeEach(() => {
  calls = 0;
  target = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => {
      calls += 1;
      return new Response("ok");
    },
  });
  for (const table of ["local_relay_packages", "local_events", "local_deliveries"])
    localDb.run(`DELETE FROM ${table}`);
  setEndpointTarget(scope, "endpoint", `http://127.0.0.1:${target.port}/hook`);
});

afterEach(async () => {
  localDb.run("DROP TRIGGER IF EXISTS reject_completion");
  await target.stop(true);
});

test("a corrupt stored header becomes a FAILED result instead of throwing (no poison package)", async () => {
  const outcome = await forwardRelayPackage(
    packet("poison", JSON.stringify({ "x-bad": "line\nbreak" })),
    `http://127.0.0.1:${target.port}/hook`,
    "default",
  );
  expect(outcome.ack).toMatchObject({ type: "ack_relayed", status: "FAILED" });
  expect(outcome.result.statusCode).toBe(502);
  expect(calls).toBe(0);
});

test("a failed result commit is retried as a commit, never as a second target call", async () => {
  const acks: RelayClientAck[] = [];
  const executor = new PackageExecutor((_scope, ack) => acks.push(ack));
  receiveRelayPackage(scope, packet("once"), "default");
  // 1. The target is called, then the commit fails (e.g. disk full).
  localDb.run(
    "CREATE TRIGGER reject_completion BEFORE UPDATE OF completed ON local_relay_packages BEGIN SELECT RAISE(ABORT, 'disk full'); END",
  );
  await expect(executor.execute(scope, "once")).rejects.toThrow();
  expect(calls).toBe(1);
  expect(getRelayPackage(scope, "once")?.result).toBeNull();
  // 2. Once storage recovers, the retry commits the same outcome without calling the target again.
  localDb.run("DROP TRIGGER reject_completion");
  const result = await executor.execute(scope, "once");
  expect(calls).toBe(1);
  expect(result.statusCode).toBe(200);
  expect(getRelayPackage(scope, "once")?.result?.statusCode).toBe(200);
  expect(acks).toHaveLength(1);
});

test("the idempotency header identifies the delivery to the target", async () => {
  let seen: string | null | undefined;
  await target.stop(true);
  target = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      seen = request.headers.get("x-pwr-delivery-id");
      return new Response("ok");
    },
  });
  await forwardRelayPackage(packet("idem"), `http://127.0.0.1:${target.port}/hook`, "default");
  expect(seen).toBe("idem");
});

test("database, WAL and SHM files are private to the OS user", () => {
  localDb.run("INSERT INTO local_relay_keys VALUES ('http://perm', 'slug', 'k')");
  for (const path of [agentDbFile, `${agentDbFile}-wal`, `${agentDbFile}-shm`])
    expect(statSync(path).mode & 0o077).toBe(0);
  expect(statSync(join(agentDbFile, "..")).mode & 0o077).toBe(0);
});

test("a second agent on the same data directory refuses to start", async () => {
  const entry = join(import.meta.dir, "../../index.ts");
  const env = { ...process.env, NODE_ENV: "development", AGENT_DB_FILE_NAME: agentDbFile };
  const first = Bun.spawn([process.execPath, entry], {
    env: { ...env, PWR_AGENT_PORT: "18991" },
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    // Wait for the first daemon to hold the lock and serve.
    for (let i = 0; i < 50; i += 1) {
      if ((await fetch("http://127.0.0.1:18991/health").catch(() => null))?.ok) break;
      await Bun.sleep(100);
    }
    const second = Bun.spawn([process.execPath, entry], {
      env: { ...env, PWR_AGENT_PORT: "18992" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await second.exited).toBe(1);
    expect(await new Response(second.stderr).text()).toContain("Another pwr-agent");
  } finally {
    first.kill("SIGTERM");
    await first.exited;
  }
}, 15_000);
