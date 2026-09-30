import { useNavigate, useSearchParams } from "@solidjs/router";
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";

import type { WebhookEvent } from "@pockrew/pwr-shared/schemas";
import { Badge, Button, Kbd, Tabs } from "@pockrew/pwr-ui/core";
import { Alert, ArrowLeft } from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

import { CompareSkeleton, PayloadDiffViewer } from "~/components/modules/events/compares";
import { getEventStatusColor, getMethodColor } from "~/libs/color-map";
import { areEventsComparable } from "~/libs/content-type";
import { formatIsoText } from "~/libs/date-formatter";
import { formatBytes } from "~/libs/format-bytes";
import { isKeyboardBlocked } from "~/libs/keyboard";
import { wsStore } from "~/stores/ws.store";

export const ComparePage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const idA = () => searchParams.a as string | undefined;
  const idB = () => searchParams.b as string | undefined;

  const eventA = createMemo<WebhookEvent | undefined>(() =>
    wsStore.events.find((e) => e.id === idA()),
  );

  const eventB = createMemo<WebhookEvent | undefined>(() =>
    wsStore.events.find((e) => e.id === idB()),
  );

  const validation = createMemo(() => {
    const a = eventA();
    const b = eventB();
    if (!a || !b) return null;
    return areEventsComparable(a, b);
  });

  const [activeTab, setActiveTab] = createSignal<string>("body");

  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isKeyboardBlocked()) {
        return;
      }
      if (e.key === "Escape") {
        navigate("/");
        return;
      }
      if (e.key === "1" || e.key === "b" || e.key === "B") {
        setActiveTab("body");
        return;
      }
      if (e.key === "2" || e.key === "q" || e.key === "Q") {
        setActiveTab("query");
        return;
      }
      if (e.key === "3" || e.key === "h" || e.key === "H") {
        setActiveTab("header");
        return;
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown));
  });

  return (
    <Tabs
      value={activeTab()}
      onChange={setActiveTab}
      class="bg-background flex h-full w-full flex-col overflow-hidden select-none"
    >
      {/* Top Header Toolbar */}
      <div class="border-border bg-background flex h-11 shrink-0 items-center justify-between border-b px-3">
        {/* Left: Back Action & Page Title */}
        <div class="flex items-center gap-2">
          <Button
            variant="ghost"
            size="xs"
            class="gap-1 px-2 text-xs"
            onClick={() => navigate("/")}
            title="Return to Requests feed (Esc)"
          >
            <ArrowLeft class="size-3.5" />
            <span>Back</span>
            <Kbd size="sm">Esc</Kbd>
          </Button>
          <div class="bg-border h-4 w-px" />
          <h1 class="text-foreground text-lg font-bold">Payload Diff Comparison</h1>
        </div>

        {/* Right: Tabs Trigger List */}
        <Show when={eventA() && eventB() && validation()?.comparable}>
          <Tabs.List class="flex items-center gap-1">
            <Tabs.Trigger value="body" class="gap-1.5 px-2.5 py-1 text-xs">
              <span>Payload Body</span>
              <Kbd size="sm">1</Kbd>
            </Tabs.Trigger>
            <Tabs.Trigger value="query" class="gap-1.5 px-2.5 py-1 text-xs">
              <span>Query Params</span>
              <Kbd size="sm">2</Kbd>
            </Tabs.Trigger>
            <Tabs.Trigger value="header" class="gap-1.5 px-2.5 py-1 text-xs">
              <span>Headers</span>
              <Kbd size="sm">3</Kbd>
            </Tabs.Trigger>
          </Tabs.List>
        </Show>
      </div>

      <Show
        when={eventA() && eventB()}
        fallback={
          <Show
            when={wsStore.isConnecting}
            fallback={
              <div class="bg-background flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
                <p class="text-muted-foreground text-base">
                  Please select 2 webhook requests from the requests feed to compare differences.
                </p>
                <Button size="sm" variant="default" onClick={() => navigate("/")} class="px-4">
                  Return to Requests
                </Button>
              </div>
            }
          >
            <CompareSkeleton />
          </Show>
        }
      >
        <Show
          when={validation()?.comparable}
          fallback={
            <div class="bg-background flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
              <div class="border-destructive/30 bg-destructive/5 flex max-w-md flex-col items-center gap-3 rounded-lg border p-6 text-center shadow-xs">
                <Alert class="text-destructive size-10" />
                <h2 class="text-foreground text-lg font-bold">
                  Cannot Compare Different Content Types
                </h2>
                <p class="text-muted-foreground text-sm">
                  Webhook requests must have matching content types to generate a comparison diff.
                </p>
                <div class="bg-surface/60 border-border flex items-center gap-2 rounded border px-3 py-1.5 font-mono text-xs">
                  <Badge variant="outline" class="font-bold">
                    {validation()?.typeA ?? "Unknown"}
                  </Badge>
                  <span class="text-muted-foreground">vs</span>
                  <Badge variant="outline" class="font-bold">
                    {validation()?.typeB ?? "Unknown"}
                  </Badge>
                </div>
                <Button size="sm" variant="default" onClick={() => navigate("/")} class="mt-2">
                  Return to Requests
                </Button>
              </div>
            </div>
          }
        >
          {/* Comparison Header Meta Grid */}
          <div class="border-border bg-card/40 divide-border grid shrink-0 grid-cols-2 divide-x border-b">
            <EventColumnHeader event={eventA()!} label="Base Event (A)" />
            <EventColumnHeader event={eventB()!} label="Target Event (B)" />
          </div>

          {/* Diff Viewers Container */}
          <div class="bg-background relative flex-1 overflow-hidden">
            <Tabs.Content value="body" class="h-full w-full">
              <PayloadDiffViewer dataA={eventA()!.body} dataB={eventB()!.body} />
            </Tabs.Content>

            <Tabs.Content value="query" class="h-full w-full">
              <PayloadDiffViewer dataA={eventA()!.queryParams} dataB={eventB()!.queryParams} />
            </Tabs.Content>

            <Tabs.Content value="header" class="h-full w-full">
              <PayloadDiffViewer dataA={eventA()!.headers} dataB={eventB()!.headers} />
            </Tabs.Content>
          </div>
        </Show>
      </Show>
    </Tabs>
  );
};

