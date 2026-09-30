import { Show, type Component } from "solid-js";

import { Button } from "@pockrew/pwr-ui/core";

import type { AlignedDiffResult } from "~/libs/diff-utils";

export interface DiffSummaryHeaderProps {
  diffResult: AlignedDiffResult;
  labelA?: string;
  labelB?: string;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

/**
 * Top summary bar and column headers for the payload diff viewer.
 */
export const DiffSummaryHeader: Component<DiffSummaryHeaderProps> = (props) => {
  return (
    <>
      {/* Diff Toolbar / Summary Header */}
      <div class="border-border/60 bg-muted/30 flex shrink-0 items-center justify-between border-b px-3 py-1.5 text-xs">
        <div class="flex items-center gap-3">
          <span class="text-muted-foreground font-semibold">Diff Summary:</span>
          <Show
            when={props.diffResult.hasChanges}
            fallback={
              <span class="font-medium text-emerald-600 dark:text-emerald-400">
                Identical (No differences)
              </span>
            }
          >
            <div class="flex items-center gap-2.5">
              <span class="font-mono text-xs font-bold text-amber-600 dark:text-amber-400">
                {props.diffResult.counts.value} VALUE
              </span>
              <span class="font-mono text-xs font-bold text-purple-600 dark:text-purple-400">
                {props.diffResult.counts.types} TYPE
              </span>
              <span class="font-mono text-xs font-bold text-sky-600 dark:text-sky-400">
                {props.diffResult.counts.attributes} ATTR
              </span>
            </div>
          </Show>
        </div>

        {/* Collapse / Expand Controls */}
        <Show when={props.diffResult.foldableIds.length > 0}>
          <div class="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="xs"
              class="h-6 px-2 text-xs"
              onClick={props.onExpandAll}
            >
              Expand All
            </Button>
            <Button
              variant="outline"
              size="xs"
              class="h-6 px-2 text-xs"
              onClick={props.onCollapseAll}
            >
              Collapse All
            </Button>
          </div>
        </Show>
      </div>

      {/* Main Aligned Diff Grid Header: | TYPE | body a | body b | */}
      <div class="border-border/60 bg-muted/40 text-muted-foreground grid shrink-0 grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)] border-b text-xs font-semibold">
        <div class="border-border/40 flex items-center justify-center border-r px-2 py-1.5 tracking-wider uppercase">
          TYPE
        </div>
        <div class="border-border/40 flex items-center justify-between border-r px-3 py-1.5">
          <span class="text-foreground font-semibold">{props.labelA ?? "body a"}</span>
          <span class="text-muted-foreground/60 text-xs font-normal">Base</span>
        </div>
        <div class="flex items-center justify-between px-3 py-1.5">
          <span class="text-foreground font-semibold">{props.labelB ?? "body b"}</span>
          <span class="text-muted-foreground/60 text-xs font-normal">Compared</span>
        </div>
      </div>
    </>
  );
};
