import { afterAll, beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";

import { app } from "@pockrew/pwr-agent/app";
import { saveRelaySession } from "@pockrew/pwr-agent/testing";

const tunnelId = `cli-config-${crypto.randomUUID().slice(0, 8)}`;
const server = Bun.serve({ port: 0, fetch: app.fetch });
const port = server.port ?? 0;
const entry = resolve(import.meta.dir, "../index.ts");

beforeAll(() => {
  saveRelaySession({
    tunnelId,
    serverUrl: "http://127.0.0.1:1",
    slug: tunnelId,
    enabled: false,
  });
});
afterAll(() => server.stop(true));

/** Exercise the public CLI against real Agent routes; no config DB access occurs in the CLI. */
const run = async (args: string[], stdin?: string) => {
  const child = Bun.spawn([process.execPath, entry, ...args, "--port", String(port)], {
    stdin: stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (stdin !== undefined && child.stdin) {
    child.stdin.write(stdin);
    child.stdin.end();
  }
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, data: stdout ? JSON.parse(stdout) : null, stderr };
};

test("pwr forwards collection, endpoint, conflict and secret commands to the Agent", async () => {
  const collection = await run(["collections", "create", tunnelId, "payments"]);
  expect(collection.code).toBe(0);
  const collectionId = typeof collection.data?.id === "string" ? collection.data.id : "";
  const fetchedCollection = await run(["collections", "get", tunnelId, collectionId]);
  expect(fetchedCollection.data.id).toBe(collectionId);

  const listed = await run(["collections", "list", tunnelId]);
  expect(
    listed.data.items.some((item: { value: { id: string } }) => item.value.id === collectionId),
  ).toBe(true);
  const updated = await run(["collections", "update", tunnelId, collectionId, "--active", "false"]);
  expect(updated.data.isActive).toBe(false);
  const restored = await run(["collections", "update", tunnelId, collectionId, "--active", "true"]);
  expect(restored.data.isActive).toBe(true);

  const endpoint = await run([
    "endpoints",
    "create",
    tunnelId,
    collectionId,
    "--path",
    "/hooks/payment",
    "--target",
    "http://127.0.0.1:3000/webhook",
  ]);
  expect(endpoint.code).toBe(0);
  const endpointId = typeof endpoint.data?.id === "string" ? endpoint.data.id : "";
  const fetchedEndpoint = await run(["endpoints", "get", tunnelId, collectionId, endpointId]);
  expect(fetchedEndpoint.data.id).toBe(endpointId);
  const endpointList = await run(["endpoints", "list", tunnelId]);
  expect(
    endpointList.data.items.some((item: { value: { id: string } }) => item.value.id === endpointId),
  ).toBe(true);
  const edited = await run([
    "endpoints",
    "update",
    tunnelId,
    collectionId,
    endpointId,
    "--target",
    "http://127.0.0.1:4000/webhook",
    "--paused",
    "true",
  ]);
  expect(edited.data.localTarget).toBe("http://127.0.0.1:4000/webhook");
  expect(edited.data.isPaused).toBe(true);

  // Target and secret travel in one request; the secret comes only from stdin.
  const withSecret = await run(
    [
      "endpoints",
      "update",
      tunnelId,
      collectionId,
      endpointId,
      "--target",
      "http://127.0.0.1:5000/webhook",
      "--secret",
      "-",
      "--header",
      "x-endpoint-key",
    ],
    "endpoint-private-key\n",
  );
  expect(withSecret.code).toBe(0);
  expect(withSecret.data.localTarget).toBe("http://127.0.0.1:5000/webhook");
  expect(JSON.stringify(withSecret.data)).not.toContain("endpoint-private-key");
  const endpointSecret = await run(["secrets", "status", tunnelId, collectionId, endpointId]);
  expect(endpointSecret.data).toEqual({ configured: true, headerName: "x-endpoint-key" });
  const argvSecret = await run([
    "endpoints",
    "update",
    tunnelId,
    collectionId,
    endpointId,
    "--secret",
    "in-argv",
  ]);
  expect(argvSecret.code).toBe(1);
  expect(argvSecret.stderr).toContain("--secret -");

  const set = await run(
    ["secrets", "set", tunnelId, collectionId, endpointId, "--header", "x-target-key"],
    "very-private-key\n",
  );
  expect(set.code).toBe(0);
  expect(set.data).toEqual({ configured: true, headerName: "x-target-key" });
  expect(JSON.stringify(set.data)).not.toContain("very-private-key");
  const status = await run(["secrets", "status", tunnelId, collectionId, endpointId]);
  expect(status.data.configured).toBe(true);
  const removed = await run(["secrets", "delete", tunnelId, collectionId, endpointId]);
  expect(removed.data.configured).toBe(false);

  const relaySet = await run(["secrets", "relay", "set", tunnelId], "relay-key-private\n");
  expect(relaySet.code).toBe(0);
  expect(relaySet.data).toEqual({ configured: true });
  expect(JSON.stringify(relaySet.data)).not.toContain("relay-key-private");
  const relayStatus = await run(["secrets", "relay", "status", tunnelId]);
  expect(relayStatus.data.configured).toBe(true);
  const relayRemoved = await run(["secrets", "relay", "delete", tunnelId]);
  expect(relayRemoved.data.configured).toBe(false);

  // No conflict exists yet; the Agent rejects resolution instead of inventing a local outcome.
  const unresolved = await run([
    "collections",
    "resolve",
    tunnelId,
    collectionId,
    "--choice",
    "local",
  ]);
  expect(unresolved.code).toBe(1);
  expect(unresolved.stderr).toContain("HTTP 409");
});

test("removed project switch and invalid management inputs fail before mutation", async () => {
  const legacy = Bun.spawnSync([process.execPath, entry, "project", "switch", "other"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(legacy.exitCode).toBe(1);
  expect(new TextDecoder().decode(legacy.stderr)).toContain("Unknown command");
  const invalid = Bun.spawnSync(
    [process.execPath, entry, "collections", "update", tunnelId, "id", "--active", "perhaps"],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(invalid.exitCode).toBe(1);
  expect(new TextDecoder().decode(invalid.stderr)).toContain("true or false");
});