interface EventColumnHeaderProps {
  event: WebhookEvent;
  label: string;
}

const EventColumnHeader = (props: EventColumnHeaderProps) => {
  const contentType = () => {
    const entry = Object.entries(props.event.headers ?? {}).find(
      ([k]) => k.toLowerCase() === "content-type",
    );
    return entry ? String(entry[1]) : "";
  };

  return (
    <div class="flex flex-col gap-1.5 overflow-hidden p-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 overflow-hidden">
          <Badge
            size="sm"
            variant={props.event.status ? getEventStatusColor(props.event.status) : "secondary"}
            class="font-bold tabular-nums"
          >
            {props.event.status ?? "pending"}
          </Badge>
          <Badge size="sm" variant="outline" class="font-bold">
            <span class={cn(getMethodColor(props.event.method), "mr-1 size-1.5 rounded-full")} />
            <span>{props.event.method}</span>
          </Badge>
          <Show when={contentType()}>
            <Badge size="sm" variant="secondary" class="font-mono text-xs">
              {contentType()}
            </Badge>
          </Show>
          <span class="text-primary font-mono text-xs font-semibold">{props.label}</span>
        </div>
        <span class="text-muted-foreground font-mono text-xs">
          {formatIsoText(props.event.createdAt)}
        </span>
      </div>

      <div class="text-muted-foreground flex items-center justify-between font-mono text-xs">
        <span>
          {props.event.executionTimeMs === undefined
            ? "No target response yet"
            : `Target responded in ${props.event.executionTimeMs}ms`}
        </span>
        <span class="text-foreground">Size: {formatBytes(props.event.sizeBytes)}</span>
      </div>
    </div>
  );
};

export default ComparePage;
