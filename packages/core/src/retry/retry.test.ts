import { describe, expect, it } from "bun:test";

import { calculateBackoffDelay, DEFAULT_RETRY_CONFIG } from "./backoff";
import { canClaimTask, createLease, isLeaseExpired } from "./lease";

describe("Retry Engine: Exponential Backoff", () => {
  it("computes exponential delays within bounded range", () => {
    const config = { baseDelayMs: 1000, factor: 2, maxDelayMs: 10000, jitterRatio: 0 };

    // Attempt 1: 1000 * 2^0 = 1000
    expect(calculateBackoffDelay(1, config)).toBe(1000);
    // Attempt 2: 1000 * 2^1 = 2000
    expect(calculateBackoffDelay(2, config)).toBe(2000);
    // Attempt 3: 1000 * 2^2 = 4000
    expect(calculateBackoffDelay(3, config)).toBe(4000);
    // Attempt 4: 1000 * 2^3 = 8000
    expect(calculateBackoffDelay(4, config)).toBe(8000);
    // Attempt 5: 1000 * 2^4 = 16000 -> capped at 10000
    expect(calculateBackoffDelay(5, config)).toBe(10000);
  });

  it("applies jitter within configured ratio bounds", () => {
    const config = { baseDelayMs: 1000, factor: 2, maxDelayMs: 10000, jitterRatio: 0.2 };
    for (let i = 0; i < 20; i++) {
      const delay = calculateBackoffDelay(2, config); // base is 2000, jitter +- 400
      expect(delay).toBeGreaterThanOrEqual(1600);
      expect(delay).toBeLessThanOrEqual(2400);
    }
  });

  it("handles non-positive attempts gracefully", () => {
    const delay = calculateBackoffDelay(0, { jitterRatio: 0 });
    expect(delay).toBe(DEFAULT_RETRY_CONFIG.baseDelayMs);
  });
});

describe("Retry Engine: Lease Concurrency Locking", () => {
  const now = 1700000000000;

  it("evaluates lease expiration correctly", () => {
    expect(isLeaseExpired(null, now)).toBe(true);
    expect(isLeaseExpired(undefined, now)).toBe(true);
    expect(isLeaseExpired(now - 1000, now)).toBe(true);
    expect(isLeaseExpired(now + 1000, now)).toBe(false);
  });

  it("creates a lease lock with assigned duration", () => {
    const lease = createLease("worker_alpha", 15000, now);
    expect(lease.lockedBy).toBe("worker_alpha");
    expect(lease.lockedUntil).toBe(now + 15000);
  });

  it("allows claiming when task is eligible and lease is free", () => {
    expect(
      canClaimTask({
        deliveryStatus: "PENDING",
        attempts: 0,
        maxAttempts: 5,
        now,
      }),
    ).toBe(true);

    expect(
      canClaimTask({
        deliveryStatus: "FAILED",
        attempts: 2,
        maxAttempts: 5,
        nextRetryAt: now - 500,
        lockedUntil: now - 100,
        now,
      }),
    ).toBe(true);
  });

  it("rejects claiming when task is completed, exhausted, or active lease held", () => {
    // Already completed
    expect(
      canClaimTask({
        deliveryStatus: "COMPLETED",
        attempts: 1,
        maxAttempts: 5,
        now,
      }),
    ).toBe(false);

    // Dead lettered
    expect(
      canClaimTask({
        deliveryStatus: "DEAD_LETTER",
        attempts: 5,
        maxAttempts: 5,
        now,
      }),
    ).toBe(false);

    // Max attempts exceeded
    expect(
      canClaimTask({
        deliveryStatus: "FAILED",
        attempts: 5,
        maxAttempts: 5,
        now,
      }),
    ).toBe(false);

    // Waiting for backoff schedule
    expect(
      canClaimTask({
        deliveryStatus: "FAILED",
        attempts: 1,
        maxAttempts: 5,
        nextRetryAt: now + 5000,
        now,
      }),
    ).toBe(false);

    // Another worker holds active lease
    expect(
      canClaimTask({
        deliveryStatus: "PENDING",
        attempts: 0,
        maxAttempts: 5,
        lockedUntil: now + 10000,
        now,
      }),
    ).toBe(false);
  });
});
