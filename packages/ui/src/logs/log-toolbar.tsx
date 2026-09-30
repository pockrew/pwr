import { For, Show, type Component } from "solid-js";

import type { LogLevel } from "@pockrew/pwr-shared/schemas";
import { Button, Input, Kbd } from "@pockrew/pwr-ui/core";
import { Copy, Pause, Play, Reload, Search } from "@pockrew/pwr-ui/icons";

/** Time window presets; `custom` uses explicit from/to inputs. */
export const LOG_RANGES = [
  { id: "all", label: "All" },
  { id: "15m", label: "15m" },
  { id: "1h", label: "1h" },
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
  { id: "custom", label: "Custom" },
] as const;

export type LogRange = (typeof LOG_RANGES)[number]["id"];

const LEVELS: { id: LogLevel | undefined; label: string }[] = [
  { id: undefined, label: "All" },
  { id: "debug", label: "Debug" },
  { id: "info", label: "Info" },
  { id: "warning", label: "Warn" },
  { id: "error", label: "Error" },
];

interface LogToolbarProps {
  level: LogLevel | undefined;
  onLevelChange: (level: LogLevel | undefined) => void;
  search: string;
  onSearchChange: (value: string) => void;
  searchRef: (element: HTMLInputElement) => void;
  range: LogRange;
  onRangeChange: (range: LogRange) => void;
  /** `datetime-local` values of the custom range. */
  customFrom: string;
  customTo: string;
  onCustomChange: (from: string, to: string) => void;
  following: boolean;
  canFollow: boolean;
  onFollowChange: (following: boolean) => void;
  onReload: () => void;
  onCopy: () => void;
}

const segmentClass = "h-7 px-2.5 font-mono text-xs";

/** Level, text and time filters plus follow/reload/copy actions of a log viewer. */
export const LogToolbar: Component<LogToolbarProps> = (props) => (
  <div class="space-y-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex flex-wrap items-center gap-3">
        <fieldset class="flex items-center gap-1">
          <legend class="text-muted-foreground float-left mr-1 text-xs">Level ≥</legend>
          <For each={LEVELS}>
            {(option) => (
              <Button
                size="xs"
                variant={props.level === option.id ? "default" : "outline"}
                class={segmentClass}
                onClick={() => props.onLevelChange(option.id)}
              >
                {option.label}
              </Button>
            )}
          </For>
        </fieldset>
        <fieldset class="flex items-center gap-1">
          <legend class="text-muted-foreground float-left mr-1 text-xs">Range</legend>
          <For each={LOG_RANGES}>
            {(option) => (
              <Button
                size="xs"
                variant={props.range === option.id ? "default" : "outline"}
                class={segmentClass}
                onClick={() => props.onRangeChange(option.id)}
              >
                {option.label}
              </Button>
            )}
          </For>
        </fieldset>
      </div>

      <div class="flex items-center gap-2">
        <Input
          ref={props.searchRef}
          type="text"
          placeholder="Search logs…"
          value={props.search}
          onInput={(event) => props.onSearchChange(event.currentTarget.value)}
          class="h-8 w-56 text-xs"
          leftAddon={<Search class="text-muted-foreground size-3.5" />}
          rightAddon={<Kbd size="sm">/</Kbd>}
        />
        <Button
          variant="outline"
          size="sm"
          pill
          disabled={!props.canFollow}
          onClick={() => props.onFollowChange(!props.following)}
          title={props.canFollow ? "Pause or resume the live tail" : "The range ends in the past"}
        >
          <Show when={props.following && props.canFollow} fallback={<Play class="size-3.5" />}>
            <Pause class="size-3.5" />
          </Show>
          <span>{props.following && props.canFollow ? "Pause" : "Follow"}</span>
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={props.onReload} title="Reload newest">
          <Reload class="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={props.onCopy} title="Copy loaded entries">
          <Copy class="size-3.5" />
        </Button>
      </div>
    </div>

    <Show when={props.range === "custom"}>
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <span class="text-muted-foreground flex items-center gap-2">
          From
          <Input
            aria-label="From"
            type="datetime-local"
            step="1"
            value={props.customFrom}
            onInput={(event) => props.onCustomChange(event.currentTarget.value, props.customTo)}
            class="h-8 w-56 text-xs"
          />
        </span>
        <span class="text-muted-foreground flex items-center gap-2">
          To
          <Input
            aria-label="To"
            type="datetime-local"
            step="1"
            value={props.customTo}
            onInput={(event) => props.onCustomChange(props.customFrom, event.currentTarget.value)}
            class="h-8 w-56 text-xs"
          />
        </span>
        <span class="text-muted-foreground">Leave “To” empty to keep following new entries.</span>
      </div>
    </Show>
  </div>
);
