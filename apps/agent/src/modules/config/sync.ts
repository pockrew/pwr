import { setTimeout } from "node:timers/promises";
import { relayTransportOptions } from "@agent/modules/relays/client";
import { relayApiKey } from "@agent/modules/relays/credentials.repository";
import { getLogger } from "@logtape/logtape";
import { hc } from "hono/client";
import { z } from "zod";

import type { AppType } from "@pockrew/pwr-server/rpc";
import {
  ConfigKindSchema,
  ConfigMutationResultSchema,
  ConfigPageSchema,
  type RelayScope,
} from "@pockrew/pwr-shared/schemas";

import {
  acceptRemoteConfig,
  acknowledgeConfig,
  bindConfigScope,
  finishConfigSync,
  getConfig,
  pendingConfig,
} from "./repository";

const logger = getLogger(["pwr", "agent", "config"]);

/**
 * Push durable edits, then pull bounded pages including tombstones via authenticated server RPC.
 * @param scope - Saved key/server scope, bound to the canonical tunnel from the relay handshake.
 * @param tunnelId - Authenticated canonical tunnel ID, never the local session alias.
 * @param signal - Cancels the pass on disconnect/shutdown; pending edits remain durable.
 * @throws Network, validation and persistence failures; no success timestamp is written on failure.
 */
export const syncConfig = async (
  scope: RelayScope,
  tunnelId: string,
  signal: AbortSignal,
): Promise<void> => {
  // 1. Bind once; a server reusing a slug cannot accidentally receive the old tunnel's outbox.
  bindConfigScope(scope, tunnelId);
  const rpc = hc<AppType>(scope.serverUrl, {
    headers: { "x-api-key": relayApiKey(scope) },
    fetch: (input: string | Request | URL, init?: RequestInit) =>
      fetch(input, {
        ...init,
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        ...relayTransportOptions(String(input)),
      }),
  }).api.tunnels[":tunnelId"]["config-sync"];
  // 2. Push parents first. Each UUID is retry-safe if the server commits but its response is lost.
  for (const kind of ConfigKindSchema.options) {
    let cursor: string | undefined;
    while (!signal.aborted) {
      const page = pendingConfig(scope, kind, cursor);
      if (page.length === 0) break;
      for (const mutation of page) {
        signal.throwIfAborted();
        // A new endpoint waits for its parent to sync; a parent conflict must not strand children.
        cursor = mutation.value.id;
        if (mutation.value.kind === "endpoint") {
          const parent = getConfig(scope, "collection", mutation.value.collectionId);
          // An unpublished child of a discarded/deleted parent needs an explicit local decision.
          if ((!parent || parent.value.deleted) && mutation.base === null)
            acknowledgeConfig(scope, mutation.value, { status: "conflict", current: null });
          if (parent?.dirty || !parent || parent.value.deleted) continue;
        }
        const response = await rpc.$post({ param: { tunnelId }, json: mutation });
        // A 4xx (other than auth/rate limit) is a verdict on this one record: surface it as
        // a conflict against the last known server version and keep going, so one bad edit
        // cannot block every other push and the pull phase. 5xx/network errors are transient.
        if (
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 401 &&
          response.status !== 429
        ) {
          acknowledgeConfig(scope, mutation.value, { status: "conflict", current: mutation.base });
          continue;
        }
        if (!response.ok) throw new Error(`Config push failed (${response.status})`);
        const { data } = z
          .object({ data: ConfigMutationResultSchema })
          .parse(await response.json());
        signal.throwIfAborted();
        acknowledgeConfig(scope, mutation.value, data);
      }
    }
  }
  // 3. Pull full pages each pass; no timestamp watermark can skip a concurrent edit or deletion.
  // ponytail: full paginated scans suit small tunnel configs; add a change journal if volume warrants it.
  for (const kind of ConfigKindSchema.options) {
    let cursor: string | undefined;
    do {
      signal.throwIfAborted();
      const response = await rpc.$get({
        param: { tunnelId },
        query: { kind, limit: "100", ...(cursor ? { cursor } : {}) },
      });
      if (!response.ok) throw new Error(`Config pull failed (${response.status})`);
      const { data } = z.object({ data: ConfigPageSchema }).parse(await response.json());
      signal.throwIfAborted();
      for (const value of data.items) {
        if (value.kind !== kind) throw new Error("Config page kind mismatch");
        acceptRemoteConfig(scope, value);
      }
      if (data.nextCursor && cursor && data.nextCursor <= cursor)
        throw new Error("Invalid config cursor");
      cursor = data.nextCursor ?? undefined;
    } while (cursor);
  }
  finishConfigSync(scope, null);
};

/** Start one cancellable sync loop per connected session; failures retain local data and retry. */
export const startConfigSync = (
  scope: RelayScope,
  tunnelId: string,
  onSynced: () => void = () => {},
) => {
  bindConfigScope(scope, tunnelId);
  const controller = new AbortController();
  const done = (async () => {
    while (!controller.signal.aborted) {
      try {
        await syncConfig(scope, tunnelId, controller.signal);
        if (!controller.signal.aborted) onSynced();
      } catch {
        if (controller.signal.aborted) return;
        finishConfigSync(scope, "SYNC_FAILED");
      }
      // Reconnect runs immediately; while online, polling also discovers admin/other-agent edits.
      try {
        await setTimeout(5000, undefined, { signal: controller.signal });
      } catch {
        return;
      }
    }
  })().catch(() => {
    // A local DB failure must never escape as an unhandled rejection or erase the durable outbox.
    logger.error("Sync stopped; local changes retained");
  });
  return { stop: () => controller.abort(), done };
};
