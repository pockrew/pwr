import { db, localDb } from "@agent/db/client";
import { localConfig, localEndpointSecrets, localRelayKeys } from "@agent/db/schemas";
import { setEndpointTarget } from "@agent/modules/relays/credentials.repository";
import {
  completeRelayPackage,
  createLocalReplay,
  getRelayPackage,
  markRelayReported,
  nextRelayPackage,
  receiveRelayPackage,
  relayReports,
} from "@agent/modules/relays/repository";
import { afterEach, beforeEach, expect, jest, test } from "bun:test";

import { loadTomlConfig, RELAY_DEDUPE_DAYS, saveTomlConfig } from "@pockrew/pwr-core";
import { RelayPackageSchema } from "@pockrew/pwr-shared/schemas";

import {
  getStorageStatus,
  noteStorageWriteFailure,
  runRetention,
  startRetentionTimer,
} from "./retention.service";

const scope = { serverUrl: "http://retention.test", slug: "retention" };
const originalConfig = loadTomlConfig();
const day = 86_400_000;
const packet = (id: string, eventId = id, body = Buffer.from([0, 255, 13, 10])) =>
  RelayPackageSchema.parse({
    id,
    eventId,
    endpointId: "endpoint",
    tunnelId: "tunnel",
    trigger: "live",
    replayOfDeliveryId: null,
    relayStatus: null,
    method: "POST",
    contentType: "application/octet-stream",
    payloadBase64: body.toString("base64"),
    headers: "{}",
    queryParams: "{}",
    rawQuery: null,
    eventReceivedAt: new Date().toISOString(),
  });
const finish = (id: string, confirmed = true) => {
  const stored = getRelayPackage(scope, id);
  if (!stored) throw new Error("Missing fixture package");
  completeRelayPackage(
    scope,
    id,
    {
      id,
      webhookId: stored.packet.eventId,
      tunnelId: "tunnel",
      orgId: "default",
      projectId: "default",
      targetUrl: "http://127.0.0.1:1234",
      statusCode: 200,
      latencyMs: 1,
      deliveredAt: Date.now(),
    },
    stored.packet.trigger === "replay"
      ? {
          type: "ack_replayed",
          deliveryId: stored.packet.replayOfDeliveryId ?? "",
          replayId: id,
          status: "SUCCESS",
        }
      : { type: "ack_relayed", deliveryId: id, status: "SUCCESS" },
  );
  if (confirmed) markRelayReported(scope, id);
};
const age = (id: string) =>
  localDb.run("UPDATE local_relay_packages SET completed_at = ? WHERE id = ?", [
    Date.now() - 8 * day,
    id,
  ]);
const setPolicy = (patch: Partial<typeof originalConfig.retention>) =>
  saveTomlConfig({
    ...originalConfig,
    retention: { maxEvents: 1000, retentionDays: 7, maxDbSizeMb: 50, autoVacuum: true, ...patch },
  });

beforeEach(() => {
  setPolicy({});
  for (const table of [
    "local_relay_packages",
    "local_relay_tombstones",
    "local_events",
    "local_deliveries",
    "local_config",
    "local_relay_keys",
    "local_endpoint_secrets",
    "local_endpoint_targets",
  ])
    localDb.run(`DELETE FROM ${table}`);
  setEndpointTarget(scope, "endpoint", "http://127.0.0.1:1234");
  runRetention();
});
afterEach(() => {
  jest.useRealTimers();
  localDb.run("DROP TRIGGER IF EXISTS reject_history_delete");
  saveTomlConfig(originalConfig);
});

