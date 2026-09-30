import { getLogger } from "@logtape/logtape";
import { db } from "@server/db/client";
import { collections, endpoints, webhookDeliveries, webhookEvents } from "@server/db/schemas";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { normalizeEndpointPath } from "@pockrew/pwr-core";
import { RelayClientAckSchema, type RelayClientAck } from "@pockrew/pwr-shared/schemas";

const logger = getLogger(["pwr", "server", "relay"]);

type PreparableEvent = Pick<
  typeof webhookEvents.$inferSelect,
  "id" | "tunnelId" | "collectionId" | "endpointPath"
>;

/** Create one PENDING live delivery per matching endpoint; paused targets are included for later sync. */
const createDeliveryPackages = (
  tx: Pick<typeof db, "select" | "insert">,
  event: PreparableEvent,
) => {
  const path = event.endpointPath ? normalizeEndpointPath(event.endpointPath) : undefined;
  const targets = tx
    .select({ id: endpoints.id })
    .from(endpoints)
    .innerJoin(collections, eq(endpoints.collectionId, collections.id))
    .where(
      and(
        eq(collections.tunnelId, event.tunnelId),
        event.collectionId ? eq(collections.id, event.collectionId) : undefined,
        path ? or(eq(endpoints.pathName, path), eq(endpoints.pathName, `/${path}`)) : undefined,
        eq(endpoints.isActive, true),
        eq(collections.isActive, true),
        isNull(endpoints.deletedAt),
        isNull(collections.deletedAt),
      ),
    )
    .all();

  for (const target of targets) {
    tx.insert(webhookDeliveries)
      .values({
        eventId: event.id,
        trigger: "live",
        endpointId: target.id,
        status: "PENDING",
      })
      // The unique live index makes a racing recovery pass a no-op instead of a duplicate.
      .onConflictDoNothing()
      .run();
  }
};

/**
 * Create deliveries for one stored event, separately from the ingress storage transaction.
 * @returns The event's tunnel ID when newly prepared; undefined if absent or already prepared.
 */
export const prepareDelivery = (eventId: string): string | undefined =>
  db.transaction((tx) => {
    // Select routing columns only; never load the payload BLOB here.
    const event = tx
      .select({
        id: webhookEvents.id,
        tunnelId: webhookEvents.tunnelId,
        collectionId: webhookEvents.collectionId,
        endpointPath: webhookEvents.endpointPath,
      })
      .from(webhookEvents)
      .where(and(eq(webhookEvents.id, eventId), isNull(webhookEvents.deliveryPreparedAt)))
      .get();
    if (!event || (!event.collectionId && !event.endpointPath)) return;
    createDeliveryPackages(tx, event);
    tx.update(webhookEvents)
      .set({ deliveryPreparedAt: new Date() })
      .where(eq(webhookEvents.id, event.id))
      .run();
    return event.tunnelId;
  });

/** Push a failing event's next recovery attempt back exponentially (1s .. 10min). */
export const deferPreparation = (eventId: string): void => {
  db.update(webhookEvents)
    .set({
      prepareAttempts: sql`${webhookEvents.prepareAttempts} + 1`,
      nextRetryAt: sql`(unixepoch() * 1000) + min(600000, 1000 * (1 << min(${webhookEvents.prepareAttempts}, 10)))`,
    })
    .where(eq(webhookEvents.id, eventId))
    .run();
};

/** Count durable queue states without loading provider payloads or changing delivery semantics. */
export const deliveryBacklogStatus = (tunnelId: string) => {
  const events = db.get<{ unpreparedEvents: number; unmatchedEvents: number }>(sql`
    SELECT
      coalesce(sum(delivery_prepared_at IS NULL), 0) AS unpreparedEvents,
      coalesce(sum(delivery_prepared_at IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM ${webhookDeliveries} d WHERE d.event_id = e.id
      )), 0) AS unmatchedEvents
    FROM ${webhookEvents} e WHERE e.tunnel_id = ${tunnelId}
  `);
  const deliveries = db.get<{ pendingDeliveries: number; blockedDeliveries: number }>(sql`
    SELECT count(*) AS pendingDeliveries,
      coalesce(sum(ep.deleted_at IS NOT NULL OR co.deleted_at IS NOT NULL
        OR ep.is_active = 0 OR co.is_active = 0 OR ep.is_paused = 1), 0) AS blockedDeliveries
    FROM ${webhookDeliveries} d
    JOIN ${webhookEvents} e ON e.id = d.event_id
    JOIN ${endpoints} ep ON ep.id = d.endpoint_id
    JOIN ${collections} co ON co.id = ep.collection_id
    WHERE e.tunnel_id = ${tunnelId} AND d.status = 'PENDING'
  `);
  return {
    unpreparedEvents: events?.unpreparedEvents ?? 0,
    unmatchedEvents: events?.unmatchedEvents ?? 0,
    pendingDeliveries: deliveries?.pendingDeliveries ?? 0,
    blockedDeliveries: deliveries?.blockedDeliveries ?? 0,
  };
};

