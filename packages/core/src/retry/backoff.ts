import type { IRetryConfig } from "./retry.types";

export const DEFAULT_RETRY_CONFIG: IRetryConfig = {
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  factor: 2,
  maxAttempts: 5,
  jitterRatio: 0.2,
};

/**
 * Calculates the next retry delay in milliseconds using exponential backoff with randomized jitter.
 *
 * @param attempts - Number of attempts already executed (1-based index).
 * @param customConfig - Optional overrides for retry configuration.
 * @returns Delay duration in milliseconds until the next retry should fire.
 */
export const calculateBackoffDelay = (
  attempts: number,
  customConfig?: Partial<IRetryConfig> | undefined,
): number => {
  const config = { ...DEFAULT_RETRY_CONFIG, ...customConfig };
  const safeAttempts = Math.max(1, attempts);

  // 1. Calculate deterministic exponential delay
  const exponential = config.baseDelayMs * Math.pow(config.factor, safeAttempts - 1);
  const bounded = Math.min(config.maxDelayMs, exponential);

  // 2. Add randomized jitter to prevent Thundering Herd on recovering servers
  const jitterRange = bounded * config.jitterRatio;
  const jitter = (Math.random() * 2 - 1) * jitterRange;

  // 3. Return rounded non-negative delay
  return Math.max(0, Math.round(bounded + jitter));
};
