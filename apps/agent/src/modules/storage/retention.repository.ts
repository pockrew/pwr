import { existsSync, statfsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { db, localDb } from "@agent/db/client";
import {
  localDeliveries,
  localEvents,
  localRelayPackages as packages,
  localRelayTombstones as tombstones,
} from "@agent/db/schemas";
import { and, eq, inArray, lt, notExists, sql } from "drizzle-orm";

import { calculateRetentionCutoffMs, RELAY_DEDUPE_DAYS } from "@pockrew/pwr-core";
import type { RelayPackage, RelayScope, RetentionConfig } from "@pockrew/pwr-shared/schemas";

/**
 * Check a compact retained identity before any payload write or target execution.
 * @returns True for an unexpired duplicate; collisions throw instead of replacing another scope.
 */
export const isPrunedRelay = (scope: RelayScope, packet: RelayPackage): boolean => {
  const row = db
    .select()
    .from(tombstones)
    .where(and(eq(tombstones.serverUrl, scope.serverUrl), eq(tombstones.id, packet.id)))
    .get();
  if (!row || row.expiresAt <= Date.now()) return false;
  if (
    row.slug !== scope.slug ||
    row.eventId !== packet.eventId ||
    row.endpointId !== packet.endpointId
  )
    throw new Error("Relay delivery ID conflicts with retained identity");
  return true;
};

/**
 * Prune confirmed terminal leaves only, using the configured age/count policy for every caller.
 * @param policy - Validated agent policy; disk pressure never bypasses these eligibility checks.
 * @param filter - Manual filters may narrow selection, never force removal of protected records.
 * @returns Deleted event/package counts. A failed transaction preserves its payloads and identities.
 */
export const pruneRelayHistory = (
  policy: RetentionConfig,
  filter: { days?: number | undefined; projects?: string[] | undefined } = {},
) => {
  const cutoff = calculateRetentionCutoffMs(policy.retentionDays);
  const manualCutoff = filter.days ? calculateRetentionCutoffMs(filter.days) : undefined;
  const expiresAt = Date.now() + RELAY_DEDUPE_DAYS * 86_400_000;
  let deletedEvents = 0;
  let deletedPackages = 0;
  // 1. Expired identities no longer promise deduplication; all payload retention remains independent.
  db.delete(tombstones).where(lt(tombstones.expiresAt, Date.now())).run();
  while (true) {
    // 2. Leaf-first deletion protects replay ancestors and their outstanding result reports.
    // ponytail: bounded leaf scans suit local history; index parent IDs if replay trees grow large.
    const pruned = db.transaction((tx) => {
      const rows = tx.all<{
        id: string;
        serverUrl: string;
        slug: string;
        eventId: string;
        endpointId: string;
      }>(sql`
      SELECT p.id, p.server_url AS serverUrl, p.tunnel_slug AS slug, p.event_id AS eventId,
        json_extract(p.metadata, '$.endpointId') AS endpointId
      FROM ${packages} p
      WHERE p.completed = 1 AND p.reported_at IS NOT NULL
        AND (coalesce(p.completed_at, p.created_at) < ${cutoff} OR p.event_id IN (
          SELECT event_id FROM ${packages} GROUP BY event_id
          ORDER BY min(created_at) DESC, event_id DESC LIMIT -1 OFFSET ${policy.maxEvents}
        ))
        AND ${manualCutoff === undefined ? sql`1` : sql`coalesce(p.completed_at, p.created_at) < ${manualCutoff}`}
        AND ${
          filter.projects?.length
            ? sql`p.project_id IN (${sql.join(
                filter.projects.map((id) => sql`${id}`),
                sql`, `,
              )})`
            : sql`1`
        }
        AND NOT EXISTS (SELECT 1 FROM ${packages} child
          WHERE child.server_url = p.server_url
            AND json_extract(child.metadata, '$.replayOfDeliveryId') = p.id)
      ORDER BY p.created_at, p.id LIMIT 100
    `);
      if (rows.length === 0) return false;
      for (const row of rows) {
        // 3. Tombstone and history deletion commit together; a crash cannot erase both identities.
        tx.insert(tombstones)
          .values({ ...row, expiresAt })
          .onConflictDoUpdate({
            target: [tombstones.serverUrl, tombstones.id],
            set: { ...row, expiresAt },
          })
          .run();
        tx.delete(packages)
          .where(and(eq(packages.serverUrl, row.serverUrl), eq(packages.id, row.id)))
          .run();
        tx.delete(localDeliveries)
          .where(
            and(
              eq(localDeliveries.id, row.id),
              notExists(
                tx.select({ id: packages.id }).from(packages).where(eq(packages.id, row.id)),
              ),
            ),
          )
          .run();
      }
      // 4. Fanout siblings share one BLOB; remove it only after the last package disappears.
      deletedEvents += tx
        .delete(localEvents)
        .where(
          and(
            inArray(
              localEvents.id,
              rows.map((row) => row.eventId),
            ),
            notExists(
              tx
                .select({ id: packages.id })
                .from(packages)
                .where(eq(packages.eventId, localEvents.id)),
            ),
          ),
        )
        .run().changes;
      deletedPackages += rows.length;
      return true;
    });
    if (!pruned) break;
  }
  return { deletedEvents, deletedPackages };
};

/** Counts contain no payloads, config or credentials; failures propagate to the caller. */
export const relayRetentionCounts = () => ({
  ...db.get<{ retainedPackages: number; pendingPackages: number; unreportedResults: number }>(sql`
    SELECT count(*) AS retainedPackages,
      coalesce(sum(completed = 0), 0) AS pendingPackages,
      coalesce(sum(completed = 1 AND reported_at IS NULL), 0) AS unreportedResults
    FROM ${packages}`),
  tombstones:
    db.get<{ count: number }>(sql`SELECT count(*) AS count FROM ${tombstones}`)?.count ?? 0,
});

/** Include WAL/SHM in disk pressure. Memory databases use SQLite's allocated page size instead. */
export const storageDiskUsage = () => {
  const pageSize = db.get<{ page_size: number }>(sql`PRAGMA page_size`)?.page_size ?? 4096;
  const pages = db.get<{ page_count: number }>(sql`PRAGMA page_count`)?.page_count ?? 0;
  if (localDb.filename === ":memory:" || !localDb.filename)
    return { usedBytes: pageSize * pages, freeDiskBytes: null };
  const usedBytes = [localDb.filename, `${localDb.filename}-wal`, `${localDb.filename}-shm`].reduce(
    (total, path) => total + (existsSync(path) ? statSync(path).size : 0),
    0,
  );
  // Some platforms/filesystems (Windows, certain network mounts) have no statfs; then only the
  // configured DB size limit applies instead of failing every health check and intake.
  try {
    const disk = statfsSync(dirname(localDb.filename));
    return { usedBytes, freeDiskBytes: disk.bavail * disk.bsize };
  } catch {
    return { usedBytes, freeDiskBytes: null };
  }
};

/**
 * Reclaim WAL and a bounded number of free pages outside transactions. Never a full VACUUM: that
 * needs ~2x the DB size free (fails exactly under disk pressure) and blocks the event loop.
 * Databases created before incremental auto_vacuum only reclaim WAL here.
 */
export const reclaimStorage = (autoVacuum: boolean): void => {
  localDb.run("PRAGMA wal_checkpoint(TRUNCATE)");
  if (!autoVacuum) return;
  // ponytail: 2048 pages (~8 MiB at 4 KiB pages) per pass keeps each sweep short; the minute
  // timer catches up on larger backlogs.
  localDb.run("PRAGMA incremental_vacuum(2048)");
  localDb.run("PRAGMA wal_checkpoint(TRUNCATE)");
};
