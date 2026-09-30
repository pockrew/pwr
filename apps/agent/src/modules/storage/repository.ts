import { db } from "@agent/db/client";
import { localDeliveries, localEvents, localRelayPackages } from "@agent/db/schemas";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { fromStoredWebhook, toStoredDelivery, toStoredWebhook } from "@pockrew/pwr-core";
import type {
  AgentRequestList,
  EventDeliverySummary,
  RelayExecutionResult,
  RelayScope,
  WebhookEvent,
} from "@pockrew/pwr-shared/schemas";

/** The fields of a stored target result that the event outcome needs. */
const ResultSummarySchema = z.object({ statusCode: z.number(), latencyMs: z.number() });

/** Status and latency of a stored result; null for pending work or an unreadable row. */
const readResult = (text: string | null) => {
  if (!text) return null;
  try {
    const parsed = ResultSummarySchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/** Outcome of each event from its relay packages: counts, and the newest completed result. */
const deliveryOutcomes = (eventIds: string[], scope?: RelayScope) => {
  const outcomes = new Map<
    string,
    { summary: EventDeliverySummary; latest?: { at: number; status: number; latencyMs: number } }
  >();
  if (!eventIds.length) return outcomes;
  const rows = db
    .select({
      eventId: localRelayPackages.eventId,
      completed: localRelayPackages.completed,
      completedAt: localRelayPackages.completedAt,
      result: localRelayPackages.result,
    })
    .from(localRelayPackages)
    .where(
      and(
        inArray(localRelayPackages.eventId, eventIds),
        scope ? eq(localRelayPackages.serverUrl, scope.serverUrl) : undefined,
        scope ? eq(localRelayPackages.slug, scope.slug) : undefined,
      ),
    )
    .all();
  for (const row of rows) {
    const outcome = outcomes.get(row.eventId) ?? {
      summary: { total: 0, pending: 0, succeeded: 0, failed: 0 },
    };
    outcome.summary.total += 1;
    const result = row.completed ? readResult(row.result) : null;
    if (!result) outcome.summary.pending += 1;
    else {
      const { statusCode, latencyMs } = result;
      if (statusCode >= 200 && statusCode < 400) outcome.summary.succeeded += 1;
      else outcome.summary.failed += 1;
      const at = row.completedAt ?? 0;
      if (!outcome.latest || at >= outcome.latest.at)
        outcome.latest = { at, status: statusCode, latencyMs };
    }
    outcomes.set(row.eventId, outcome);
  }
  return outcomes;
};

/** Stored events with their real delivery outcome; legacy status/latency columns are ignored. */
const eventsFromRows = (rows: (typeof localEvents.$inferSelect)[], scope?: RelayScope) => {
  const outcomes = deliveryOutcomes(
    rows.map((row) => row.id),
    scope,
  );
  return rows.map((row): WebhookEvent => {
    const outcome = outcomes.get(row.id);
    return {
      ...fromStoredWebhook({
        ...row,
        sizeBytes: row.sizeBytes ?? 0,
        attempts: row.attempts ?? 0,
        replayCount: row.replayCount ?? 0,
      }),
      deliveries: outcome?.summary ?? { total: 0, pending: 0, succeeded: 0, failed: 0 },
      ...(outcome?.latest
        ? { status: outcome.latest.status, executionTimeMs: outcome.latest.latencyMs }
        : {}),
    };
  });
};

/** Match local history through package ownership, never by an untrusted alias as a server ID. */
const eventFilter = (scope?: RelayScope, projectId?: string, tunnelId?: string) =>
  and(
    projectId ? eq(localEvents.projectId, projectId) : undefined,
    tunnelId ? eq(localEvents.tunnelId, tunnelId) : undefined,
    scope
      ? inArray(
          localEvents.id,
          db
            .select({ id: localRelayPackages.eventId })
            .from(localRelayPackages)
            .where(
              and(
                eq(localRelayPackages.serverUrl, scope.serverUrl),
                eq(localRelayPackages.slug, scope.slug),
                projectId ? eq(localRelayPackages.projectId, projectId) : undefined,
              ),
            ),
        )
      : undefined,
  );

/** Typed local storage queries; migration/open logic lives exclusively under db/. */
export const agentDbService = {
  /**
   * Persist the original event through the shared byte converter.
   * @param event - Local event including its untouched provider payload.
   * @throws On failed writes; receipt ACK must wait for successful persistence.
   */
  saveEvent: (event: WebhookEvent): void => {
    // 1. Convert through the shared mapper; preserve binary and empty bodies.
    const stored = toStoredWebhook(event);
    const values = {
      ...stored,
      payload: stored.payload ? Buffer.from(stored.payload) : null,
      isBinary: stored.isBinary ? 1 : 0,
      updatedAt: Date.now(),
    };
    // 2. Update in place rather than REPLACE/delete so references and queue state survive.
    db.insert(localEvents)
      .values(values)
      .onConflictDoUpdate({ target: localEvents.id, set: values })
      .run();
  },
  /**
   * Increment replay telemetry in the result transaction.
   * @param id - Source event identity.
   * @throws On write failure so audit/result changes roll back together.
   */
  incrementReplayCount: (id: string): void => {
    db.update(localEvents)
      .set({ replayCount: sql`coalesce(${localEvents.replayCount}, 0) + 1`, updatedAt: Date.now() })
      .where(eq(localEvents.id, id))
      .run();
  },
  /**
   * Persist target audit data without request secrets.
   * @param delivery - Target result converted by the shared storage mapper.
   * @throws On failed persistence.
   */
  saveDelivery: (delivery: RelayExecutionResult): void => {
    const stored = toStoredDelivery(delivery);
    const values = { ...stored, id: delivery.id };
    db.insert(localDeliveries)
      .values(values)
      .onConflictDoUpdate({ target: localDeliveries.id, set: values })
      .run();
  },
  /**
   * Page immutable local events; apply scope/method before LIMIT and break time ties by ID.
   * @param options - Validated filter with an exclusive last-event ID cursor.
   * @param scope - Optional resolved local session, selecting only its persisted packages.
   * @returns Bounded items and nextCursor; an absent/out-of-scope cursor throws 400.
   */
  listEventPage: (options: AgentRequestList, scope?: RelayScope) => {
    const match = eventFilter(scope, options.projectId, scope ? undefined : options.tunnelId);
    const method = options.method ? eq(localEvents.method, options.method) : undefined;
    const cursor = options.cursor
      ? db
          .select({ id: localEvents.id, createdAt: localEvents.createdAt })
          .from(localEvents)
          .where(and(match, method, eq(localEvents.id, options.cursor)))
          .get()
      : undefined;
    if (options.cursor && !cursor) throw new HTTPException(400);
    const rows = db
      .select()
      .from(localEvents)
      .where(
        and(
          match,
          method,
          cursor
            ? or(
                lt(localEvents.createdAt, cursor.createdAt),
                and(eq(localEvents.createdAt, cursor.createdAt), lt(localEvents.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(localEvents.createdAt), desc(localEvents.id))
      .limit(options.limit + 1)
      .all();
    const items = eventsFromRows(rows.slice(0, options.limit), scope);
    return {
      items,
      count: items.length,
      nextCursor: rows.length > options.limit ? (items.at(-1)?.id ?? null) : null,
    };
  },
  /**
   * Read one original event without allowing a supplied session/project scope to be ignored.
   * @param id - Stored event identity.
   * @param scope - Optional normalized server/slug boundary.
   * @param projectId - Optional local project filter.
   * @returns Original event or null; database/decoding errors propagate.
   */
  getEventById: (id: string, scope?: RelayScope, projectId?: string): WebhookEvent | null => {
    const row = db
      .select()
      .from(localEvents)
      .where(and(eq(localEvents.id, id), eventFilter(scope, projectId)))
      .get();
    return row ? (eventsFromRows([row], scope)[0] ?? null) : null;
  },
};
