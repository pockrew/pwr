import { type Component } from "solid-js";

import { cn } from "@pockrew/pwr-ui/libs";

import type { AlignedDiffLine } from "~/libs/diff-utils";

import { DiffBodyColumn } from "./diff-body-column";
import { DiffCategoryBadge } from "./diff-category-badge";

export interface DiffRowProps {
  line: AlignedDiffLine;
  isCollapsed: boolean;
  onToggleFold: () => void;
}

/**
 * Individual aligned diff row containing diff category and dual-side code columns.
 */
export const DiffRow: Component<DiffRowProps> = (props) => {
  const isTypeDiff = () => props.line.category === "types";
  const isValueDiff = () => props.line.category === "value";
  const isAttrDiff = () => props.line.category === "attributes";

  return (
    <div
      class={cn(
        "grid min-h-5 min-w-full grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)] items-stretch leading-5 transition-colors",
        isTypeDiff() && "bg-purple-500/10 dark:bg-purple-500/15",
        isValueDiff() && "bg-amber-500/10 dark:bg-amber-500/15",
      )}
    >
      {/* Column 1: Diff Category */}
      <div class="border-border/30 flex items-center justify-center border-r px-1 select-none">
        <DiffCategoryBadge category={props.line.category} />
      </div>

      {/* Column 2: Body A */}
      <DiffBodyColumn
        side="left"
        lineNum={props.line.leftLineNum}
        text={props.line.leftText}
        foldPlaceholder={props.line.leftFoldPlaceholder}
        isFoldable={props.line.isFoldable}
        isCollapsed={props.isCollapsed}
        isTypeDiff={isTypeDiff()}
        isValueDiff={isValueDiff()}
        isAttrDiff={isAttrDiff()}
        onToggleFold={props.onToggleFold}
      />

      {/* Column 3: Body B */}
      <DiffBodyColumn
        side="right"
        lineNum={props.line.rightLineNum}
        text={props.line.rightText}
        foldPlaceholder={props.line.rightFoldPlaceholder}
        isFoldable={props.line.isFoldable}
        isCollapsed={props.isCollapsed}
        isTypeDiff={isTypeDiff()}
        isValueDiff={isValueDiff()}
        isAttrDiff={isAttrDiff()}
        onToggleFold={props.onToggleFold}
      />
    </div>
  );
};
