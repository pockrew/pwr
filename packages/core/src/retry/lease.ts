import type { IClaimEvaluationParams, ILeaseLock } from "./retry.types";

export const DEFAULT_LEASE_DURATION_MS = 30000;

/**
 * Checks whether a given lease lock timestamp has expired.
 *
 * @param lockedUntil - Unix timestamp in ms when the lease lock expires, or null/undefined if unlocked.
 * @param now - Current reference timestamp in ms.
 * @returns True if the lease is null, undefined, or strictly less than now.
 */
export const isLeaseExpired = (lockedUntil: number | null | undefined, now: number): boolean => {
  if (lockedUntil === null || lockedUntil === undefined) {
    return true;
  }
  return lockedUntil < now;
};

/**
 * Creates a new lease lock descriptor for a worker.
 *
 * @param workerId - Unique worker identifier.
 * @param durationMs - Duration in milliseconds for the lease lock.
 * @param now - Reference start timestamp in milliseconds.
 * @returns ILeaseLock object containing lockedUntil and lockedBy.
 */
export const createLease = (
  workerId: string,
  durationMs = DEFAULT_LEASE_DURATION_MS,
  now = Date.now(),
): ILeaseLock => ({
  lockedUntil: now + durationMs,
  lockedBy: workerId,
});

/**
 * Evaluates whether a webhook delivery task is currently claimable by a worker.
 *
 * @param params - Task state and timing evaluation parameters.
 * @returns True if the task is eligible for claiming and execution.
 */
export const canClaimTask = (params: IClaimEvaluationParams): boolean => {
  // 1. Task must not have exceeded max attempts
  if (params.attempts >= params.maxAttempts) {
    return false;
  }

  // 2. Only PENDING or FAILED statuses can be claimed
  if (params.deliveryStatus !== "PENDING" && params.deliveryStatus !== "FAILED") {
    return false;
  }

  // 3. Backoff timing: task must be ready for retry
  if (
    params.nextRetryAt !== null &&
    params.nextRetryAt !== undefined &&
    params.nextRetryAt > params.now
  ) {
    return false;
  }

  // 4. Lease lock must be unassigned or expired
  return isLeaseExpired(params.lockedUntil, params.now);
};
