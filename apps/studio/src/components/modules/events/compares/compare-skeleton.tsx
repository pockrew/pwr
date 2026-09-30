import { For, type Component } from "solid-js";

import { cn } from "@pockrew/pwr-ui/libs";

export const CompareSkeleton: Component = () => {
  const linePlaceholders = [
    { widthA: "w-48", widthB: "w-48" },
    { widthA: "w-64", widthB: "w-64" },
    { widthA: "w-72", widthB: "w-80" },
    { widthA: "w-56", widthB: "w-56" },
    { widthA: "w-40", widthB: "w-44" },
    { widthA: "w-80", widthB: "w-72" },
    { widthA: "w-36", widthB: "w-36" },
    { widthA: "w-60", widthB: "w-64" },
    { widthA: "w-52", widthB: "w-52" },
    { widthA: "w-28", widthB: "w-32" },
  ];

  return (
    <div class="flex h-full w-full flex-col overflow-hidden select-none">
      {/* Comparison Header Meta Grid Skeleton */}
      <div class="border-border bg-card/40 divide-border grid shrink-0 grid-cols-2 divide-x border-b">
        {/* Column A */}
        <div class="flex flex-col gap-2 p-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div class="bg-muted h-5 w-10 animate-pulse rounded-full" />
              <div class="bg-muted h-5 w-14 animate-pulse rounded-full" />
              <div class="bg-muted/60 h-4 w-24 animate-pulse rounded" />
            </div>
            <div class="bg-muted/50 h-3.5 w-24 animate-pulse rounded" />
          </div>
          <div class="bg-muted h-4 w-52 animate-pulse rounded" />
          <div class="flex items-center justify-between">
            <div class="bg-muted/60 h-3 w-20 animate-pulse rounded" />
            <div class="bg-muted/60 h-3 w-16 animate-pulse rounded" />
          </div>
        </div>

        {/* Column B */}
        <div class="flex flex-col gap-2 p-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div class="bg-muted h-5 w-10 animate-pulse rounded-full" />
              <div class="bg-muted h-5 w-14 animate-pulse rounded-full" />
              <div class="bg-muted/60 h-4 w-24 animate-pulse rounded" />
            </div>
            <div class="bg-muted/50 h-3.5 w-24 animate-pulse rounded" />
          </div>
          <div class="bg-muted h-4 w-48 animate-pulse rounded" />
          <div class="flex items-center justify-between">
            <div class="bg-muted/60 h-3 w-20 animate-pulse rounded" />
            <div class="bg-muted/60 h-3 w-16 animate-pulse rounded" />
          </div>
        </div>
      </div>

      {/* Diff Viewer Skeleton Grid */}
      <div class="divide-border grid flex-1 grid-cols-2 divide-x overflow-hidden p-3 font-mono">
        {/* Side A Lines */}
        <div class="space-y-3 pr-3">
          <For each={linePlaceholders}>
            {(item, i) => (
              <div class="flex items-center gap-3">
                <span class="text-muted-foreground/30 w-6 text-right text-xs">{i() + 1}</span>
                <div class={cn("bg-muted/40 h-3.5 animate-pulse rounded", item.widthA)} />
              </div>
            )}
          </For>
        </div>

        {/* Side B Lines */}
        <div class="space-y-3 pl-3">
          <For each={linePlaceholders}>
            {(item, i) => (
              <div class="flex items-center gap-3">
                <span class="text-muted-foreground/30 w-6 text-right text-xs">{i() + 1}</span>
                <div class={cn("bg-muted/40 h-3.5 animate-pulse rounded", item.widthB)} />
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
};
