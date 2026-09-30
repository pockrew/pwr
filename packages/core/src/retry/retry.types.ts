/**
 * Represents the delivery lifecycle state of a webhook event.
 */
export type DeliveryStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "DEAD_LETTER";

/**
 * Configuration parameters for exponential backoff scheduling.
 */
export interface IRetryConfig {
  /** Initial delay before the first retry attempt in milliseconds */
  baseDelayMs: number;
  /** Maximum upper bound delay cap in milliseconds */
  maxDelayMs: number;
  /** Multiplier factor applied per retry attempt */
  factor: number;
  /** Maximum number of retry attempts before transitioning to DEAD_LETTER */
  maxAttempts: number;
  /** Proportional jitter ratio (e.g. 0.2 = ±20% randomization) */
  jitterRatio: number;
}

/**
 * Lease lock attributes for concurrency control and visibility timeout.
 */
export interface ILeaseLock {
  /** Unix timestamp in milliseconds when the lease expires */
  lockedUntil: number;
  /** Identifier of the worker or instance holding the lease */
  lockedBy: string;
}

/**
 * Parameters for evaluating whether a task is eligible for claiming.
 */
export interface IClaimEvaluationParams {
  deliveryStatus: DeliveryStatus;
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: number | null | undefined;
  lockedUntil?: number | null | undefined;
  now: number;
}
