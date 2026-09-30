import { statSync } from "node:fs";
import { getLogger } from "@logtape/logtape";
import { HTTPException } from "hono/http-exception";

import { getTomlConfigPath, loadTomlConfig, RELAY_DEDUPE_DAYS } from "@pockrew/pwr-core";
import {
  AgentStorageStatusSchema,
  RetentionConfigSchema,
  type AgentStorageStatus,
} from "@pockrew/pwr-shared/schemas";

import {
  pruneRelayHistory,
  reclaimStorage,
  relayRetentionCounts,
  storageDiskUsage,
} from "./retention.repository";

const logger = getLogger(["pwr", "agent", "storage"]);

const MIN_WRITE_BYTES = 64 * 1024;
let requiredBytes = MIN_WRITE_BYTES;
let writeFailed = false;
let lastRunAt: number | null = null;

// Hot paths (every received packet and drained package) check capacity; re-read the TOML policy
// only when the file changed, so a saved setting still applies immediately.
let cachedPolicy: { value: ReturnType<typeof RetentionConfigSchema.parse>; key: string } | null =
  null;
const retentionPolicy = () => {
  let key = "missing";
  try {
    const stat = statSync(getTomlConfigPath());
    key = `${stat.mtimeMs}:${stat.size}`;
  } catch {
    // No config file: defaults apply.
  }
  if (cachedPolicy?.key !== key)
    cachedPolicy = { value: RetentionConfigSchema.parse(loadTomlConfig().retention), key };
  return cachedPolicy.value;
};

/** Compute why intake is blocked from file sizes only (no table scans), or null when ready. */
const blockReason = () => {
  const policy = retentionPolicy();
  const usage = storageDiskUsage();
  const limitBytes = policy.maxDbSizeMb * 1024 * 1024;
  const reason = writeFailed
    ? "write_failed"
    : usage.usedBytes + requiredBytes > limitBytes
      ? "capacity"
      : usage.freeDiskBytes !== null && usage.freeDiskBytes < requiredBytes
        ? "disk_free"
        : null;
  return { reason, usage, limitBytes };
};

/** Cheap check for hot paths; use getStorageStatus() when counts are needed. */
export const isStorageBlocked = (): boolean => blockReason().reason !== null;

/** Read pressure without cleaning or changing policy. Reporting/config access stays available when blocked. */
export const getStorageStatus = (): AgentStorageStatus => {
  const { reason, usage, limitBytes } = blockReason();
  return AgentStorageStatusSchema.parse({
    ...usage,
    ...relayRetentionCounts(),
    state: reason ? "blocked" : "ready",
    reason,
    limitBytes,
    requiredBytes,
    dedupeDays: RELAY_DEDUPE_DAYS,
    lastRunAt,
  });
};

/**
 * Shared startup/periodic/manual policy. Filters only narrow the configured deletion policy.
 * @returns Counts and measured capacity; errors preserve uncommitted records and block intake.
 */
export const runRetention = (
  filter: { days?: number | undefined; projects?: string[] | undefined } = {},
) => {
  try {
    const policy = retentionPolicy();
    const deleted = pruneRelayHistory(policy, filter);
    writeFailed = false;
    try {
      reclaimStorage(policy.autoVacuum);
    } catch {
      // Pruning already committed; failing to shrink the file must not block intake.
      logger.warning("Page reclaim failed; will retry on the next sweep");
    }
    lastRunAt = Date.now();
    return { ...deleted, storage: getStorageStatus() };
  } catch (error) {
    writeFailed = true;
    throw error;
  }
};

/**
 * Reserve headroom before new payload/replay writes, never before duplicate receipts or result commits.
 * @param bytes - Expected new data size; SQLite/WAL amplification is conservatively accounted for.
 * @throws 507 if eligible cleanup cannot make room. The caller must not ACK or execute that package.
 */
export const ensureStorageCapacity = (bytes: number): void => {
  // 1. Keep the rejected package's requirement until enough space exists to accept it on reconnect.
  requiredBytes = Math.max(requiredBytes, MIN_WRITE_BYTES + Math.ceil(bytes * 3));
  if (!isStorageBlocked()) {
    requiredBytes = MIN_WRITE_BYTES;
    return;
  }
  // 2. Protected/young data is never sacrificed to satisfy disk pressure.
  if (runRetention().storage.state === "blocked")
    throw new HTTPException(507, { message: "Local relay storage is full" });
  requiredBytes = MIN_WRITE_BYTES;
};

/** Mark actual disk write failures as intake-blocking; invalid frames/identity conflicts are unrelated. */
export const noteStorageWriteFailure = (error: unknown): void => {
  // Drizzle wraps SQLite failures in Error.cause; inspect a bounded chain without logging SQL/data.
  let cause = error;
  for (let depth = 0; depth < 5 && cause instanceof Error; depth++) {
    if (
      "code" in cause &&
      typeof cause.code === "string" &&
      /^(SQLITE_FULL|SQLITE_IOERR|ENOSPC|EDQUOT)/.test(cause.code)
    ) {
      writeFailed = true;
      return;
    }
    cause = cause.cause;
  }
};

/** Run the same policy every minute; caller refreshes transport after cleanup. Stop before closing SQLite. */
export const startRetentionTimer = (onSweep: () => void): (() => void) => {
  const timer = setInterval(() => {
    try {
      runRetention();
      onSweep();
    } catch {
      logger.error("Retention failed; intake blocked and stored work retained");
    }
  }, 60_000);
  timer.unref();
  return () => clearInterval(timer);
};
