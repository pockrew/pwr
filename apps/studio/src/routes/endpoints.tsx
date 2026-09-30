import { Show } from "solid-js";

import { Button } from "@pockrew/pwr-ui/core";
import { Reload } from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

import { CollectionListPanel } from "~/components/modules/endpoints/collection-list-panel";
import { EndpointMatrixPanel } from "~/components/modules/endpoints/endpoint-matrix-panel";
import { formatIsoText } from "~/libs/date-formatter";
import { endpointsStore } from "~/stores/endpoints.store";

/** Server sync state of this tunnel's config, as the agent reports it. */
const syncText = () => {
  const sync = endpointsStore.sync;
  if (!sync) return "Not synced with a server yet";
  if (sync.error) return `Server sync failed: ${sync.error}`;
  return sync.lastSyncedAt
    ? `Synced with the server ${formatIsoText(sync.lastSyncedAt)}`
    : "Waiting for the first server sync";
};

export const EndpointsPage = () => (
  <div class="bg-background grid-swiss grid size-full flex-1 overflow-hidden">
    <div class="flex flex-1 flex-col overflow-hidden">
      <div class="bg-background border-border flex h-11 w-full shrink-0 items-center justify-between border-r border-b px-3">
        <h1 class="text-foreground text-lg font-bold tracking-tight">Endpoints</h1>
        <Button
          variant="outline"
          size="xs"
          pill
          class="h-7 gap-1 px-2 font-mono text-xs"
          onClick={() => void endpointsStore.refetch()}
          disabled={endpointsStore.isSyncing}
          title="Reload collections and endpoints from the agent"
        >
          <Reload class={cn("size-3 shrink-0", endpointsStore.isSyncing && "animate-spin")} />
          <span>Refresh</span>
        </Button>
      </div>
      <p
        class={cn(
          "border-border border-r border-b px-3 py-1.5 text-xs",
          endpointsStore.sync?.error ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {syncText()}
      </p>
      <Show when={endpointsStore.loadError}>
        {(message) => (
          <p class="text-destructive border-border border-r border-b px-3 py-1.5 text-xs">
            Could not load from the agent: {message()}
          </p>
        )}
      </Show>
      <CollectionListPanel />
    </div>

    <EndpointMatrixPanel />
  </div>
);
