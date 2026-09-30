import { describe, expect, it } from "bun:test";

import { createRateLimiter } from "./rate-limiter";

describe("RateLimiter & Anti-Spam Quota", () => {
  it("allows normal requests within rate limit and quota", () => {
    const limiter = createRateLimiter({
      tunnelRateLimitPerSec: 10,
      tunnelDailyQuota: 100,
    });

    const res = limiter.check("tunnel-1", "1.2.3.4");
    expect(res.allowed).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-ratelimit-limit"]).toBe("10");
    expect(res.headers["x-quota-daily-limit"]).toBe("100");
    expect(res.headers["x-quota-daily-remaining"]).toBe("99");
  });

  it("throttles burst traffic exceeding per-tunnel limits", () => {
    // tunnelLimit = 5, maxTokens = 10
    const limiter = createRateLimiter({
      tunnelRateLimitPerSec: 5,
      ipRateLimitPerSec: 1000,
      tunnelDailyQuota: 1000,
    });

    // Exhaust all 10 burst tokens
    for (let i = 0; i < 10; i++) {
      const r = limiter.check("tunnel-burst", "1.1.1.1");
      expect(r.allowed).toBe(true);
    }

    // 11th request should be throttled
    const throttled = limiter.check("tunnel-burst", "1.1.1.1");
    expect(throttled.allowed).toBe(false);
    expect(throttled.statusCode).toBe(429);
    expect(throttled.reason).toBe("tunnel_rate_limit");
    expect(throttled.headers["retry-after"]).toBe("1");
    expect(throttled.headers["x-ratelimit-remaining"]).toBe("0");
  });

  it("refills tokens over time", () => {
    const limiter = createRateLimiter({
      tunnelRateLimitPerSec: 10,
      ipRateLimitPerSec: 1000,
      tunnelDailyQuota: 1000,
    });

    const baseTime = 1000_000;

    // Exhaust all 20 tokens at baseTime
    for (let i = 0; i < 20; i++) {
      limiter.check("tunnel-refill", "1.1.1.1", baseTime);
    }
    const blocked = limiter.check("tunnel-refill", "1.1.1.1", baseTime);
    expect(blocked.allowed).toBe(false);

    // Advance time by 1 second -> refills 10 tokens
    const allowedAfter1s = limiter.check("tunnel-refill", "1.1.1.1", baseTime + 1000);
    expect(allowedAfter1s.allowed).toBe(true);
  });

  it("throttles traffic exceeding IP rate limit across tunnels", () => {
    const limiter = createRateLimiter({
      tunnelRateLimitPerSec: 100,
      ipRateLimitPerSec: 3, // max tokens = 6
      tunnelDailyQuota: 1000,
    });

    const spamIp = "192.168.1.100";

    // Exhaust 6 tokens for this IP across different tunnels
    for (let i = 0; i < 6; i++) {
      const res = limiter.check(`tunnel-${i}`, spamIp);
      expect(res.allowed).toBe(true);
    }

    // 7th request from same IP should be blocked
    const throttled = limiter.check("tunnel-another", spamIp);
    expect(throttled.allowed).toBe(false);
    expect(throttled.statusCode).toBe(429);
    expect(throttled.reason).toBe("ip_rate_limit");
  });

  it("enforces 24-hour anti-spam daily quota circuit breaker", () => {
    const quota = 5;
    const limiter = createRateLimiter({
      tunnelRateLimitPerSec: 100,
      ipRateLimitPerSec: 100,
      tunnelDailyQuota: quota,
    });

    const baseTime = 2000_000;

    // Send 5 allowed requests
    for (let i = 0; i < quota; i++) {
      const res = limiter.check("tunnel-daily", "10.0.0.1", baseTime + i * 100);
      expect(res.allowed).toBe(true);
      expect(res.headers["x-quota-daily-remaining"]).toBe(String(quota - (i + 1)));
    }

    // 6th request exceeds daily quota -> circuit breaker opens!
    const blocked = limiter.check("tunnel-daily", "10.0.0.1", baseTime + 600);
    expect(blocked.allowed).toBe(false);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.reason).toBe("daily_quota_exceeded");
    expect(blocked.headers["x-quota-daily-remaining"]).toBe("0");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);

    // Advance time by 25 hours -> daily quota resets
    const nextDay = baseTime + 25 * 3600 * 1000;
    const allowedNextDay = limiter.check("tunnel-daily", "10.0.0.1", nextDay);
    expect(allowedNextDay.allowed).toBe(true);
    expect(allowedNextDay.headers["x-quota-daily-remaining"]).toBe(String(quota - 1));
  });

  it("resets all buckets on reset() call", () => {
    const limiter = createRateLimiter({
      tunnelRateLimitPerSec: 1,
      tunnelDailyQuota: 1,
    });

    limiter.check("t-1", "1.1.1.1");
    expect(limiter.check("t-1", "1.1.1.1").allowed).toBe(false);

    limiter.reset();
    expect(limiter.check("t-1", "1.1.1.1").allowed).toBe(true);
  });
});
