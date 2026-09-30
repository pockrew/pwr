import { useNavigate } from "@solidjs/router";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { toast } from "solid-sonner";

import type { WebhookEvent } from "@pockrew/pwr-shared/schemas";
import { Badge, Button, Card, Checkbox, Empty, Input, Kbd, Tabs } from "@pockrew/pwr-ui/core";
import { Close, Search } from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

import { getEventStatusColor, getMethodColor, HttpMethodEnum } from "~/libs/color-map";
import { areEventsComparable } from "~/libs/content-type";
import { formatIsoText } from "~/libs/date-formatter";
import { formatBytes } from "~/libs/format-bytes";
import { isInputFocused, isOverlayOpen } from "~/libs/keyboard";

import { EventListSkeleton } from "./event-list-skeleton";

export interface EventListProps {
  events: readonly WebhookEvent[];
  selectedId: string | null;
  onSelect: (event: WebhookEvent) => void;
  isLoading?: boolean;
  /** Why the agent could not be read (offline, not signed in); shown instead of "no events". */
  loadError?: string | null;
}

/** Tooltip of the status badge: what the number (or "pending") is about. */
const deliveryTitle = (event: WebhookEvent): string => {
  const summary = event.deliveries;
  if (!summary?.total) return "No endpoint received this event";
  const parts = [
    `${summary.succeeded} delivered`,
    `${summary.failed} failed`,
    `${summary.pending} pending`,
  ];
  return `${parts.join(", ")}${event.status ? `; newest target response HTTP ${event.status}` : ""}`;
};

/**
 * Filterable and searchable virtual event feed panel with hotkey navigation,
 * multi-select comparison management, and status categorization.
 */
