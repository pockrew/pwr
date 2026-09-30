import { createQuery } from "@tanstack/solid-query";
import { createMemo, createRoot, createSignal } from "solid-js";

import type { AgentTunnelSession } from "@pockrew/pwr-shared/schemas";

import { fetchTunnels } from "~/libs/api-client";
import { queryClient } from "~/libs/query-client";

const STORAGE_KEY = "pwr_selected_tunnel";

/** The last selected tunnel ID; a display preference only, never agent data. */
const savedSelection = (): string => {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
};

/**
 * The agent's saved tunnels and which one Studio is viewing. The single source of the active
 * tunnel ID for the request feed, endpoints, and settings. Only the ID is kept in browser storage.
 */
export const tunnelStore = createRoot(() => {
  const [selectedId, setSelectedId] = createSignal(savedSelection());

  // Polled so tunnels connected from the CLI appear without a reload.
  const tunnelsQuery = createQuery(
    () => ({
      queryKey: ["tunnels"],
      queryFn: async (): Promise<AgentTunnelSession[]> => (await fetchTunnels()).tunnels,
      refetchInterval: 10_000,
    }),
    () => queryClient,
  );

  const tunnels = () => tunnelsQuery.data ?? [];

  // The saved choice while it still exists on the agent, else the first tunnel; "" when none.
  const tunnelId = createMemo(() => {
    const list = tunnels();
    const saved = selectedId();
    if (list.some((t) => t.tunnelId === saved)) return saved;
    return list[0]?.tunnelId ?? "";
  });

  return {
    get tunnels() {
      return tunnels();
    },
    get tunnelId() {
      return tunnelId();
    },
    /** The selected tunnel's saved session, or undefined when none is selected. */
    get session() {
      const id = tunnelId();
      return tunnels().find((t) => t.tunnelId === id);
    },
    /** True until the agent's tunnel list has been answered at least once. */
    get isLoading() {
      return tunnelsQuery.isLoading;
    },
    get error() {
      return tunnelsQuery.error;
    },
    /** Re-reads the agent's list, e.g. right after connecting a tunnel. */
    refresh: async () => {
      await tunnelsQuery.refetch();
    },
    select: (id: string) => {
      setSelectedId(id);
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {
        // Preference only; the selection still applies to this session.
      }
    },
  };
});
