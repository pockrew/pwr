import type { AgentStorageStatus } from "@pockrew/pwr-shared/schemas";

import { rpc, unwrapRpc } from "./client";

export interface IAgentHealthResponse {
  status: string;
  version: string;
  storage: AgentStorageStatus;
  uptimeSeconds: number;
  activeTunnelsCount: number;
  totalTunnelsCount: number;
}

/**
 * Queries the agent daemon health, uptime, and active tunnel count.
 * @throws When the agent is unreachable or answers with an error.
 */
export const fetchAgentHealth = async (): Promise<IAgentHealthResponse> =>
  unwrapRpc(await rpc.health.$get());

/**
 * Asks the agent to shut down gracefully; it stays stopped until `pwr agent start`.
 * @throws When the agent rejects or cannot receive the request.
 */
export const stopAgent = async (): Promise<void> => {
  await unwrapRpc(await rpc.agent.stop.$post());
};

/**
 * Asks the agent to restart; the new process comes up on the same port after the old one exits.
 * @throws When the agent rejects the request or cannot start its replacement.
 */
export const restartAgent = async (): Promise<void> => {
  await unwrapRpc(await rpc.agent.restart.$post());
};
