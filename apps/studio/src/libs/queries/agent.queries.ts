import { createMutation, createQuery } from "@tanstack/solid-query";

import {
  fetchAgentHealth,
  restartAgent,
  stopAgent,
  type IAgentHealthResponse,
} from "~/libs/api-client";
import { queryClient } from "~/libs/query-client";

export const agentKeys = {
  health: ["agent", "health"] as const,
};

const PROBE_INTERVAL_MS = 500;
/** Covers the graceful shutdown (in-flight target calls commit first) plus the new process boot. */
const LIFECYCLE_TIMEOUT_MS = 30_000;

type HealthProbe = IAgentHealthResponse | null;

/**
 * Probe health until `isDone` accepts the result (null while the agent does not answer).
 * @throws `timeoutMessage` when the agent does not reach that state in time.
 */
export const waitForAgent = async <T extends HealthProbe>(
  isDone: (probe: HealthProbe) => probe is T,
  timeoutMessage: string,
): Promise<T> => {
  const deadline = Date.now() + LIFECYCLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const probe = await fetchAgentHealth().catch(() => null);
    if (isDone(probe)) return probe;
    await new Promise((resolve) => setTimeout(resolve, PROBE_INTERVAL_MS));
  }
  throw new Error(timeoutMessage);
};

/** Live agent health; an error means the agent is not answering. */
export const createAgentHealthQuery = () =>
  createQuery(() => ({
    queryKey: agentKeys.health,
    queryFn: fetchAgentHealth,
    refetchInterval: 5_000,
    retry: false,
  }));

/** Stop the agent; resolves only once it no longer answers. */
export const createStopAgentMutation = () =>
  createMutation(() => ({
    mutationFn: async () => {
      await stopAgent();
      await waitForAgent(
        (probe): probe is null => probe === null,
        "The agent is still running after 30s. Check its log with `pwr agent logs`.",
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: agentKeys.health }),
  }));

/** Restart the agent; resolves with the health of the new process once it answers. */
export const createRestartAgentMutation = () =>
  createMutation(() => ({
    mutationFn: async () => {
      const requestedAt = Date.now();
      await restartAgent();
      // A process started after the request has been up no longer than the time since it.
      return waitForAgent(
        (probe): probe is IAgentHealthResponse =>
          probe !== null && probe.uptimeSeconds <= Math.floor((Date.now() - requestedAt) / 1000),
        "The agent did not come back within 30s. Start it with `pwr agent start` and check `pwr agent logs`.",
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: agentKeys.health }),
  }));
