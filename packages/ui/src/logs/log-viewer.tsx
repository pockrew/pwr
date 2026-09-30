import { onCleanup, onMount, Show, type Component } from "solid-js";

import type { LogEntry } from "@pockrew/pwr-shared/schemas";
import { Badge, Button, isInputFocused, isOverlayOpen, toast } from "@pockrew/pwr-ui/core";

import { formatLogTime, LogList } from "./log-list";
import { LogToolbar } from "./log-toolbar";
import { createLogViewerState, type LogSource } from "./log-viewer.state";

/** Plain-text line of an entry for the clipboard. */
const entryText = (entry: LogEntry): string => {
  const category = entry.category ? `[${entry.category}] ` : "";
  const properties = Object.keys(entry.properties).length
    ? ` ${JSON.stringify(entry.properties)}`
    : "";
  return `${entry.timestamp ?? "-"} ${entry.level.toUpperCase()} ${category}${entry.message}${properties}`;
};

interface LogViewerProps extends LogSource {
  title: string;
}

/**
 * Log page shared by Studio (agent.log) and Admin (server.log): newest-first infinite scroll over
 * a virtualized list, level/text/time filters applied by the API, and a live tail while the range
 * is open-ended. `/` or ⌘F focuses the search.
 */
export const LogViewer: Component<LogViewerProps> = (props) => {
  const state = createLogViewerState(props);
  let scrollToTop = () => {};
  let searchInput: HTMLInputElement | undefined;

  const copyLoaded = () => {
    const text = state.entries().toReversed().map(entryText).join("\n");
    navigator.clipboard.writeText(text).then(
      () => toast.success(`Copied ${state.entries().length} entries`),
      () => toast.error("Could not copy to the clipboard"),
    );
  };

  onMount(() => {
    const focusSearch = () => searchInput?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isInputFocused() || isOverlayOpen()) return;
      const find = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f";
      if (event.key !== "/" && !find) return;
      event.preventDefault();
      focusSearch();
    };
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("studio:focus-search", focusSearch);
    onCleanup(() => {
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("studio:focus-search", focusSearch);
    });
  });

  const tailStatus = (): { label: string; variant: "success" | "secondary" | "warning" } => {
    if (!state.canFollow()) return { label: "Range ended", variant: "secondary" };
    if (!state.following()) return { label: "Paused", variant: "secondary" };
    return state.connected()
      ? { label: "Live", variant: "success" }
      : { label: "Connecting…", variant: "warning" };
  };

  const emptyText = () => {
    if (state.page()?.exists === false)
      return "No log file yet; it is created with the first entry.";
    return state.page()?.nextCursor
      ? "Nothing matched in the newest part of the log."
      : "No entries match these filters.";
  };

  return (
    <div class="flex h-full w-full flex-col gap-4">
      <div class="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div class="flex items-center gap-2">
            <h3 class="text-foreground text-lg font-bold">{props.title}</h3>
            <Badge variant={tailStatus().variant} class="text-xs">
              {tailStatus().label}
            </Badge>
          </div>
          <p class="text-muted-foreground font-mono text-xs">{state.page()?.logFile ?? "…"}</p>
        </div>
        <span class="text-muted-foreground text-xs">
          {state.entries().length} loaded{state.page()?.nextCursor ? " · scroll for older" : ""}
        </span>
      </div>

      <LogToolbar
        level={state.level()}
        onLevelChange={state.setLevel}
        search={state.search()}
        onSearchChange={state.setSearch}
        searchRef={(element) => (searchInput = element)}
        range={state.range()}
        onRangeChange={state.changeRange}
        customFrom={state.custom().from}
        customTo={state.custom().to}
        onCustomChange={state.changeCustom}
        following={state.following()}
        canFollow={state.canFollow()}
        onFollowChange={state.setFollowing}
        onReload={() => void state.loadNewest()}
        onCopy={copyLoaded}
      />

      <div class="border-border bg-muted/20 relative min-h-80 flex-1 overflow-hidden rounded-md border">
        <Show when={state.held().length}>
          <Button
            size="xs"
            pill
            class="absolute top-2 left-1/2 z-10 -translate-x-1/2 shadow-md"
            onClick={() => {
              state.showHeld();
              scrollToTop();
            }}
          >
            ↑ {state.held().length} new
          </Button>
        </Show>
        <Show
          when={!state.loading() && !state.error() && state.entries().length}
          fallback={
            <div class="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm">
              <Show when={state.loading()}>Loading…</Show>
              <Show when={state.error()}>
                {(message) => (
                  <>
                    <span>Could not read the log: {message()}</span>
                    <Button variant="outline" size="sm" onClick={() => void state.loadNewest()}>
                      Retry
                    </Button>
                  </>
                )}
              </Show>
              <Show when={!state.loading() && !state.error()}>
                {emptyText()}
                <Show when={state.page()?.nextCursor}>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={state.loadingMore()}
                    onClick={() => void state.loadOlder()}
                  >
                    Search older entries
                  </Button>
                </Show>
              </Show>
            </div>
          }
        >
          <LogList
            entries={state.entries()}
            hasMore={Boolean(state.page()?.nextCursor)}
            isLoadingMore={state.loadingMore()}
            onLoadMore={() => void state.loadOlder()}
            onAtTopChange={state.setAtTop}
            scrollToTopRef={(scroll) => (scrollToTop = scroll)}
          />
        </Show>
      </div>
      <Show when={state.entries().length}>
        <p class="text-muted-foreground text-xs">
          Oldest loaded: {formatLogTime(state.entries().at(-1)?.timestamp ?? null)}
        </p>
      </Show>
    </div>
  );
};
