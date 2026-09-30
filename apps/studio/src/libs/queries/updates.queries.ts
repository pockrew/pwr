import { createMutation, createQuery } from "@tanstack/solid-query";

import type { AgentUpdateStatus } from "@pockrew/pwr-shared/schemas";

import {
  applyUpdate,
  checkForUpdate,
  fetchUpdateStatus,
  saveUpdateMode,
  type IAgentHealthResponse,
} from "~/libs/api-client";
import { queryClient } from "~/libs/query-client";

import { agentKeys, waitForAgent } from "./agent.queries";

export const updateKeys = {
  status: ["agent", "updates"] as const,
};

/** Longest wait for both release downloads before giving up on progress. */
const INSTALL_TIMEOUT_MS = 20 * 60_000;

const storeStatus = (status: AgentUpdateStatus) =>
  queryClient.setQueryData(updateKeys.status, status);

/** Update status; polled every second while a check or install is running. */
export const createUpdateStatusQuery = () =>
  createQuery(() => ({
    queryKey: updateKeys.status,
    queryFn: fetchUpdateStatus,
    refetchInterval: (query) => (query.state.data?.state === "idle" ? 60_000 : 1_000),
    retry: false,
  }));

/** Check GitHub now. */
export const createCheckUpdateMutation = () =>
  createMutation(() => ({ mutationFn: checkForUpdate, onSuccess: storeStatus }));

/** Switch between manual and automatic updates; resolves after config.toml is saved. */
export const createUpdateModeMutation = () =>
  createMutation(() => ({ mutationFn: saveUpdateMode, onSuccess: storeStatus }));

/** Wait until the agent restarts for the install, or throw the install error. */
const waitForInstall = async (): Promise<void> => {
  const deadline = Date.now() + INSTALL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const status = await fetchUpdateStatus().catch(() => null);
    // The agent stops answering once it shuts down to restart into the new binaries.
    if (!status || status.state === "restarting") return;
    storeStatus(status);
    if (status.state === "idle") throw new Error(status.lastError ?? "The update stopped");
  }
  throw new Error("The update is taking too long; check the agent log.");
};

/**
 * Install the latest release. Resolves only once the restarted agent answers on the new version.
 */
export const createApplyUpdateMutation = () =>
  createMutation(() => ({
    mutationFn: async () => {
      const started = await applyUpdate();
      storeStatus(started);
      const target = started.latestVersion;
      await waitForInstall();
      return waitForAgent(
        (probe): probe is IAgentHealthResponse => probe?.version === target,
        `The agent did not come back on v${target}. Check \`pwr agent status\` and the agent log.`,
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: updateKeys.status });
      void queryClient.invalidateQueries({ queryKey: agentKeys.health });
    },
  }));
