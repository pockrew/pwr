import { For, type Component } from "solid-js";

import { Card } from "@pockrew/pwr-ui/core";

export interface EventListSkeletonProps {
  count?: number;
}

export const EventListSkeleton: Component<EventListSkeletonProps> = (props) => {
  const items = () => Array.from({ length: props.count ?? 7 });

  return (
    <div class="divide-border flex-1 divide-y overflow-hidden select-none">
      <For each={items()}>
        {() => (
          <Card class="flex flex-col gap-2.5 rounded-none border-t-0 border-r-0 border-l-2 border-l-transparent p-2.5">
            <div class="flex items-center justify-between gap-2 text-xs">
              <div class="flex min-w-0 items-center gap-2">
                <div class="bg-muted size-3.5 animate-pulse rounded" />
                <div class="bg-muted h-4.5 w-10 animate-pulse rounded-full" />
                <div class="bg-muted h-4.5 w-14 animate-pulse rounded-full" />
              </div>
            </div>
            <div class="bg-muted h-3.5 w-2/3 animate-pulse rounded" />
            <div class="flex w-full items-center justify-between pt-0.5 font-mono text-xs">
              <div class="flex shrink-0 items-center gap-2">
                <div class="bg-muted/70 h-3 w-12 animate-pulse rounded" />
                <div class="bg-muted/70 h-3 w-14 animate-pulse rounded" />
              </div>
              <div class="bg-muted/60 h-3 w-20 animate-pulse rounded" />
            </div>
          </Card>
        )}
      </For>
    </div>
  );
};
