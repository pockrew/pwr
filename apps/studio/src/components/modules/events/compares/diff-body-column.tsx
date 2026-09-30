import { Show, type Component } from "solid-js";

import { isNullish } from "@pockrew/pwr-shared/libs";
import { Button } from "@pockrew/pwr-ui/core";
import { ChevronDown, ChevronRight } from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

import { JsonSyntaxLine } from "./json-syntax-line";

export interface DiffBodyColumnProps {
  side: "left" | "right";
  lineNum: number | null;
  text: string;
  foldPlaceholder?: string;
  isFoldable?: boolean;
  isCollapsed: boolean;
  isTypeDiff: boolean;
  isValueDiff: boolean;
  isAttrDiff: boolean;
  onToggleFold: () => void;
}

/**
 * Side-by-side diff body column component rendering line number, fold control, and highlighted code content.
 */
export const DiffBodyColumn: Component<DiffBodyColumnProps> = (props) => {
  // 1. Determine if this column cell is empty
  const isEmpty = () => !props.text && isNullish(props.lineNum);

  // 2. Determine background styling for attribute diffs
  const columnBgClass = () => {
    if (!props.isAttrDiff) return "";
    if (isEmpty()) return "bg-muted/10";
    return props.side === "left"
      ? "bg-rose-500/10 dark:bg-rose-500/15"
      : "bg-emerald-500/10 dark:bg-emerald-500/15";
  };

  // 3. Determine line number color highlight
  const lineNumClass = () => {
    if (props.isTypeDiff) return "font-semibold text-purple-600 dark:text-purple-400";
    if (props.isValueDiff) return "font-semibold text-amber-600 dark:text-amber-400";
    if (props.isAttrDiff && !isEmpty()) {
      return props.side === "left"
        ? "font-semibold text-rose-600 dark:text-rose-400"
        : "font-semibold text-emerald-600 dark:text-emerald-400";
    }
    return "";
  };

  return (
    <div
      class={cn(
        "flex items-stretch px-1",
        props.side === "left" && "border-border/30 border-r",
        columnBgClass(),
      )}
    >
      {/* Line Number & Fold Toggle */}
      <div class="text-muted-foreground/50 flex w-11 shrink-0 items-center justify-end pr-2 select-none">
        <Show when={props.isFoldable && !isEmpty()}>
          <Button
            variant="ghost"
            size="icon-xs"
            class="text-muted-foreground hover:text-foreground mr-1 flex size-3 p-0"
            onClick={props.onToggleFold}
            aria-label={props.isCollapsed ? "Expand block" : "Collapse block"}
            title={props.isCollapsed ? "Expand block" : "Collapse block"}
          >
            <Show when={props.isCollapsed} fallback={<ChevronDown class="size-3" />}>
              <ChevronRight class="size-3" />
            </Show>
          </Button>
        </Show>
        <span class={cn("text-right", lineNumClass())}>{props.lineNum ?? ""}</span>
      </div>

      {/* Content */}
      <div class="flex-1 font-mono whitespace-pre">
        <Show
          when={!isEmpty()}
          fallback={
            <span class="text-transparent select-none" aria-hidden="true">
              {"\u00A0"}
            </span>
          }
        >
          <Show
            when={props.isCollapsed && !!props.foldPlaceholder}
            fallback={<JsonSyntaxLine text={props.text} />}
          >
            <div class="flex items-center gap-1">
              <JsonSyntaxLine text={props.foldPlaceholder!} />
              <button
                type="button"
                class="bg-muted text-muted-foreground hover:bg-muted/80 focus-visible:ring-primary cursor-pointer rounded border-none px-1 text-xs select-none focus:outline-none focus-visible:ring-1"
                onClick={props.onToggleFold}
                aria-label={props.isCollapsed ? "Expand folded code block" : "Collapse code block"}
              >
                ...
              </button>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
};