test("only confirmed terminal leaves prune; pending reports, replay descendants and fanout retain the BLOB", () => {
  receiveRelayPackage(scope, packet("live", "shared"), "default");
  receiveRelayPackage(scope, packet("sibling", "shared"), "default");
  finish("live");
  age("live");
  const child = createLocalReplay(scope, "live");
  finish(child);
  age(child);
  const grandchild = createLocalReplay(scope, child);
  finish(grandchild, false);
  age(grandchild);
  // Neither a confirmation from another scope nor confirmation of a pending receipt is usable.
  markRelayReported({ ...scope, slug: "other" }, grandchild);
  markRelayReported(scope, "sibling");
  expect(runRetention().deletedPackages).toBe(0);
  expect(getStorageStatus()).toMatchObject({ pendingPackages: 1, unreportedResults: 1 });
  // The unfinished sibling repeats only its durable receipt; the grandchild repeats its result.
  expect(relayReports(scope, 0, true).map((row) => row.id)).toEqual(["sibling", grandchild]);
  markRelayReported(scope, grandchild);
  expect(runRetention()).toMatchObject({ deletedPackages: 3, deletedEvents: 0 });
  expect(getRelayPackage(scope, "sibling")?.packet.payloadBase64).toBe(
    Buffer.from([0, 255, 13, 10]).toString("base64"),
  );
  expect(nextRelayPackage(scope)).toBe("sibling");
  finish("sibling");
  age("sibling");
  expect(runRetention()).toMatchObject({ deletedPackages: 1, deletedEvents: 1 });
  expect(localDb.query("SELECT * FROM local_deliveries").all()).toHaveLength(0);
  expect(getStorageStatus().tombstones).toBe(4);
});

test("receipt recovery cannot confirm a different local result, and imported terminal copies never execute", () => {
  receiveRelayPackage(scope, packet("local-result"), "default");
  finish("local-result", false);
  markRelayReported(scope, "local-result", "receipt");
  expect(getRelayPackage(scope, "local-result")?.reportedAt).toBeNull();
  const recovered = { ...packet("server-result"), relayStatus: "SUCCESS" };
  receiveRelayPackage(scope, RelayPackageSchema.parse(recovered), "default");
  expect(nextRelayPackage(scope)).toBeUndefined();
  expect(relayReports(scope, 0, true).map((row) => JSON.parse(row.ack).type)).toEqual([
    "ack_relayed",
    "ack_received",
  ]);
  markRelayReported(scope, "server-result", "result");
  expect(getRelayPackage(scope, "server-result")?.reportedAt).toBeNull();
  markRelayReported(scope, "server-result", "receipt");
  expect(getRelayPackage(scope, "server-result")?.reportedAt).toBeNumber();
});

test("age/count policy is shared, manual filters never force young data, and credentials/config conflicts survive", () => {
  db.insert(localRelayKeys)
    .values({ ...scope, apiKey: "keep-key" })
    .run();
  db.insert(localEndpointSecrets)
    .values({
      ...scope,
      endpointId: "endpoint",
      headerName: "authorization",
      secret: "keep-secret",
    })
    .run();
  db.insert(localConfig)
    .values({
      ...scope,
      id: "collection",
      kind: "collection",
      data: "{}",
      dirty: true,
      conflict: "null",
    })
    .run();
  receiveRelayPackage(scope, packet("old"), "default");
  finish("old");
  localDb.run("UPDATE local_relay_packages SET created_at = ? WHERE id = 'old'", [
    Date.now() - 1000,
  ]);
  receiveRelayPackage(scope, packet("young"), "default");
  finish("young");
  expect(runRetention({ days: 1 }).deletedPackages).toBe(0);
  setPolicy({ maxEvents: 1 });
  expect(runRetention({ projects: ["unrelated"] }).deletedPackages).toBe(0);
  expect(runRetention()).toMatchObject({ deletedPackages: 1, deletedEvents: 1 });
  expect(getRelayPackage(scope, "young")).not.toBeNull();
  expect(db.select().from(localRelayKeys).get()?.apiKey).toBe("keep-key");
  expect(db.select().from(localEndpointSecrets).get()?.secret).toBe("keep-secret");
  expect(db.select().from(localConfig).get()).toMatchObject({ dirty: true, conflict: "null" });
});

