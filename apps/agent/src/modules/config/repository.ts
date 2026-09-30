import { db } from "@agent/db/client";
import {
  localRelaySessions,
  localConfig as records,
  localConfigState as states,
} from "@agent/db/schemas";
import {
  deleteEndpointLocalState,
  getEndpointTarget,
} from "@agent/modules/relays/credentials.repository";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import { sameConfig } from "@pockrew/pwr-core";
import {
  ConfigDocumentSchema,
  type ConfigDocument,
  type ConfigKind,
  type ConfigMutationResult,
  type ConfigResolution,
  type LocalConfigEntry,
  type RelayScope,
} from "@pockrew/pwr-shared/schemas";

const inScope = (scope: RelayScope) =>
  and(eq(records.serverUrl, scope.serverUrl), eq(records.slug, scope.slug));
const identity = (scope: RelayScope, kind: ConfigKind, id: string) =>
  and(inScope(scope), eq(records.kind, kind), eq(records.id, id));
const stateScope = (scope: RelayScope) =>
  and(eq(states.serverUrl, scope.serverUrl), eq(states.slug, scope.slug));
const decode = (encoded: string | null) =>
  encoded === null ? null : ConfigDocumentSchema.nullable().parse(JSON.parse(encoded));

/**
 * Read the saved session even after disconnect/restart; no server request is made.
 * @param tunnelId - Caller-facing local session alias.
 * @returns Persisted server/slug scope; throws 404 if absent, or propagates DB errors.
 */
export const configScope = (tunnelId: string): RelayScope => {
  const row = db
    .select()
    .from(localRelaySessions)
    .where(eq(localRelaySessions.tunnelId, tunnelId))
    .get();
  if (!row) throw new HTTPException(404);
  return { serverUrl: row.serverUrl, slug: row.slug };
};

/**
 * Read one local record, including pending/conflict state.
 * @param scope - Saved server/slug boundary.
 * @param kind - Collection or endpoint namespace.
 * @param id - Stable local/server record ID.
 * @returns Decoded row or null; corrupt JSON and DB errors propagate.
 */
export const getConfig = (scope: RelayScope, kind: ConfigKind, id: string) => {
  const row = db
    .select()
    .from(records)
    .where(identity(scope, kind, id))
    .get();
  return row
    ? {
        ...row,
        value: ConfigDocumentSchema.parse(JSON.parse(row.data)),
        baseline: decode(row.base),
        remote: decode(row.conflict),
        hasConflict: row.conflict !== null,
      }
    : null;
};

/**
 * List at most 101 local records, including pagination lookahead, without a server connection.
 * @param scope - Saved server/slug boundary.
 * @param kind - Collection or endpoint namespace.
 * @param cursor - Exclusive record ID, omitted for the first page.
 * @returns Local values and conflict state; storage/decoding errors propagate.
 */
export const listLocalConfig = (
  scope: RelayScope,
  kind: ConfigKind,
  cursor?: string,
): LocalConfigEntry[] =>
  db
    .select()
    .from(records)
    .where(and(inScope(scope), eq(records.kind, kind), cursor ? gt(records.id, cursor) : undefined))
    .orderBy(asc(records.id))
    .limit(101)
    .all()
    .map((row) => ({
      value: ConfigDocumentSchema.parse(JSON.parse(row.data)),
      pending: row.dirty,
      hasConflict: row.conflict !== null,
      remote: decode(row.conflict),
      localTarget: kind === "endpoint" ? getEndpointTarget(scope, row.id) : null,
    }));

/**
 * Commit a validated edit and its outbox flag in one statement; preserve baseline/conflict.
 * @param scope - Saved server/slug boundary.
 * @param value - Validated config with stable ID; never contains credentials.
 * @throws Validation/storage failure; the caller must not report a successful edit.
 */
export const saveConfig = (scope: RelayScope, value: ConfigDocument): void => {
  const data = JSON.stringify(ConfigDocumentSchema.parse(value));
  db.insert(records)
    .values({ ...scope, id: value.id, kind: value.kind, data, dirty: true })
    .onConflictDoUpdate({
      target: [records.serverUrl, records.slug, records.kind, records.id],
      set: { data, dirty: true },
    })
    .run();
};

/**
 * Bind a slug once to its authenticated tunnel; reused slugs cannot receive old edits.
 * @param scope - Saved server/slug boundary.
 * @param tunnelId - Canonical ID confirmed by the authenticated WebSocket subscription.
 * @throws On changed identity or DB failure, before accepting the new socket's packages.
 */
export const bindConfigScope = (scope: RelayScope, tunnelId: string): void => {
  const row = configState(scope);
  if (row && row.tunnelId !== tunnelId) throw new Error("Remote tunnel identity changed");
  db.insert(states)
    .values({ ...scope, tunnelId })
    .onConflictDoNothing()
    .run();
};

/**
 * Read persisted sync progress for a saved scope.
 * @param scope - Saved server/slug boundary.
 * @returns Progress or undefined before the first subscription; DB errors propagate.
 */
export const configState = (scope: RelayScope) =>
  db.select().from(states).where(stateScope(scope)).get();

/**
 * Save sync outcome without remote response bodies, keys or local secrets.
 * @param scope - Bound server/slug boundary.
 * @param error - Safe error code, or null after a completed pass, even if conflicts remain.
 * @throws DB errors; failed passes leave the last successful timestamp unchanged.
 */
export const finishConfigSync = (scope: RelayScope, error: string | null): void => {
  db.update(states)
    .set({ error, ...(error === null ? { lastSyncedAt: Date.now() } : {}) })
    .where(stateScope(scope))
    .run();
};

