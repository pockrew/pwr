import type { AgentStorageStatus, RetentionConfig } from "@pockrew/pwr-shared/schemas";

import { rpc, unwrapRpc } from "./client";

export interface IRetentionResponse {
  config: RetentionConfig;
  capabilities: {
    relayHistoryPruning: boolean;
    hardSizeLimit: boolean;
    intakeBackpressure: boolean;
  };
  storage: AgentStorageStatus;
}

export interface IMaintenanceCleanResult {
  action: string;
  affectedProjects: string[];
  processedCount: number;
  deletedCount: number;
  deletedPackages: number;
  storage: AgentStorageStatus;
  durationMs: number;
}

/**
 * Retention policy and current storage status of the agent.
 * @throws When the agent is unreachable or answers with an error.
 */
export const fetchRetention = async (): Promise<IRetentionResponse> =>
  unwrapRpc(await rpc.retention.$get());

/**
 * Save the retention policy; the agent applies it immediately.
 * @throws When the agent rejects or cannot store it.
 */
export const saveRetention = async (payload: RetentionConfig): Promise<IRetentionResponse> =>
  unwrapRpc(await rpc.retention.$put({ json: payload }));

/**
 * Prune confirmed history older than `days` under the same safe policy as the background sweep.
 * @throws When the agent refuses or the cleanup fails.
 */
export const pruneOlderThan = async (days: number): Promise<IMaintenanceCleanResult> =>
  unwrapRpc(await rpc.maintenance.clean.$post({ json: { action: "clean", days, all: false } }));