// Shared contract is the single source for agent and server ACK validation.
export const DeliveryAckSchema = RelayClientAckSchema;

export const findDelivery = (tunnelId: string, id: string) =>
  db
    .select({ delivery: webhookDeliveries })
    .from(webhookDeliveries)
    .innerJoin(webhookEvents, eq(webhookDeliveries.eventId, webhookEvents.id))
    .where(and(eq(webhookDeliveries.id, id), eq(webhookEvents.tunnelId, tunnelId)))
    .get()?.delivery;

const eventIdsForTunnel = (tunnelId: string) =>
  db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(eq(webhookEvents.tunnelId, tunnelId));

export const markDeliveryReceived = (tunnelId: string, deliveryId: string) =>
  db
    .update(webhookDeliveries)
    .set({
      status: "DELIVERED",
      receivedAt: new Date(),
    })
    .where(
      and(
        eq(webhookDeliveries.id, deliveryId),
        eq(webhookDeliveries.status, "PENDING"),
        inArray(webhookDeliveries.eventId, eventIdsForTunnel(tunnelId)),
      ),
    )
    .returning()
    .get();

export const markDeliveryRelayed = (
  tunnelId: string,
  ack: Extract<RelayClientAck, { type: "ack_relayed" }>,
) =>
  db
    .update(webhookDeliveries)
    .set({
      relayStatus: ack.status,
      relayedAt: new Date(),
      responseStatus: ack.responseStatus,
      latencyMs: ack.latencyMs === undefined ? undefined : Math.round(ack.latencyMs),
      responseBytes: ack.responseBytes,
    })
    .where(
      and(
        eq(webhookDeliveries.id, ack.deliveryId),
        isNull(webhookDeliveries.relayStatus),
        inArray(webhookDeliveries.eventId, eventIdsForTunnel(tunnelId)),
      ),
    )
    .returning()
    .get();

export const recordReplay = (
  tunnelId: string,
  ack: Extract<RelayClientAck, { type: "ack_replayed" }>,
) =>
  db.transaction((tx) => {
    const source = findDelivery(tunnelId, ack.deliveryId);
    if (!source) return;
    return tx
      .insert(webhookDeliveries)
      .values({
        id: ack.replayId,
        eventId: source.eventId,
        endpointId: source.endpointId,
        trigger: "replay",
        replayOfDeliveryId: source.id,
        status: "DELIVERED",
        receivedAt: new Date(),
        relayStatus: ack.status,
        relayedAt: new Date(),
        responseStatus: ack.responseStatus,
        latencyMs: ack.latencyMs === undefined ? undefined : Math.round(ack.latencyMs),
        responseBytes: ack.responseBytes,
      })
      .onConflictDoNothing({ target: webhookDeliveries.id })
      .returning()
      .get();
  });

/**
 * Commit a result and verify its persisted identity/content before confirming it to an agent.
 * @param tunnelId - Authenticated tunnel; replay parents and results must both belong to it.
 * @param ack - Unchanged relay/replay business ACK, validated at the WebSocket boundary.
 * @returns Stable result ID after commit, including identical retries following a lost receipt.
 * @throws On an invalid source or storage errors; no confirmation may follow a rollback.
 */
export const commitRelayResult = (
  tunnelId: string,
  ack: Exclude<RelayClientAck, { type: "ack_received" }>,
): string =>
  db.transaction(() => {
    // 1. Preserve first-write semantics, including an independently identified replay record.
    const source = findDelivery(tunnelId, ack.deliveryId);
    if (!source || (ack.type === "ack_relayed" && source.trigger !== "live"))
      throw new Error("Invalid result source");
    const id = ack.type === "ack_replayed" ? ack.replayId : ack.deliveryId;
    if (ack.type === "ack_relayed") markDeliveryRelayed(tunnelId, ack);
    else recordReplay(tunnelId, ack);
    // 2. An ignored duplicate insert/update is not proof of an identical committed result. The
    // first write wins; a divergent retry is logged and still confirmed so the agent stops
    // re-sending it (disconnecting here would loop and block the tunnel's whole queue).
    const saved = findDelivery(tunnelId, id);
    if (
      !saved ||
      saved.eventId !== source.eventId ||
      saved.endpointId !== source.endpointId ||
      (ack.type === "ack_replayed" &&
        (saved.trigger !== "replay" || saved.replayOfDeliveryId !== source.id)) ||
      saved.relayStatus !== ack.status ||
      saved.responseStatus !== (ack.responseStatus ?? null)
    )
      logger.warning("Ignored conflicting result for {deliveryId} on tunnel {tunnelId}", {
        deliveryId: id,
        tunnelId,
      });
    return id;
  });
