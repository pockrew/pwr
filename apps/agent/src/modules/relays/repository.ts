import { db } from "@agent/db/client";
import { localRelaySessions, localRelayPackages as packages } from "@agent/db/schemas/relays";
import { localEvents } from "@agent/db/schemas/storage";
import { getConfig } from "@agent/modules/config/repository";
import { getEndpointTarget } from "@agent/modules/relays/credentials.repository";
import { agentDbService } from "@agent/modules/storage/repository";
import { isPrunedRelay } from "@agent/modules/storage/retention.repository";
import { ensureStorageCapacity } from "@agent/modules/storage/retention.service";
import { and, asc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import { relayPacketToEvent, replayMetadata } from "@pockrew/pwr-core";
import {
  RelayClientAckSchema,
  RelayExecutionResultSchema,
  RelayHeadersSchema,
  RelayMetadataSchema,
  RelayPackageSchema,
  type RelayClientAck,
  type RelayExecutionResult,
  type RelayPackage,
  type RelayResultConfirmation,
  type RelayScope,
  type WebhookEvent,
} from "@pockrew/pwr-shared/schemas";

/** Select one authenticated server/tunnel queue; IDs alone must not cross connection scopes. */
const inScope = (scope: RelayScope) =>
  and(eq(packages.serverUrl, scope.serverUrl), eq(packages.slug, scope.slug));

/**
 * Commit the event BLOB and package before a receipt ACK is allowed.
 * @param scope - Authenticated connection scope.
 * @param packet - Validated package, stripped of unknown fields including secrets.
 * @param projectId - Local display context.
 * @returns Cached event, or null for a retained tombstone; throws on collisions, capacity or DB failure.
 */
export const receiveRelayPackage = (
  scope: RelayScope,
  packet: RelayPackage,
  projectId: string,
): WebhookEvent | null => {
  // Capacity cleanup runs before the transaction. Existing durable IDs can still ACK while full.
  if (isPrunedRelay(scope, packet)) return null;
  if (
    !db
      .select({ id: packages.id })
      .from(packages)
      .where(and(eq(packages.serverUrl, scope.serverUrl), eq(packages.id, packet.id)))
      .get()
  )
    ensureStorageCapacity(Buffer.byteLength(JSON.stringify(packet)));
  return db.transaction((tx) => {
    // Recheck inside the snapshot in case another daemon pruned between admission and BEGIN.
    if (isPrunedRelay(scope, packet)) return null;
    // 1. Keep one immutable original BLOB shared by all endpoint deliveries and replays.
    // An old server may still send its ingress credential; it is not provider event data.
    const headers = RelayHeadersSchema.parse(JSON.parse(packet.headers));
    for (const name of Object.keys(headers))
      if (name.toLowerCase() === "x-api-key") delete headers[name];
    // The target is resolved from agent-owned config at execution time, never from the server.
    const storedPacket = { ...packet, headers: JSON.stringify(headers) };
    const event = relayPacketToEvent(storedPacket, projectId);
    const existing = agentDbService.getEventById(packet.eventId);
    if (
      existing &&
      (existing.tunnelId !== packet.tunnelId ||
        existing.method !== packet.method ||
        JSON.stringify(existing.headers) !== JSON.stringify(event.headers) ||
        (existing.rawPayloadBase64 ?? "") !== packet.payloadBase64)
    )
      throw new Error("Relay event ID conflicts with local data");
    // Both repositories use the same SQLite connection, so these writes join this transaction.
    if (!existing) agentDbService.saveEvent(event);
    // 2. A retransmitted delivery must never overwrite completed local execution state.
    const previous = tx
      .select()
      .from(packages)
      .where(and(eq(packages.serverUrl, scope.serverUrl), eq(packages.id, packet.id)))
      .get();
    if (
      previous &&
      (previous.slug !== scope.slug ||
        previous.eventId !== packet.eventId ||
        RelayMetadataSchema.parse(JSON.parse(previous.metadata)).endpointId !== packet.endpointId)
    )
      throw new Error("Relay delivery ID conflicts with local data");
    tx.insert(packages)
      .values({
        ...scope,
        id: packet.id,
        eventId: packet.eventId,
        metadata: JSON.stringify(RelayMetadataSchema.parse(storedPacket)),
        projectId,
        completed: packet.relayStatus !== null,
        completedAt: packet.relayStatus !== null ? Date.now() : null,
        createdAt: Date.now(),
      })
      .onConflictDoNothing()
      .run();
    return event;
  });
};

/**
 * Load one package and the original BLOB, never an entire payload backlog.
 * @param scope - Authenticated server/tunnel scope.
 * @param id - Delivery or replay ID.
 * @returns Package, project and durable result/ACK, or null. Corrupt rows fail closed.
 */
export const getRelayPackage = (scope: RelayScope, id: string) => {
  // 1. Join just one event payload to its delivery metadata.
  const row = db
    .select({
      metadata: packages.metadata,
      payload: localEvents.payload,
      projectId: packages.projectId,
      ack: packages.ack,
      result: packages.result,
      reportedAt: packages.reportedAt,
    })
    .from(packages)
    .innerJoin(localEvents, eq(localEvents.id, packages.eventId))
    .where(and(inScope(scope), eq(packages.id, id)))
    .get();
  if (!row) return null;
  // 2. Rebuild bytes from the BLOB. Earlier result JSON omitted ID; the row already owns it.
  const result =
    row.result === null
      ? null
      : RelayExecutionResultSchema.omit({ id: true }).strip().parse(JSON.parse(row.result));
  return {
    packet: RelayPackageSchema.parse({
      ...RelayMetadataSchema.parse(JSON.parse(row.metadata)),
      payloadBase64: Buffer.from(row.payload ?? []).toString("base64"),
    }),
    projectId: row.projectId,
    ack: row.ack === null ? null : RelayClientAckSchema.parse(JSON.parse(row.ack)),
    result: result === null ? null : { ...result, id },
    reportedAt: row.reportedAt,
  };
};

/**
 * A local pause/disable, or a missing agent-owned target, holds unfinished work without mutating
 * its stored payload; setting a target later releases it.
 */
const canExecute = (scope: RelayScope, metadata: string): boolean => {
  const packet = RelayMetadataSchema.parse(JSON.parse(metadata));
  if (getEndpointTarget(scope, packet.endpointId) === null) return false;
  const endpoint = getConfig(scope, "endpoint", packet.endpointId)?.value;
  if (!endpoint || endpoint.kind !== "endpoint") return true;
  // Deleting server config stops new dispatch, not a package already handed to this agent.
  if (endpoint.deleted) return true;
  if (!endpoint.isActive || endpoint.isPaused) return false;
  const collection = getConfig(scope, "collection", endpoint.collectionId)?.value;
  return (
    !collection || collection.deleted || (collection.kind === "collection" && collection.isActive)
  );
};

/** Select the oldest runnable local delivery, skipping paused siblings without loading BLOBs. */
export const nextRelayPackage = (scope: RelayScope): string | undefined => {
  let cursor = 0;
  while (true) {
    const page = db
      .select({ id: packages.id, metadata: packages.metadata, sequence: sql<number>`rowid` })
      .from(packages)
      .where(and(inScope(scope), eq(packages.completed, false), gt(sql`rowid`, cursor)))
      .orderBy(sql`rowid`)
      .limit(100)
      .all();
    for (const row of page) if (canExecute(scope, row.metadata)) return row.id;
    if (page.length < 100) return undefined;
    const last = page.at(-1);
    if (!last) return undefined;
    cursor = last.sequence;
  }
};

/**
 * Commit the first target result, audit row and retransmittable ACK atomically.
 * @param scope - Local server/tunnel scope.
 * @param id - Stable delivery/replay ID shared with server history.
 * @param result - Target result excluding request secrets.
 * @param ack - Separate relay or replay result ACK.
 * @throws On missing rows, invalid results or failed persistence; rollback leaves work pending.
 */
export const completeRelayPackage = (
  scope: RelayScope,
  id: string,
  result: RelayExecutionResult,
  ack: RelayClientAck,
): void => {
  // 1. Validate before changing either audit history or queue state.
  const encoded = JSON.stringify(RelayClientAckSchema.parse(ack));
  const savedResult = RelayExecutionResultSchema.parse(result);
  if (
    savedResult.id !== id ||
    ack.type === "ack_received" ||
    (ack.type === "ack_replayed" ? ack.replayId : ack.deliveryId) !== id
  )
    throw new Error("Relay result identity mismatch");
  db.transaction((tx) => {
    const row = tx
      .select({ completed: packages.completed })
      .from(packages)
      .where(and(inScope(scope), eq(packages.id, id)))
      .get();
    if (!row) throw new Error("Stored relay package is unavailable");
    if (row.completed) return;
    // 2. Use the same SQLite connection for audit and ACK, preserving the first completed attempt.
    agentDbService.saveDelivery(savedResult);
    tx.update(packages)
      .set({
        completed: true,
        completedAt: Date.now(),
        ack: encoded,
        result: JSON.stringify(savedResult),
      })
      .where(and(inScope(scope), eq(packages.id, id)))
      .run();
    if (ack.type === "ack_replayed") agentDbService.incrementReplayCount(result.webhookId);
  });
};

/**
 * Read a bounded result-report page without BLOBs or endpoint credentials.
 * @param scope - Authenticated scope.
 * @param after - Exclusive SQLite row cursor; insertion order keeps replay parents before children.
 * @param unreportedOnly - Transport retries omit confirmed results but repeat unfinished live receipts.
 * @returns Up to 50 exact persisted ACKs; database errors propagate.
 */
export const relayReports = (scope: RelayScope, after = 0, unreportedOnly = false) =>
  db
    .select({
      id: packages.id,
      ack: sql<string>`coalesce(${packages.ack}, json_object('type', 'ack_received', 'deliveryId', ${packages.id}))`,
      sequence: sql<number>`rowid`,
    })
    .from(packages)
    .where(
      and(
        inScope(scope),
        unreportedOnly
          ? or(
              and(
                eq(packages.completed, false),
                sql`json_extract(${packages.metadata}, '$.trigger') = 'live'`,
              ),
              isNotNull(packages.ack),
              sql`json_extract(${packages.metadata}, '$.relayStatus') IS NOT NULL`,
            )
          : and(eq(packages.completed, true), isNotNull(packages.ack)),
        unreportedOnly ? isNull(packages.reportedAt) : undefined,
        gt(sql`rowid`, after),
      ),
    )
    .orderBy(sql`rowid`)
    .limit(50)
    .all();

/**
 * Save server commit confirmation for this authenticated scope only, never on a successful send.
 * @param id - Live delivery or independent replay result ID from result_committed.
 * @returns Nothing. Unknown/pending IDs are ignored; storage errors propagate and preserve the ACK.
 */
export const markRelayReported = (
  scope: RelayScope,
  id: string,
  source: RelayResultConfirmation["source"] = "result",
): void => {
  db.update(packages)
    .set({ reportedAt: Date.now() })
    .where(
      and(
        inScope(scope),
        eq(packages.id, id),
        eq(packages.completed, true),
        isNull(packages.reportedAt),
        source === "result"
          ? isNotNull(packages.ack)
          : and(
              isNull(packages.ack),
              sql`json_extract(${packages.metadata}, '$.relayStatus') IS NOT NULL`,
            ),
      ),
    )
    .run();
};

/**
 * Resolve one explicit replay source; an event with multiple targets needs a delivery ID.
 * @param id - Delivery ID or unambiguous event ID.
 * @param scope - Optional resolved server/slug scope; a different session cannot select this ID.
 * @param projectId - Optional local project filter applied before ambiguity detection.
 * @returns Scoped source; throws when absent or ambiguous.
 */
export const findReplaySource = (id: string, scope?: RelayScope, projectId?: string) => {
  const rows = db
    .select({ id: packages.id, serverUrl: packages.serverUrl, slug: packages.slug })
    .from(packages)
    .where(
      and(
        scope ? inScope(scope) : undefined,
        projectId ? eq(packages.projectId, projectId) : undefined,
        or(
          eq(packages.id, id),
          and(
            eq(packages.eventId, id),
            sql`json_extract(${packages.metadata}, '$.trigger') = 'live'`,
          ),
        ),
      ),
    )
    .limit(2)
    .all();
  const row = rows[0];
  if (!row) throw new HTTPException(404);
  if (rows.length !== 1) throw new HTTPException(409, { message: "Select one delivery ID" });
  return { scope: { serverUrl: row.serverUrl, slug: row.slug }, id: row.id };
};

/**
 * Save a distinct pending replay before the target can observe it.
 * @param scope - Server/tunnel owning the source.
 * @param sourceId - Delivery ID, including an earlier replay if explicitly selected.
 * @returns New UUID shared by local and server records; throws on missing source or DB failure.
 */
export const createLocalReplay = (scope: RelayScope, sourceId: string): string => {
  // Cleanup may remove an eligible source; re-read it afterwards instead of creating an orphan replay.
  const metadata = db
    .select({ value: packages.metadata })
    .from(packages)
    .where(and(inScope(scope), eq(packages.id, sourceId)))
    .get()?.value;
  ensureStorageCapacity(Buffer.byteLength(metadata ?? ""));
  return db.transaction(() => {
    // 1. Reference the original event and endpoint; retain the byte-exact payload in local_events.
    const source = getRelayPackage(scope, sourceId);
    if (!source) throw new HTTPException(404, { message: "Replay source is no longer available" });
    // Replays use the endpoint's current agent-owned target; never mutate the source package.
    if (getEndpointTarget(scope, source.packet.endpointId) === null)
      throw new HTTPException(409, { message: "Set a local target for this endpoint first" });
    const endpoint = getConfig(scope, "endpoint", source.packet.endpointId)?.value;
    if (endpoint?.kind === "endpoint") {
      const parent = getConfig(scope, "collection", endpoint.collectionId)?.value;
      if (endpoint.deleted || !endpoint.isActive || !parent || parent.deleted || !parent.isActive)
        throw new Error("Replay endpoint or collection is unavailable locally");
    }
    const id = crypto.randomUUID();
    // 2. Commit a new UUID before execution; retransmitting its ACK never generates another row.
    db.insert(packages)
      .values({
        ...scope,
        id,
        eventId: source.packet.eventId,
        metadata: JSON.stringify(replayMetadata(source.packet, id)),
        projectId: source.projectId,
        createdAt: Date.now(),
      })
      .run();
    return id;
  });
};

/**
 * List delivery identities/results so callers can choose the correct fanout target for replay.
 * @param eventId - Locally stored original event ID.
 * @param scope - Optional server/slug boundary.
 * @param projectId - Optional local project filter.
 * @param limit - Requested page size, capped at 100, plus one lookahead record.
 * @param cursor - Exclusive delivery ID in ascending order.
 * @returns Bounded metadata only, never payloads or credentials; database errors propagate.
 */
export const listRelayDeliveries = (
  eventId: string,
  scope?: RelayScope,
  projectId?: string,
  limit = 100,
  cursor?: string,
) =>
  db
    .select({
      id: packages.id,
      serverUrl: packages.serverUrl,
      slug: packages.slug,
      metadata: packages.metadata,
      completed: packages.completed,
      completedAt: packages.completedAt,
      reportedAt: packages.reportedAt,
      result: packages.result,
    })
    .from(packages)
    .where(
      and(
        eq(packages.eventId, eventId),
        scope ? inScope(scope) : undefined,
        projectId ? eq(packages.projectId, projectId) : undefined,
        cursor ? gt(packages.id, cursor) : undefined,
      ),
    )
    .orderBy(asc(packages.id))
    .limit(Math.min(limit, 100) + 1)
    .all()
    .map((row) => {
      const metadata = RelayMetadataSchema.parse(JSON.parse(row.metadata));
      const result =
        row.result === null
          ? null
          : {
              ...RelayExecutionResultSchema.omit({ id: true })
                .strip()
                .parse(JSON.parse(row.result)),
              id: row.id,
            };
      return {
        id: row.id,
        endpointId: metadata.endpointId,
        // Executed work reports where it went; pending work shows its current agent-owned target.
        localTarget:
          result?.targetUrl ??
          getEndpointTarget({ serverUrl: row.serverUrl, slug: row.slug }, metadata.endpointId),
        trigger: metadata.trigger,
        replayOfDeliveryId: metadata.replayOfDeliveryId,
        completed: row.completed,
        completedAt: row.completedAt,
        reportedAt: row.reportedAt,
        result,
      };
    });

/**
 * Persist connection intent, replacing an older alias of the same server/tunnel.
 * @param session - Local resume state, never credentials.
 * @throws On persistence failure; callers must not start a socket before this commits.
 */
export const saveRelaySession = (session: typeof localRelaySessions.$inferInsert): void => {
  db.transaction((tx) => {
    // 1. A caller-facing alias can move to another server/tunnel without a unique-key conflict.
    tx.delete(localRelaySessions).where(eq(localRelaySessions.tunnelId, session.tunnelId)).run();
    // 2. Preserve one resumable session per authenticated scope.
    tx.insert(localRelaySessions)
      .values(session)
      .onConflictDoUpdate({
        target: [localRelaySessions.serverUrl, localRelaySessions.slug],
        set: session,
      })
      .run();
  });
};

/**
 * Read persisted sessions for restart recovery or offline inspection.
 * @param enabledOnly - True for startup; false includes explicitly disconnected sessions.
 * @returns Saved metadata without credentials; database errors propagate.
 */
export const savedRelaySessions = (enabledOnly = true) =>
  db
    .select()
    .from(localRelaySessions)
    .where(enabledOnly ? eq(localRelaySessions.enabled, true) : undefined)
    .all();

/** Read persisted session metadata by local alias, including explicitly disconnected sessions. */
export const savedRelaySession = (tunnelId: string) =>
  db.select().from(localRelaySessions).where(eq(localRelaySessions.tunnelId, tunnelId)).get();

/**
 * Update durable connection intent before changing its in-memory state.
 * @param tunnelId - Caller-facing local alias.
 * @param changes - Pause/resume or explicit disconnect state.
 * @throws On database failure.
 */
export const updateRelaySession = (
  tunnelId: string,
  changes: { isPaused?: boolean; enabled?: boolean },
): void => {
  db.update(localRelaySessions).set(changes).where(eq(localRelaySessions.tunnelId, tunnelId)).run();
};
