import { createVirtualizer } from "@tanstack/solid-virtual";
import { createEffect, For, Show, type Component } from "solid-js";

import type { LogEntry, LogLevel } from "@pockrew/pwr-shared/schemas";
import { Badge } from "@pockrew/pwr-ui/core";

const LEVEL_BADGE: Record<LogLevel, "secondary" | "info" | "warning" | "destructive"> = {
  trace: "secondary",
  debug: "secondary",
  info: "info",
  warning: "warning",
  error: "destructive",
  fatal: "destructive",
};
const LEVEL_LABEL: Record<LogLevel, string> = {
  trace: "trace",
  debug: "debug",
  info: "info",
  warning: "warn",
  error: "error",
  fatal: "fatal",
};

/** Start loading the next (older) page this many rows before the end. */
const LOAD_MORE_THRESHOLD = 40;

const timeFormat = new Intl.DateTimeFormat(undefined, {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
  hourCycle: "h23",
});

/** Local `MM/DD, HH:mm:ss.SSS`; raw lines without a timestamp show a dash. */
export const formatLogTime = (iso: string | null): string =>
  iso ? timeFormat.format(new Date(iso)) : "—";

/** `key=value` pairs of the structured properties (request IDs, tunnel IDs, errors…). */
const propertyText = (properties: Record<string, unknown>): string =>
  Object.entries(properties)
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" ");

const LogRow: Component<{ entry: LogEntry }> = (props) => (
  <div class="hover:bg-muted/40 flex items-start gap-2 px-3 py-0.5 font-mono text-xs leading-5">
    <span class="text-muted-foreground w-40 shrink-0 tabular-nums select-none">
      {formatLogTime(props.entry.timestamp)}
    </span>
    <Badge
      variant={LEVEL_BADGE[props.entry.level]}
      class="mt-0.5 w-12 shrink-0 justify-center px-1 py-0 font-bold uppercase"
    >
      {LEVEL_LABEL[props.entry.level]}
    </Badge>
    <Show when={props.entry.category}>
      {(category) => <span class="shrink-0 text-blue-600 dark:text-cyan-400">[{category()}]</span>}
    </Show>
    <span class="min-w-0 break-all whitespace-pre-wrap">
      <span class="text-foreground/90">{props.entry.message}</span>
      <Show when={Object.keys(props.entry.properties).length}>
        <span class="text-muted-foreground"> {propertyText(props.entry.properties)}</span>
      </Show>
    </span>
  </div>
);

interface LogListProps {
  /** Newest first. */
  entries: LogEntry[];
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onAtTopChange: (atTop: boolean) => void;
  /** Receives a function that scrolls back to the newest entry. */
  scrollToTopRef: (scrollToTop: () => void) => void;
}

/**
 * Virtualized newest-first log list: only visible rows are in the DOM, so hundreds of thousands
 * of loaded entries scroll smoothly. Older pages load as the end comes into view.
 */
export const LogList: Component<LogListProps> = (props) => {
  let scrollElement: HTMLDivElement | undefined;
  const virtualizer = createVirtualizer({
    get count() {
      return props.entries.length + (props.hasMore ? 1 : 0);
    },
    getScrollElement: () => scrollElement ?? null,
    estimateSize: () => 22,
    overscan: 20,
    getItemKey: (index) => props.entries[index]?.id ?? "more",
  });
  props.scrollToTopRef(() => virtualizer.scrollToOffset(0));

  createEffect(() => {
    const last = virtualizer.getVirtualItems().at(-1);
    if (!last || !props.hasMore || props.isLoadingMore) return;
    if (last.index >= props.entries.length - LOAD_MORE_THRESHOLD) props.onLoadMore();
  });

  return (
    <div
      ref={(element) => (scrollElement = element)}
      class="h-full overflow-auto"
      onScroll={(event) => props.onAtTopChange(event.currentTarget.scrollTop < 8)}
    >
      <div class="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        <For each={virtualizer.getVirtualItems()}>
          {(item) => (
            <div
              data-index={item.index}
              ref={(element) => queueMicrotask(() => virtualizer.measureElement(element))}
              class="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <Show
                when={props.entries[item.index]}
                fallback={
                  <div class="text-muted-foreground px-3 py-2 text-xs">Loading older entries…</div>
                }
              >
                {(entry) => <LogRow entry={entry()} />}
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};
