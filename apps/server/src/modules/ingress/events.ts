import { EventEmitter } from "node:events";
import { db } from "@server/db/client";
import { webhookEvents } from "@server/db/schemas";
import { env } from "@server/platform/env";
import { log } from "@server/platform/logger.middleware";
import { and, asc, isNotNull, isNull, lte, or } from "drizzle-orm";

export const ingressEvents = new EventEmitter<{ stored: [eventId: string] }>();

// The stored event is the retry record if publishing/handling is interrupted.
export const recoverIngressEvents = (): void => {
  try {
    const events = db
      .select({ id: webhookEvents.id })
      .from(webhookEvents)
      .where(
        and(
          isNull(webhookEvents.deliveryPreparedAt),
          or(isNotNull(webhookEvents.collectionId), isNotNull(webhookEvents.endpointPath)),
          or(isNull(webhookEvents.nextRetryAt), lte(webhookEvents.nextRetryAt, Date.now())),
        ),
      )
      .orderBy(asc(webhookEvents.receivedAt), asc(webhookEvents.id))
      .limit(env.MAX_REPLAY_BACKLOG_BATCH)
      .all();
    for (const event of events) ingressEvents.emit("stored", event.id);
  } catch {
    log.warn({ event: "ingress.recovery_failed" }, "");
  }
};

export const startIngressRecovery = (): (() => void) => {
  recoverIngressEvents();
  const timer = setInterval(recoverIngressEvents, 1000);
  timer.unref();
  return () => clearInterval(timer);
};
