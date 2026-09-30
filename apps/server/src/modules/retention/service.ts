import { db } from "@server/db/client";
import {
  audit_logs,
  collections,
  endpoints,
  tunnels,
  webhookDeliveries,
  webhookEvents,
} from "@server/db/schemas";
import { env } from "@server/platform/env";
import { log } from "@server/platform/logger.middleware";
import { and, eq, exists, inArray, isNotNull, lt, ne, not, notExists, or, sql } from "drizzle-orm";

const DAY_MS = 24 * 60 * 60 * 1000;
// ponytail: bounded batches keep each write transaction short on the single SQLite writer; the
// 10-minute timer works through larger backlogs over several passes.
const BATCH = 500;

/** The delivery's endpoint, collection or tunnel is deleted, so it can never be sent. */
const undeliverable = () =>
  exists(
    db
      .select({ id: endpoints.id })
      .from(endpoints)
      .innerJoin(collections, eq(endpoints.collectionId, collections.id))
      .innerJoin(tunnels, eq(collections.tunnelId, tunnels.id))
      .where(
        and(
          eq(endpoints.id, webhookDeliveries.endpointId),
          or(
            isNotNull(endpoints.deletedAt),
            isNotNull(collections.deletedAt),
            isNotNull(tunnels.deletedAt),
          ),
        ),
      ),
  );

/**
 * Events whose every delivery has an agent receipt and a committed target result. A never-sent
 * delivery of a deleted endpoint does not count: it would otherwise keep its event forever.
 */
const settled = () =>
  and(
    isNotNull(webhookEvents.deliveryPreparedAt),
    notExists(
      db
        .select({ id: webhookDeliveries.id })
        .from(webhookDeliveries)
        .where(
          and(
            eq(webhookDeliveries.eventId, webhookEvents.id),
            or(
              and(eq(webhookDeliveries.status, "PENDING"), not(undeliverable())),
              and(
                ne(webhookDeliveries.status, "PENDING"),
                sql`${webhookDeliveries.relayStatus} IS NULL`,
              ),
            ),
          ),
        ),
    ),
  );

/**
 * One retention pass. Never touches events that still have pending or unconfirmed deliveries,
 * nor events not yet prepared, so no in-flight work can lose its payload.
 * 1. Drop payload BLOBs of settled events older than SERVER_RETENTION_DAYS.
 * 2. Delete settled events (and their deliveries) older than SERVER_METADATA_RETENTION_DAYS.
 * 3. Delete audit rows older than AUDIT_RETENTION_DAYS.
 * @returns Counts per step; storage errors propagate to the caller.
 */
export const runServerRetention = (now = Date.now()) => {
  const payloadCutoff = new Date(now - env.SERVER_RETENTION_DAYS * DAY_MS);
  const metadataCutoff = new Date(now - env.SERVER_METADATA_RETENTION_DAYS * DAY_MS);
  const auditCutoff = new Date(now - env.AUDIT_RETENTION_DAYS * DAY_MS);

  // 1. Payloads: the agent keeps its own copy for replay.
  const payloadIds = db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(
      and(lt(webhookEvents.receivedAt, payloadCutoff), isNotNull(webhookEvents.payload), settled()),
    )
    .limit(BATCH)
    .all()
    .map((row) => row.id);
  if (payloadIds.length > 0)
    db.update(webhookEvents)
      .set({ payload: null })
      .where(inArray(webhookEvents.id, payloadIds))
      .run();

  // 2. Metadata: deliveries (including replays, which share the event ID) go with their event.
  const eventIds = db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(and(lt(webhookEvents.receivedAt, metadataCutoff), settled()))
    .limit(BATCH)
    .all()
    .map((row) => row.id);
  if (eventIds.length > 0)
    db.transaction((tx) => {
      tx.delete(webhookDeliveries).where(inArray(webhookDeliveries.eventId, eventIds)).run();
      tx.delete(webhookEvents).where(inArray(webhookEvents.id, eventIds)).run();
    });

  // 3. Audit history.
  const auditIds = db
    .select({ id: audit_logs.id })
    .from(audit_logs)
    .where(lt(audit_logs.createdAt, auditCutoff))
    .limit(BATCH)
    .all()
    .map((row) => row.id);
  if (auditIds.length > 0) db.delete(audit_logs).where(inArray(audit_logs.id, auditIds)).run();

  return { payloads: payloadIds.length, events: eventIds.length, audit: auditIds.length };
};

/** Run retention now and every 10 minutes; returns a stop function for shutdown. */
export const startServerRetention = (): (() => void) => {
  const tick = () => {
    try {
      const result = runServerRetention();
      if (result.payloads + result.events + result.audit > 0)
        log.info({ event: "retention.pruned", ...result }, "");
    } catch {
      log.warn({ event: "retention.failed" }, "");
    }
  };
  tick();
  const timer = setInterval(tick, 10 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
};