test("prune commits a 30-day identity with deletion; retransmission cannot execute or resurrect its payload", () => {
  const original = packet("dedupe");
  receiveRelayPackage(scope, original, "default");
  finish(original.id);
  age(original.id);
  localDb.run(
    "CREATE TRIGGER reject_history_delete BEFORE DELETE ON local_events BEGIN SELECT RAISE(ABORT, 'test rollback'); END",
  );
  expect(() => runRetention()).toThrow();
  expect(getRelayPackage(scope, original.id)).not.toBeNull();
  expect(getStorageStatus().tombstones).toBe(0);
  localDb.run("DROP TRIGGER reject_history_delete");
  expect(runRetention().deletedPackages).toBe(1);
  const tombstone = localDb
    .query<{ expires_at: number }, []>("SELECT expires_at FROM local_relay_tombstones")
    .get();
  expect(tombstone?.expires_at).toBeGreaterThan(Date.now() + (RELAY_DEDUPE_DAYS - 1) * day);
  expect(receiveRelayPackage(scope, original, "default")).toBeNull();
  expect(localDb.query("SELECT id FROM local_events").all()).toHaveLength(0);
  expect(nextRelayPackage(scope)).toBeUndefined();
  expect(() => receiveRelayPackage({ ...scope, slug: "different" }, original, "default")).toThrow();
  localDb.run("UPDATE local_relay_tombstones SET expires_at = ?", [Date.now() - 1]);
  runRetention();
  expect(getStorageStatus().tombstones).toBe(0);
});

test("disk pressure preserves unreported data, permits duplicate receipts, and resumes after safe cleanup", () => {
  const diskError = Object.assign(new Error("disk full"), { code: "SQLITE_FULL" });
  noteStorageWriteFailure(new Error("wrapped query failure", { cause: diskError }));
  expect(getStorageStatus()).toMatchObject({ state: "blocked", reason: "write_failed" });
  runRetention();
  const original = packet("large", "large", Buffer.alloc(600 * 1024, 255));
  receiveRelayPackage(scope, original, "default");
  finish(original.id, false);
  age(original.id);
  setPolicy({ maxDbSizeMb: 1 });
  // Sized to fit 1 MiB only once the confirmed 600 KiB event is pruned (incremental auto_vacuum
  // adds a pointer-map page, so leave a few KiB of headroom).
  const incoming = packet("incoming", "incoming", Buffer.alloc(190 * 1024));
  expect(() => receiveRelayPackage(scope, incoming, "default")).toThrow(
    "Local relay storage is full",
  );
  expect(getStorageStatus()).toMatchObject({
    state: "blocked",
    reason: "capacity",
    unreportedResults: 1,
  });
  expect(getRelayPackage(scope, incoming.id)).toBeNull();
  expect(getRelayPackage(scope, original.id)?.packet.payloadBase64).toBe(original.payloadBase64);
  expect(receiveRelayPackage(scope, original, "default")).not.toBeNull();
  expect(() => createLocalReplay(scope, original.id)).toThrow();
  // Reporting is deliberately allowed while full; confirmation can unlock eligible history.
  markRelayReported(scope, original.id);
  expect(runRetention()).toMatchObject({ deletedPackages: 1, storage: { state: "ready" } });
  expect(receiveRelayPackage(scope, original, "default")).toBeNull();
  expect(receiveRelayPackage(scope, incoming, "default")).not.toBeNull();
  expect(nextRelayPackage(scope)).toBe(incoming.id);
});

test("periodic cleanup uses the same policy and its stop callback prevents later sweeps", () => {
  receiveRelayPackage(scope, packet("timer"), "default");
  finish("timer");
  age("timer");
  let sweeps = 0;
  jest.useFakeTimers();
  const stop = startRetentionTimer(() => {
    sweeps++;
  });
  jest.advanceTimersByTime(60_000);
  expect(sweeps).toBe(1);
  expect(getRelayPackage(scope, "timer")).toBeNull();
  stop();
  jest.advanceTimersByTime(120_000);
  expect(sweeps).toBe(1);
});