export const EventList = (props: EventListProps) => {
  const navigate = useNavigate();
  const [keyword, setKeyword] = createSignal("");
  const [methodFilter, setMethodFilter] = createSignal<string>("ALL");
  const [statusFilter, setStatusFilter] = createSignal<string>("ALL");
  const [checkedIds, setCheckedIds] = createSignal<string[]>([]);

  let searchInputRef: HTMLInputElement | null = null;

  // 1. Resolve currently checked events for comparison
  const checkedEvents = createMemo(() => {
    const ids = checkedIds();
    return ids
      .map((id) => props.events.find((e) => e.id === id))
      .filter((e): e is WebhookEvent => e !== undefined);
  });

  // 2. Validate payload compatibility between selected events
  const comparisonValidation = createMemo(() => {
    const evs = checkedEvents();
    if (evs.length < 2) {
      return { comparable: false, message: "Select 1 more item", isMismatch: false };
    }
    const result = areEventsComparable(evs[0], evs[1]);
    if (!result.comparable) {
      return {
        comparable: false,
        message: `Mismatched: ${result.typeA} vs ${result.typeB}`,
        reason: result.reason,
        isMismatch: true,
      };
    }
    return { comparable: true, message: "Ready to compare", isMismatch: false };
  });

  // Keyboard navigation & search shortcut
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when inside input/textarea/editable
      if (isInputFocused()) {
        if (e.key === "Escape") {
          (document.activeElement as HTMLElement).blur();
        }
        return;
      }

      if (isOverlayOpen()) {
        return;
      }

      if (e.key === "/") {
        e.preventDefault();
        searchInputRef?.focus();
        return;
      }

      // j / ArrowDown -> Next event
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const currentList = filteredEvents();
        if (!currentList.length) return;
        const currentIndex = currentList.findIndex((ev) => ev.id === props.selectedId);
        const nextIndex = currentIndex < currentList.length - 1 ? currentIndex + 1 : 0;
        const nextEvent = currentList[nextIndex];
        if (nextEvent) props.onSelect(nextEvent);
        return;
      }

      // k / ArrowUp -> Prev event
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const currentList = filteredEvents();
        if (!currentList.length) return;
        const currentIndex = currentList.findIndex((ev) => ev.id === props.selectedId);
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : currentList.length - 1;
        const prevEvent = currentList[prevIndex];
        if (prevEvent) props.onSelect(prevEvent);
        return;
      }

      // x / X -> Toggle compare selection on selected item
      if (e.key === "x" || e.key === "X") {
        if (props.selectedId) {
          e.preventDefault();
          toggleCheck(props.selectedId);
          return;
        }
      }

      // d / D -> Compare selected items
      if (e.key === "d" || e.key === "D") {
        if (checkedIds().length === 2) {
          e.preventDefault();
          handleCompare();
          return;
        }
      }

      // e / E -> Toggle Error Only filter
      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        setStatusFilter((prev) => (prev === "errors" ? "ALL" : "errors"));
        return;
      }

      // Escape -> Clear checked compare items
      if (e.key === "Escape") {
        if (checkedIds().length > 0) {
          e.preventDefault();
          setCheckedIds([]);
          return;
        }
      }
    };

    const handleFocusSearch = () => {
      searchInputRef?.focus();
    };

    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("studio:focus-search", handleFocusSearch);

    onCleanup(() => {
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("studio:focus-search", handleFocusSearch);
    });
  });

  const toggleCheck = (id: string, e?: Event) => {
    e?.stopPropagation();
    setCheckedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id);
      }
      if (prev.length >= 2) {
        const secondItem = prev[1];
        return secondItem ? [secondItem, id] : [id];
      }
      return [...prev, id];
    });
  };

  const handleCompare = () => {
    const evs = checkedEvents();
    if (evs.length === 2) {
      const validation = comparisonValidation();
      if (!validation.comparable) {
        toast.error(validation.reason ?? "Cannot compare requests with different content types");
        return;
      }
      navigate(`/compare?a=${encodeURIComponent(evs[0]!.id)}&b=${encodeURIComponent(evs[1]!.id)}`);
    }
  };

  const methodsList = [
    "ALL",
    HttpMethodEnum.POST,
    HttpMethodEnum.GET,
    HttpMethodEnum.PUT,
    HttpMethodEnum.DELETE,
    HttpMethodEnum.PATCH,
  ];

  const filteredEvents = createMemo(() => {
    const query = keyword().toLowerCase().trim();
    const activeMethod = methodFilter();
    const activeStatus = statusFilter();

    return props.events.filter((e) => {
      // 1. Method filter guard
      if (activeMethod !== "ALL" && e.method !== activeMethod) {
        return false;
      }

      // 2. Failed deliveries only (a target answered 4xx/5xx or could not be reached)
      if (activeStatus === "errors" && !e.deliveries?.failed) {
        return false;
      }

      // 3. Search keyword match
      if (!query) return true;
      return (
        (e.url && e.url.toLowerCase().includes(query)) ||
        (e.method && e.method.toLowerCase().includes(query)) ||
        (e.status !== undefined && e.status.toString().includes(query)) ||
        (e.headers["user-agent"] && e.headers["user-agent"].toLowerCase().includes(query))
      );
    });
  });

  return (
    <div class="bg-background relative flex flex-1 flex-col overflow-hidden">
      {/* Search and Stream Controls */}
      <div class="border-border bg-card/40 flex flex-col gap-2 border-b">
        <form class="px-2 py-1">
          <Input
            value={keyword()}
            onInput={(e) => setKeyword(e.currentTarget.value)}
            placeholder="Search webhooks..."
            ref={(el) => {
              searchInputRef = el;
            }}
            class="rounded-full"
            leftAddon={<Search class="size-4" />}
            rightAddon={
              <Show when={keyword().length > 0} fallback={<Kbd class="size-5">/</Kbd>}>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  class="text-muted-foreground hover:text-foreground"
                  onClick={() => setKeyword("")}
                >
                  <Close class="size-4" />
                </Button>
              </Show>
            }
          />
        </form>
        <div class="flex w-full items-center justify-between px-2 text-sm">
          <Checkbox.Root
            class="flex cursor-pointer items-center gap-1.5"
            checked={statusFilter() === "errors"}
            onChange={() => setStatusFilter(statusFilter() === "errors" ? "ALL" : "errors")}
          >
            <Checkbox.Control />
            <Checkbox.Label class="flex cursor-pointer items-center gap-1 text-xs">
              <span>Failed only</span>
              <Kbd size="sm">E</Kbd>
            </Checkbox.Label>
          </Checkbox.Root>
          <div class="text-muted-foreground inline-flex items-center gap-1 font-mono text-xs">
            <span class="text-[10px] opacity-60">nav:</span>
            <Kbd size="sm">J</Kbd>
            <Kbd size="sm">K</Kbd>
          </div>
        </div>
        <Tabs
          defaultValue="ALL"
          class="flex flex-1 flex-col overflow-hidden"
          onChange={(m) => setMethodFilter(m)}
        >
          <Tabs.List class="border-border flex items-center gap-1 border-b">
            <For each={methodsList}>
              {(m) => (
                <Tabs.Trigger value={m} class="h-6! px-1.5! py-0! text-xs">
                  {m}
                </Tabs.Trigger>
              )}
            </For>
          </Tabs.List>
        </Tabs>
      </div>

      {/* Events Stream Feed */}
      <div class="divide-border flex-1 divide-y overflow-y-auto">
        <Show
          when={!props.isLoading || props.events.length > 0}
          fallback={<EventListSkeleton count={7} />}
        >
          <Show
            when={filteredEvents().length > 0}
            fallback={
              <div class="mt-10">
                <Show
                  when={props.loadError}
                  fallback={
                    <Empty
                      class="gap-3!"
                      label={
                        props.events.length === 0
                          ? "No webhook events yet"
                          : "No webhook events match filters"
                      }
                      description="Send a webhook to an endpoint's ingress URL (copy it from Endpoints)"
                    />
                  }
                >
                  {(message) => (
                    <Empty class="gap-3!" label="Cannot load requests" description={message()} />
                  )}
                </Show>
              </div>
            }
          >
            <For each={filteredEvents()}>
              {(event) => {
                const isSelected = () => event.id === props.selectedId;
                const isChecked = () => checkedIds().includes(event.id);

                return (
                  <Card
                    class={cn(
                      "duration-micro flex flex-col gap-2 rounded-none border-t-0 border-r-0 border-l-2 p-2.5 transition-colors select-none",
                      isSelected()
                        ? "border-l-primary bg-muted/70"
                        : "hover:bg-muted/30 border-l-transparent",
                      isChecked() && "bg-primary/5",
                    )}
                    onClick={() => props.onSelect(event)}
                  >
                    <div class="flex items-center justify-between gap-2 text-xs">
                      <div class="flex min-w-0 items-center gap-2">
                        <div
                          role="presentation"
                          onClick={(e) => e.stopPropagation()}
                          class="flex items-center"
                          onKeyPress={(e) => e.stopPropagation()}
                        >
                          <Checkbox checked={isChecked()} onChange={() => toggleCheck(event.id)}>
                            <Checkbox.Control class="size-3.5" />
                          </Checkbox>
                        </div>

                        <Badge
                          size="sm"
                          variant={event.status ? getEventStatusColor(event.status) : "secondary"}
                          class="font-bold tabular-nums"
                          title={deliveryTitle(event)}
                        >
                          {event.status ?? "pending"}
                        </Badge>

                        <Badge size="sm" variant="outline" class="font-bold">
                          <span
                            class={cn("mr-1 size-1.5 rounded-full", getMethodColor(event.method))}
                          />
                          <span>{event.method}</span>
                        </Badge>
                      </div>
                    </div>
                    <span class="truncate text-xs">
                      {event.headers["user-agent"] ?? "Webhook Request"}
                    </span>

                    <div class="text-muted-foreground flex w-full items-center justify-between font-mono text-xs">
                      <div class="flex shrink-0 items-center gap-2">
                        <Show when={event.executionTimeMs !== undefined}>
                          <span class="whitespace-nowrap">{event.executionTimeMs}ms</span>
                        </Show>
                        <Show when={(event.deliveries?.total ?? 0) > 1}>
                          <span class="whitespace-nowrap">
                            {event.deliveries?.total} deliveries
                          </span>
                        </Show>
                        <span class="whitespace-nowrap">{formatBytes(event.sizeBytes)}</span>
                      </div>
                      <span class="text-muted-foreground shrink-0 font-mono text-xs whitespace-nowrap">
                        {formatIsoText(event.createdAt)}
                      </span>
                    </div>
                  </Card>
                );
              }}
            </For>
          </Show>
        </Show>
      </div>

      {/* Floating Compare Action Bar */}
      <Show when={checkedIds().length > 0}>
        <div class="border-border bg-card/95 absolute right-3 bottom-3 left-3 z-10 flex items-center justify-between rounded-md border p-2 shadow-md backdrop-blur-sm">
          <div class="flex items-center gap-2 text-xs">
            <Badge
              variant={comparisonValidation().isMismatch ? "destructive" : "secondary"}
              size="sm"
              class="font-semibold"
            >
              {checkedIds().length}/2
            </Badge>
            <span
              class={cn(
                "text-xs font-medium",
                comparisonValidation().isMismatch ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {comparisonValidation().message}
            </span>
          </div>

          <div class="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="xs"
              class="text-muted-foreground hover:text-foreground h-6 gap-1 px-2 text-xs"
              onClick={() => setCheckedIds([])}
            >
              <span>Clear</span>
              <Kbd size="sm">Esc</Kbd>
            </Button>
            <Button
              variant={comparisonValidation().isMismatch ? "outline" : "default"}
              size="xs"
              class="h-6 gap-1.5 px-3 text-xs font-semibold"
              disabled={!comparisonValidation().comparable}
              onClick={handleCompare}
              title={comparisonValidation().message}
            >
              <span>Compare</span>
              <Kbd size="sm">D</Kbd>
            </Button>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default EventList;