/**
 * Page unsent edits by ID, excluding conflicts until the user resolves them.
 * @param scope - Bound server/slug boundary.
 * @param kind - Push collections before endpoints to preserve parent identity.
 * @param cursor - Exclusive ID within this pass.
 * @returns Up to 100 pending snapshots; DB/decoding errors propagate.
 */
export const pendingConfig = (scope: RelayScope, kind: ConfigKind, cursor?: string) =>
  db
    .select()
    .from(records)
    .where(
      and(
        inScope(scope),
        eq(records.kind, kind),
        eq(records.dirty, true),
        isNull(records.conflict),
        cursor ? gt(records.id, cursor) : undefined,
      ),
    )
    .orderBy(asc(records.id))
    .limit(100)
    .all()
    .map((row) => ({
      base: decode(row.base),
      value: ConfigDocumentSchema.parse(JSON.parse(row.data)),
    }));

/**
 * Merge a push response without erasing edits made while that HTTP request was in flight.
 * @param scope - Bound server/slug boundary.
 * @param sent - Exact local snapshot sent upstream; current local data may already be newer.
 * @param result - Validated server result; conflicts preserve both alternatives durably.
 * @throws On invalid acknowledgements, missing local rows or database failure.
 */
export const acknowledgeConfig = (
  scope: RelayScope,
  sent: ConfigDocument,
  result: ConfigMutationResult,
): void => {
  // 1. Re-read after the network wait so newer edits cannot be replaced by an older response.
  const current = getConfig(scope, sent.kind, sent.id);
  if (!current) throw new Error("Local config disappeared during sync");
  if (result.status === "conflict") {
    db.update(records)
      .set({ conflict: JSON.stringify(result.current) })
      .where(identity(scope, sent.kind, sent.id))
      .run();
    return;
  }
  if (!result.current || result.current.kind !== sent.kind || result.current.id !== sent.id)
    throw new Error("Invalid config acknowledgement");
  // 2. A successful push advances the baseline, but only clears exactly the edit that was sent.
  const unchanged = sameConfig(current.value, sent);
  db.update(records)
    .set({
      base: JSON.stringify(result.current),
      dirty: !unchanged,
      conflict: null,
      ...(unchanged ? { data: JSON.stringify(result.current) } : {}),
    })
    .where(identity(scope, sent.kind, sent.id))
    .run();
};

/**
 * Merge a pulled snapshot; preserve pending local edits and both versions of a conflict.
 * @param scope - Bound server/slug boundary.
 * @param value - Validated remote config or tombstone.
 * @throws DB errors; previous local data remains available if the write fails.
 */
export const acceptRemoteConfig = (scope: RelayScope, value: ConfigDocument): void => {
  // 1. Preserve pending data; divergent remote fields become a visible conflict.
  const row = getConfig(scope, value.kind, value.id);
  const data = JSON.stringify(value);
  if (row?.dirty) {
    if (row.hasConflict || (!sameConfig(row.baseline, value) && !sameConfig(row.value, value))) {
      db.update(records)
        .set({ conflict: data })
        .where(identity(scope, value.kind, value.id))
        .run();
    }
    return;
  }
  // 2. Only clean local records can be replaced by a server snapshot.
  db.insert(records)
    .values({ ...scope, kind: value.kind, id: value.id, data, base: data })
    .onConflictDoUpdate({
      target: [records.serverUrl, records.slug, records.kind, records.id],
      set: { data, base: data, dirty: false, conflict: null },
    })
    .run();
};

/**
 * Resolve a recorded conflict; later remote edits still trigger compare-and-set protection.
 * @param scope - Bound server/slug boundary.
 * @param kind - Collection or endpoint namespace.
 * @param id - Stable conflicted ID.
 * @param choice - Keep local edits for push, or explicitly accept/discard using the server version.
 * @throws 409 for missing/unresolvable conflicts; DB errors preserve the prior record.
 */
export const resolveConfig = (
  scope: RelayScope,
  kind: ConfigKind,
  id: string,
  choice: ConfigResolution,
): void => {
  const row = getConfig(scope, kind, id);
  if (!row?.hasConflict) throw new HTTPException(409, { message: "No config conflict" });
  if (choice === "server" && row.remote === null) {
    db.transaction((tx) => {
      // 1. Unsynced children of a discarded collection disappear with it, as do their local-only
      // targets and secrets; nothing else can ever reference those IDs again.
      const orphans =
        kind === "collection"
          ? tx
              .select({ id: records.id })
              .from(records)
              .where(
                and(
                  inScope(scope),
                  eq(records.kind, "endpoint"),
                  sql`json_extract(${records.data}, '$.collectionId') = ${id}`,
                  isNull(records.base),
                ),
              )
              .all()
              .map((row) => row.id)
          : [id];
      for (const endpointId of orphans) {
        deleteEndpointLocalState(scope, endpointId);
        if (endpointId !== id)
          tx.delete(records)
            .where(identity(scope, "endpoint", endpointId))
            .run();
      }
      // 2. Remove the discarded record itself.
      tx.delete(records)
        .where(identity(scope, kind, id))
        .run();
    });
    return;
  }
  if (choice === "local" && row.remote?.deleted)
    throw new HTTPException(409, {
      message: "Deleted IDs cannot be restored; create a new record",
    });
  if (choice === "local" && row.value.kind === "endpoint") {
    const parent = getConfig(scope, "collection", row.value.collectionId);
    if (!parent || parent.value.deleted)
      throw new HTTPException(409, { message: "Resolve the collection before its endpoints" });
  }
  db.update(records)
    .set({
      base: row.remote === null ? null : JSON.stringify(row.remote),
      conflict: null,
      dirty: choice === "local",
      ...(choice === "server" ? { data: JSON.stringify(row.remote) } : {}),
    })
    .where(identity(scope, kind, id))
    .run();
};
