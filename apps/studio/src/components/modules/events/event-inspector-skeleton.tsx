import { For, type Component } from "solid-js";

import { cn } from "@pockrew/pwr-ui/libs";

export const EventInspectorSkeleton: Component = () => {
  const codeLines = [
    "w-24",
    "w-48",
    "w-72",
    "w-56",
    "w-64",
    "w-40",
    "w-80",
    "w-60",
    "w-36",
    "w-52",
    "w-20",
  ];

  return (
    <div class="bg-background flex h-full flex-1 flex-col overflow-hidden select-none">
      {/* Top Event Telemetry Bar */}
      <div class="border-border bg-card/30 flex h-11 w-full shrink-0 items-center justify-between border-b px-3 py-1.5">
        <div class="flex items-center gap-2">
          <div class="bg-muted h-5 w-11 animate-pulse rounded-full" />
          <div class="bg-muted h-4 w-44 animate-pulse rounded" />
        </div>
        <div class="flex items-center gap-2">
          <div class="bg-muted/70 h-3.5 w-12 animate-pulse rounded" />
          <div class="bg-border h-3 w-px" />
          <div class="bg-muted/70 h-3.5 w-14 animate-pulse rounded" />
          <div class="bg-border h-3 w-px" />
          <div class="bg-muted/70 h-3.5 w-20 animate-pulse rounded" />
        </div>
      </div>

      {/* Sub Bar: ID & Content-Type */}
      <div class="border-border bg-card/20 flex h-10 w-full shrink-0 items-center justify-between border-b px-3">
        <div class="bg-muted/50 h-3.5 w-40 animate-pulse rounded" />
        <div class="bg-muted/50 h-3.5 w-32 animate-pulse rounded" />
      </div>

      {/* Tabs Bar */}
      <div class="border-border bg-card/40 flex h-11 shrink-0 items-center justify-between border-b px-3">
        <div class="flex items-center gap-2">
          <div class="bg-muted/60 h-7 w-24 animate-pulse rounded" />
          <div class="bg-muted/40 h-7 w-20 animate-pulse rounded" />
          <div class="bg-muted/40 h-7 w-24 animate-pulse rounded" />
          <div class="bg-muted/40 h-7 w-28 animate-pulse rounded" />
        </div>
        <div class="flex items-center gap-2">
          <div class="bg-muted/50 h-7 w-16 animate-pulse rounded" />
          <div class="bg-muted/50 h-7 w-16 animate-pulse rounded" />
        </div>
      </div>

      {/* Code Viewer Placeholder */}
      <div class="flex-1 space-y-3 overflow-hidden p-4 font-mono">
        <For each={codeLines}>
          {(width, i) => (
            <div class="flex items-center gap-3">
              <span class="text-muted-foreground/30 w-6 text-right text-xs">{i() + 1}</span>
              <div class={cn("h-3.5", width, "bg-muted/40 animate-pulse rounded")} />
            </div>
          )}
        </For>
      </div>
    </div>
  );
};
