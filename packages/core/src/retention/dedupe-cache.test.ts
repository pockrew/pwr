import { describe, expect, it } from "bun:test";

import { createDedupeCache } from "./dedupe-cache";

describe("DedupeCache", () => {
  it("records new keys as not duplicate and catches immediate duplicates", () => {
    const dedupe = createDedupeCache(5000, 100);

    expect(dedupe.checkAndRecord("event-1")).toBe(false);
    expect(dedupe.checkAndRecord("event-1")).toBe(true);
    expect(dedupe.isDuplicate("event-1")).toBe(true);

    expect(dedupe.checkAndRecord("event-2")).toBe(false);
    expect(dedupe.checkAndRecord("event-2")).toBe(true);
  });

  it("evicts oldest entry when max capacity is reached", () => {
    const dedupe = createDedupeCache(60_000, 2);

    expect(dedupe.checkAndRecord("k1")).toBe(false);
    expect(dedupe.checkAndRecord("k2")).toBe(false);
    expect(dedupe.size()).toBe(2);

    // Adding 3rd key should evict k1
    expect(dedupe.checkAndRecord("k3")).toBe(false);
    expect(dedupe.size()).toBe(2);
    expect(dedupe.isDuplicate("k1")).toBe(false);
    expect(dedupe.isDuplicate("k2")).toBe(true);
    expect(dedupe.isDuplicate("k3")).toBe(true);
  });

  it("allows re-recording expired keys", async () => {
    const shortTtlDedupe = createDedupeCache(50, 100);

    expect(shortTtlDedupe.checkAndRecord("quick-event")).toBe(false);
    expect(shortTtlDedupe.checkAndRecord("quick-event")).toBe(true);

    // Wait for TTL expiration
    await Bun.sleep(60);

    // After expiration, checkAndRecord should accept it as a new event
    expect(shortTtlDedupe.checkAndRecord("quick-event")).toBe(false);
  });

  it("purges expired entries on demand", async () => {
    const dedupe = createDedupeCache(40, 100);
    dedupe.checkAndRecord("e1");
    dedupe.checkAndRecord("e2");

    await Bun.sleep(50);
    const purged = dedupe.purgeExpired();
    expect(purged).toBe(2);
    expect(dedupe.size()).toBe(0);
  });
});
