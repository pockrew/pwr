import type { MaintenanceActionInput, RetentionConfig } from "@pockrew/pwr-shared/schemas";

/** Keep delivery identities for 30 days after payload pruning; never shorten this on manual clean. */
export const RELAY_DEDUPE_DAYS = 30;

export interface IPruneFilter {
  cutoffTimestampMs?: number | undefined;
  projectIds?: readonly string[] | undefined;
  maxEvents?: number | undefined;
}

/**
 * Computes the epoch cutoff timestamp in milliseconds based on a retention window in days.
 *
 * @param retentionDays - Number of days to retain logs.
 * @returns Epoch millisecond timestamp threshold.
 */
export const calculateRetentionCutoffMs = (retentionDays: number): number => {
  // 1. Capture current system epoch time
  const now = Date.now();

  // 2. Convert days to milliseconds
  const daysInMs = retentionDays * 24 * 60 * 60 * 1000;

  // 3. Compute and return threshold cutoff timestamp
  return now - daysInMs;
};

/**
 * Validates a maintenance request against safety rules to prevent accidental bulk data loss.
 *
 * @param input - Maintenance action input parameters.
 * @returns Object indicating validity or warning/error explanation.
 */
export const validateMaintenanceRequest = (
  input: MaintenanceActionInput,
): { valid: boolean; error?: string | undefined; warning?: string | undefined } => {
  // 1. Enforce confirmation token requirement when operating on all projects
  if (input.all) {
    if (input.confirmToken !== "CONFIRM_ALL") {
      return {
        valid: false,
        warning:
          "CRITICAL WARNING: This action will affect ALL projects across the organization. You must provide confirmToken='CONFIRM_ALL' to proceed.",
      };
    }
    return { valid: true };
  }

  // 2. Validate maximum project batch limit constraint (max 3 projects)
  if (input.projects && input.projects.length > 3) {
    return {
      valid: false,
      error:
        "INVALID_OPERATION: Bulk action is restricted to a maximum of 3 projects per operation to prevent accidental data loss.",
    };
  }

  // 3. Ensure at least one filtering constraint is provided
  if ((!input.projects || input.projects.length === 0) && !input.days) {
    return {
      valid: false,
      error:
        "INVALID_OPERATION: Must specify target projects (up to 3) or a days cutoff constraint.",
    };
  }

  // 4. Request passes safety validation
  return { valid: true };
};

/**
 * Constructs a bounded prune filter configuration for database maintenance sweeps.
 *
 * @param config - Base retention settings.
 * @param overrideDays - Optional custom days threshold overriding default config.
 * @param projects - Optional project identifiers to scope pruning.
 */
export const buildPruneFilter = (
  config: RetentionConfig,
  overrideDays?: number,
  projects?: readonly string[],
): IPruneFilter => {
  // 1. Resolve effective retention duration in days
  const days = overrideDays ?? config.retentionDays;

  // 2. Compute absolute cutoff epoch timestamp
  const cutoffTimestampMs = calculateRetentionCutoffMs(days);

  // 3. Construct bounded prune filter parameters
  return {
    cutoffTimestampMs,
    projectIds: projects && projects.length > 0 ? projects : undefined,
    maxEvents: config.maxEvents,
  };
};
