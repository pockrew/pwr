import { Show, type Component } from "solid-js";

import { Badge, Button } from "@pockrew/pwr-ui/core";

import { endpointsStore } from "~/stores/endpoints.store";

interface SyncStateProps {
  kind: "collection" | "endpoint";
  id: string;
  pending: boolean;
  hasConflict: boolean;
}

const CONFIRM = {
  local: "Keep this agent's version?\n\nIt replaces the server's version of this record.",
  server:
    "Take the server's version?\n\nThe changes made on this agent to this record are discarded.",
} as const;

/**
 * Sync state of a record edited on this agent. A conflict (changed here and on the server while
 * offline) stays until the user picks a side; timestamps never decide.
 */
export const SyncState: Component<SyncStateProps> = (props) => {
  const resolve = (event: MouseEvent, choice: "local" | "server") => {
    event.stopPropagation();
    if (window.confirm(CONFIRM[choice]))
      void endpointsStore.resolveConflict(props.kind, props.id, choice);
  };

  return (
    <Show
      when={props.hasConflict}
      fallback={
        <Show when={props.pending}>
          <Badge variant="warning" size="sm" title="Saved on this agent; not yet on the server">
            not synced
          </Badge>
        </Show>
      }
    >
      <div class="flex flex-wrap items-center gap-1">
        <Badge variant="destructive" size="sm" title="Changed here and on the server while offline">
          conflict
        </Badge>
        <Button
          size="xs"
          variant="outline"
          pill
          onClick={(event: MouseEvent) => resolve(event, "local")}
        >
          Keep mine
        </Button>
        <Button
          size="xs"
          variant="outline"
          pill
          onClick={(event: MouseEvent) => resolve(event, "server")}
        >
          Use server
        </Button>
      </div>
    </Show>
  );
};
