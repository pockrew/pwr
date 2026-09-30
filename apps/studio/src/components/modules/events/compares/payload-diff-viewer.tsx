import { createMemo, createSignal, For, type Component } from "solid-js";

import { computeAlignedDiff, type AlignedDiffLine } from "~/libs/diff-utils";

import { DiffRow } from "./diff-row";
import { DiffSummaryHeader } from "./diff-summary-header";

export interface PayloadDiffViewerProps {
  dataA: unknown;
  dataB: unknown;
  labelA?: string;
  labelB?: string;
}

/**
 * Visual side-by-side aligned diff viewer comparing two structured payloads with syntax highlighting,
 * category classification (VALUE, TYPE, ATTR), and collapsible object blocks.
 */
export const PayloadDiffViewer: Component<PayloadDiffViewerProps> = (props) => {
  // 1. Compute aligned diff lines and metrics
  const diffResult = createMemo(() => computeAlignedDiff(props.dataA, props.dataB));

  // 2. State for tracking collapsed foldable block line IDs
  const [collapsedBlocks, setCollapsedBlocks] = createSignal<Set<number>>(new Set());

  // 3. Toggle fold state for an individual block
  const toggleFold = (openLineId: number) => {
    setCollapsedBlocks((prev) => {
      const next = new Set(prev);
      if (next.has(openLineId)) {
        next.delete(openLineId);
      } else {
        next.add(openLineId);
      }
      return next;
    });
  };

  // 4. Batch fold actions
  const collapseAll = () => {
    setCollapsedBlocks(new Set(diffResult().foldableIds));
  };

  const expandAll = () => {
    setCollapsedBlocks(new Set<number>());
  };

  // 5. Compute visible lines respecting collapsed ranges
  const visibleLines = createMemo(() => {
    const lines = diffResult().lines;
    const collapsed = collapsedBlocks();
    if (collapsed.size === 0) return lines;

    const result: AlignedDiffLine[] = [];
    let skippingUntilId: number | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      // Skip lines inside a collapsed block
      if (skippingUntilId !== null) {
        if (line.id <= skippingUntilId) {
          continue;
        }
        skippingUntilId = null;
      }

      result.push(line);

      // If this line is collapsed, skip until its foldEndId
      if (line.isFoldable && line.foldEndId !== undefined && collapsed.has(line.id)) {
        skippingUntilId = line.foldEndId;
      }
    }

    return result;
  });

  return (
    <div class="bg-background text-foreground flex h-full min-h-0 w-full flex-col overflow-hidden font-mono text-xs select-text">
      {/* Diff Toolbar & Headers */}
      <DiffSummaryHeader
        diffResult={diffResult()}
        labelA={props.labelA}
        labelB={props.labelB}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
      />

      {/* Content Scroller (Scrolls X & Y independently inside contents area) */}
      <div class="h-full min-h-0 flex-1 overflow-auto">
        <div class="w-full min-w-max py-1">
          <For
            each={visibleLines()}
            fallback={
              <div class="text-muted-foreground flex h-32 items-center justify-center text-xs">
                No payload content to display
              </div>
            }
          >
            {(line) => (
              <DiffRow
                line={line}
                isCollapsed={collapsedBlocks().has(line.id)}
                onToggleFold={() => toggleFold(line.id)}
              />
            )}
          </For>
        </div>
      </div>
    </div>
  );
};
