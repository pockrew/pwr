import { Show, type Component } from "solid-js";

import { endpointsStore } from "~/stores/endpoints.store";
import { wsStore } from "~/stores/ws.store";

/**
 * Hairline indeterminate progress bar displayed at the top of the sidebar
 * whenever the agent is actively syncing config or loading server events.
 */
export const SidebarSyncIndicator: Component = () => {
  const isSyncing = () => wsStore.isLoading || wsStore.isReconnecting || endpointsStore.isSyncing;

  return (
    <div
      class="relative h-0.5 w-full overflow-hidden bg-transparent"
      title={isSyncing() ? "Syncing data with server..." : undefined}
    >
      <Show when={isSyncing()}>
        <div class="via-primary h-full w-full animate-pulse bg-linear-to-r from-transparent to-transparent" />
      </Show>
    </div>
  );
};
