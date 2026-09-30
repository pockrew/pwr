/**
 * In-memory sliding-window deduplication store with bounded capacity and TTL eviction.
 * Used by Server Ingress and Agent to detect and suppress duplicate webhook deliveries.
 */
export class DedupeCache {
  private readonly cache: Map<string, number> = new Map();
  private readonly ttlMs: number;
  private readonly maxCapacity: number;

  constructor(ttlMs = 300_000, maxCapacity = 10_000) {
    this.ttlMs = ttlMs > 0 ? ttlMs : 300_000;
    this.maxCapacity = maxCapacity > 0 ? maxCapacity : 10_000;
  }

  /**
   * Checks if an event ID or idempotency key has been seen within the TTL window.
   * If not seen, records it with the current timestamp and returns false (not duplicate).
   * If already seen within the TTL window, returns true (duplicate).
   *
   * @param key - Event ID or idempotency key to test.
   * @returns boolean - true if duplicate, false if first time seen.
   */
  public checkAndRecord = (key: string): boolean => {
    // 1. Check if key exists and whether its recorded timestamp is still within the TTL window
    const now = Date.now();
    const existingTimestamp = this.cache.get(key);

    if (existingTimestamp !== undefined) {
      if (now - existingTimestamp < this.ttlMs) {
        return true;
      }
      // Expired record: evict key before recording fresh timestamp
      this.cache.delete(key);
    }

    // 2. Enforce maximum capacity bounds (evict oldest inserted entry if limit reached)
    if (this.cache.size >= this.maxCapacity) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    // 3. Record new active timestamp entry
    this.cache.set(key, now);
    return false;
  };

  /**
   * Explicitly checks if a key exists within the TTL window without modifying the cache.
   *
   * @param key - The key to test.
   * @returns boolean - true if present and unexpired.
   */
  public isDuplicate = (key: string): boolean => {
    // 1. Check entry existence in cache
    const existingTimestamp = this.cache.get(key);
    if (existingTimestamp === undefined) return false;

    // 2. Validate entry expiration against TTL
    return Date.now() - existingTimestamp < this.ttlMs;
  };

  /**
   * Purges all expired entries from the in-memory cache.
   *
   * @returns number of purged keys.
   */
  public purgeExpired = (): number => {
    // 1. Capture current timestamp
    const now = Date.now();
    let purged = 0;

    // 2. Remove entries exceeding TTL duration
    for (const [key, timestamp] of this.cache.entries()) {
      if (now - timestamp >= this.ttlMs) {
        this.cache.delete(key);
        purged += 1;
      }
    }

    // 3. Return total count of purged entries
    return purged;
  };

  /**
   * Returns current count of entries in the deduplication cache.
   */
  public size = (): number => this.cache.size;

  /**
   * Clears all recorded entries.
   */
  public clear = (): void => {
    this.cache.clear();
  };
}

/**
 * Factory function creating a configured DedupeCache instance.
 *
 * @param ttlMs - Time-to-live window in milliseconds (default: 5 minutes = 300,000ms).
 * @param maxCapacity - Maximum number of entries stored before oldest-first eviction (default: 10,000).
 */
export const createDedupeCache = (ttlMs?: number, maxCapacity?: number): DedupeCache =>
  new DedupeCache(ttlMs, maxCapacity);
