import type { AgentUpdateMode, AgentUpdateStatus } from "@pockrew/pwr-shared/schemas";

import { rpc, unwrapRpc } from "./client";

/** Current version, last release check and any update in progress. */
export const fetchUpdateStatus = async (): Promise<AgentUpdateStatus> =>
  unwrapRpc(await rpc.updates.$get());

/** Ask the agent to check GitHub now; a failed check is reported in `lastError`. */
export const checkForUpdate = async (): Promise<AgentUpdateStatus> =>
  unwrapRpc(await rpc.updates.check.$post());

/**
 * Start downloading and installing the latest release; the agent restarts when it is done.
 * @throws When this install cannot update, an update is already running, or none is newer.
 */
export const applyUpdate = async (): Promise<AgentUpdateStatus> =>
  unwrapRpc(await rpc.updates.apply.$post());

/** Save the update mode to the agent's config.toml. */
export const saveUpdateMode = async (mode: AgentUpdateMode): Promise<AgentUpdateStatus> =>
  unwrapRpc(await rpc.updates.config.$put({ json: { mode } }));
