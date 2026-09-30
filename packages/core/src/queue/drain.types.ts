/**
 * Configuration options for draining buffered pending webhook events.
 */
export interface IDrainConfig {
  /** Maximum number of events to drain in a single execution cycle */
  readonly maxBatchSize?: number | undefined;
  /** Maximum dispatches per second for rate-limited throttling (e.g. 10 req/s) */
  readonly rateLimitPerSec?: number | undefined;
  /** Fixed delay in milliseconds between dispatches */
  readonly delayMs?: number | undefined;
}

/**
 * Aggregated summary of a completed queue drain cycle.
 */
export interface IDrainResult {
  /** Target tunnel identifier */
  readonly tunnelId: string;
  /** Total count of candidate events attempted for delivery */
  readonly totalAttempted: number;
  /** Count of successfully dispatched events */
  readonly succeededCount: number;
  /** Count of failed events during drain */
  readonly failedCount: number;
  /** Elapsed execution duration in milliseconds */
  readonly durationMs: number;
}
