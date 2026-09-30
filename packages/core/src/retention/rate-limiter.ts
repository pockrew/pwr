export interface IRateLimitResult {
  allowed: boolean;
  statusCode: number;
  headers: Record<string, string>;
  reason?: "tunnel_rate_limit" | "ip_rate_limit" | "daily_quota_exceeded" | undefined;
}

export interface IRateLimiterConfig {
  tunnelRateLimitPerSec?: number;
  ipRateLimitPerSec?: number;
  tunnelDailyQuota?: number;
  maxEntries?: number;
}

interface ITunnelBucket {
  tokens: number;
  lastRefillMs: number;
  dailyCount: number;
  dailyResetMs: number;
  lastAccessedMs: number;
}

interface IIpBucket {
  tokens: number;
  lastRefillMs: number;
  lastAccessedMs: number;
}

const DAY_MS = 86_400_000;

/**
 * Factory creating an in-memory dual-tier Token Bucket and Daily Quota rate limiter.
 * Enforces per-IP burst limits and per-tunnel daily ingest quotas with automatic LRU-style cleanup.
 *
 * @param config - Rate limiting configuration parameters.
 * @returns Rate limiter instance exposing `.check()` and metrics getters.
 */
export const createRateLimiter = (config: IRateLimiterConfig = {}) => {
  const tunnelLimit = config.tunnelRateLimitPerSec ?? 50;
  const ipLimit = config.ipRateLimitPerSec ?? 100;
  const dailyQuota = config.tunnelDailyQuota ?? 20_000;
  const maxEntries = config.maxEntries ?? 20_000;

  const tunnelMaxTokens = tunnelLimit * 2;
  const ipMaxTokens = ipLimit * 2;

  const tunnelBuckets = new Map<string, ITunnelBucket>();
  const ipBuckets = new Map<string, IIpBucket>();

  /**
   * Purges inactive rate-limiting buckets to constrain memory footprint.
   *
   * @param now - Current reference timestamp in milliseconds.
   */
  const purgeStaleEntries = (now: number): void => {
    // 1. Purge IP buckets inactive for > 10 minutes
    const staleIpThreshold = now - 600_000;
    for (const [ip, bucket] of ipBuckets.entries()) {
      if (bucket.lastAccessedMs < staleIpThreshold) {
        ipBuckets.delete(ip);
      }
    }

    // 2. Purge tunnel buckets inactive for > 25 hours
    const staleTunnelThreshold = now - (DAY_MS + 3_600_000);
    for (const [tunnelId, bucket] of tunnelBuckets.entries()) {
      if (bucket.lastAccessedMs < staleTunnelThreshold) {
        tunnelBuckets.delete(tunnelId);
      }
    }
  };

  /**
   * Retrieves or initializes the token bucket for an individual client IP address, refilling tokens based on elapsed time.
   *
   * @param ip - Client IP string.
   * @param now - Current timestamp in milliseconds.
   * @returns Active IP token bucket.
   */
  const getOrCreateIpBucket = (ip: string, now: number): IIpBucket => {
    // 1. Trigger sweep if table exceeds capacity bounds
    if (ipBuckets.size >= maxEntries) {
      purgeStaleEntries(now);
    }

    // 2. Refill existing bucket tokens based on delta time
    const existing = ipBuckets.get(ip);
    if (existing) {
      const elapsedSec = (now - existing.lastRefillMs) / 1000;
      if (elapsedSec > 0) {
        existing.tokens = Math.min(ipMaxTokens, existing.tokens + elapsedSec * ipLimit);
        existing.lastRefillMs = now;
      }
      existing.lastAccessedMs = now;
      return existing;
    }

    // 3. Create fresh bucket with full token allowance
    const newBucket: IIpBucket = {
      tokens: ipMaxTokens,
      lastRefillMs: now,
      lastAccessedMs: now,
    };
    ipBuckets.set(ip, newBucket);
    return newBucket;
  };

  /**
   * Retrieves or initializes the rate limiting bucket and daily quota for a tunnel.
   *
   * @param tunnelId - Target tunnel identifier.
   * @param now - Current timestamp in milliseconds.
   * @returns Active tunnel token and quota bucket.
   */
  const getOrCreateTunnelBucket = (tunnelId: string, now: number): ITunnelBucket => {
    // 1. Trigger sweep if table exceeds capacity bounds
    if (tunnelBuckets.size >= maxEntries) {
      purgeStaleEntries(now);
    }

    const existing = tunnelBuckets.get(tunnelId);
    if (existing) {
      // Refill burst tokens
      const elapsedSec = (now - existing.lastRefillMs) / 1000;
      if (elapsedSec > 0) {
        existing.tokens = Math.min(tunnelMaxTokens, existing.tokens + elapsedSec * tunnelLimit);
        existing.lastRefillMs = now;
      }
      // Reset daily quota if window expired
      if (now >= existing.dailyResetMs) {
        existing.dailyCount = 0;
        existing.dailyResetMs = now + DAY_MS;
      }
      existing.lastAccessedMs = now;
      return existing;
    }

    const newBucket: ITunnelBucket = {
      tokens: tunnelMaxTokens,
      lastRefillMs: now,
      dailyCount: 0,
      dailyResetMs: now + DAY_MS,
      lastAccessedMs: now,
    };
    tunnelBuckets.set(tunnelId, newBucket);
    return newBucket;
  };

  const limiter = {
    /** Per-IP burst limit only; safe to run before authentication (costs no tunnel quota). */
    checkIp: (clientIp: string, now = Date.now()): IRateLimitResult | null => {
      if (clientIp.length > 0) {
        const ipBucket = getOrCreateIpBucket(clientIp, now);
        if (ipBucket.tokens < 1) {
          return {
            allowed: false,
            statusCode: 429,
            headers: {
              "retry-after": "1",
              "x-ratelimit-limit": String(ipLimit),
              "x-ratelimit-remaining": "0",
            },
            reason: "ip_rate_limit",
          };
        }
        ipBucket.tokens -= 1;
      }

      return null;
    },

    /**
     * Per-tunnel burst limit and daily quota. Run only after the request authenticated, otherwise
     * anyone who knows a slug can exhaust a tunnel's daily quota.
     */
    checkTunnel: (tunnelId: string, now = Date.now()): IRateLimitResult => {
      // 2. Check Tunnel limits
      const tunnelBucket = getOrCreateTunnelBucket(tunnelId, now);

      // 2.1. Check 24-hour daily quota
      if (dailyQuota > 0 && tunnelBucket.dailyCount >= dailyQuota) {
        const secondsUntilReset = Math.max(1, Math.ceil((tunnelBucket.dailyResetMs - now) / 1000));
        return {
          allowed: false,
          statusCode: 429,
          headers: {
            "retry-after": String(secondsUntilReset),
            "x-quota-daily-limit": String(dailyQuota),
            "x-quota-daily-remaining": "0",
            "x-quota-daily-reset": String(secondsUntilReset),
          },
          reason: "daily_quota_exceeded",
        };
      }

      // 2.2. Check per-tunnel burst rate limit
      if (tunnelBucket.tokens < 1) {
        return {
          allowed: false,
          statusCode: 429,
          headers: {
            "retry-after": "1",
            "x-ratelimit-limit": String(tunnelLimit),
            "x-ratelimit-remaining": "0",
            "x-quota-daily-limit": String(dailyQuota),
            "x-quota-daily-remaining": String(Math.max(0, dailyQuota - tunnelBucket.dailyCount)),
          },
          reason: "tunnel_rate_limit",
        };
      }

      // 3. Consume token & increment daily count
      tunnelBucket.tokens -= 1;
      tunnelBucket.dailyCount += 1;

      const remainingQuota = Math.max(0, dailyQuota - tunnelBucket.dailyCount);
      const secondsUntilReset = Math.max(1, Math.ceil((tunnelBucket.dailyResetMs - now) / 1000));

      return {
        allowed: true,
        statusCode: 200,
        headers: {
          "x-ratelimit-limit": String(tunnelLimit),
          "x-ratelimit-remaining": String(Math.floor(tunnelBucket.tokens)),
          "x-quota-daily-limit": String(dailyQuota),
          "x-quota-daily-remaining": String(remainingQuota),
          "x-quota-daily-reset": String(secondsUntilReset),
        },
      };
    },

    /** IP then tunnel checks in one call (both before and after auth in a single step). */
    check: (tunnelId: string, clientIp = "127.0.0.1", now = Date.now()): IRateLimitResult =>
      limiter.checkIp(clientIp, now) ?? limiter.checkTunnel(tunnelId, now),

    reset: (): void => {
      tunnelBuckets.clear();
      ipBuckets.clear();
    },
  };
  return limiter;
};

export type IRateLimiter = ReturnType<typeof createRateLimiter>;
