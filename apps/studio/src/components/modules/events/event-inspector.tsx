import { A } from "@solidjs/router";
import { createMutation, createQuery } from "@tanstack/solid-query";
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { toast } from "solid-sonner";

import type { WebhookEvent } from "@pockrew/pwr-shared/schemas";
import { Badge, Button, Empty, Kbd, Tabs } from "@pockrew/pwr-ui/core";
import { Check, Copy, Play } from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

import { CodeViewer } from "~/components/code-viewer";
import { fetchAllDeliveries, replayRequest, type DeliveryItem } from "~/libs/api-client";
import { getEventStatusColor, getMethodColor } from "~/libs/color-map";
import { detectPayload, PayloadFormatEnum, type DetectedPayload } from "~/libs/content-type";
import { formatIsoText } from "~/libs/date-formatter";
import { formatBytes } from "~/libs/format-bytes";
import { isInputFocused, isOverlayOpen } from "~/libs/keyboard";
import { queryClient } from "~/libs/query-client";
import { tunnelStore } from "~/stores/tunnel.store";

import { EventDeliveries } from "./event-deliveries";
import { EventInspectorSkeleton } from "./event-inspector-skeleton";
import { FormInspector } from "./inspectors/form-inspector";
import { SchemaInspector } from "./inspectors/schema-inspector";

export interface IEventDetailsProps {
  event: WebhookEvent | null;
  isLoading?: boolean;
}

/** POSIX single-quoting: nothing inside is expanded, so `$(...)` or backticks in a webhook body
 * or header cannot run when the copied command is pasted into a shell. */
const shellQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * cURL that sends this request to a local target (what a delivery does, without the agent).
 * @param target - The endpoint's target URL; the original query string is appended.
 */
const generateCurlCommand = (event: WebhookEvent, target: string): string => {
  // 1. Target URL with the original query and the original method
  const query = event.queryParams ? new URLSearchParams(event.queryParams).toString() : "";
  const url = query ? `${target}${target.includes("?") ? "&" : "?"}${query}` : target;
  const parts: string[] = [`curl -X ${shellQuote(event.method)} ${shellQuote(url)}`];

  // 2. Append request headers (skipping Content-Length and Host auto-headers)
  if (event.headers) {
    for (const [key, value] of Object.entries(event.headers)) {
      const lowerKey = key.toLowerCase();
      if (lowerKey !== "content-length" && lowerKey !== "host") {
        parts.push(`  -H ${shellQuote(`${key}: ${value}`)}`);
      }
    }
  }

  // 3. Append the body verbatim; --data-binary keeps newlines that -d would strip.
  if (event.body) {
    parts.push(`  --data-binary ${shellQuote(event.body)}`);
  }

  return parts.join(" \\\n");
};

/**
 * Comprehensive inspector panel displaying raw payloads, structured schema/form trees,
 * headers, query parameters, and execution telemetry for the active event.
 */
export const EventInspector = (props: IEventDetailsProps) => {
  const [copiedType, setCopiedType] = createSignal<string | null>(null);
  const [tab, setTab] = createSignal("body");

  // Deliveries of the selected event: one per matched endpoint, plus replays.
  const deliveries = createQuery(
    () => ({
      queryKey: ["agent", "deliveries", props.event?.id ?? ""],
      queryFn: () => fetchAllDeliveries(props.event?.id ?? "", tunnelStore.tunnelId),
      enabled: Boolean(props.event && tunnelStore.tunnelId),
    }),
    () => queryClient,
  );
  const liveDeliveries = () => (deliveries.data ?? []).filter((d) => d.trigger === "live");
  const curlTarget = () => liveDeliveries().find((d) => d.localTarget)?.localTarget ?? null;

  const replay = createMutation(
    () => ({
      mutationFn: (delivery: DeliveryItem) =>
        replayRequest(delivery.id, { tunnelId: tunnelStore.tunnelId }),
      onSuccess: ({ delivery: result }) => {
        const text = `Target answered HTTP ${result.statusCode} in ${result.latencyMs}ms`;
        if (result.statusCode < 400) toast.success(`Replayed. ${text}`);
        else toast.error(`Replayed, but the target failed. ${text}`);
      },
      onError: (error) => toast.error(error.message),
      onSettled: () =>
        queryClient.invalidateQueries({ queryKey: ["agent", "deliveries", props.event?.id] }),
    }),
    () => queryClient,
  );

  /** One live delivery replays directly; with several, the user picks one in Deliveries. */
  const replayFromHeader = () => {
    const live = liveDeliveries();
    const only = live.length === 1 ? live[0] : undefined;
    if (only) return replay.mutate(only);
    setTab("deliveries");
    toast.info(
      live.length
        ? "This event went to several endpoints; choose one to replay"
        : "No delivery to replay yet",
    );
  };

  // 1. Resolve content-type header
  const contentType = createMemo(() => {
    const headers = props.event?.headers;
    if (!headers) return "";
    const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === "content-type");
    return entry ? String(entry[1]) : "";
  });

  // 2. Detect payload format and structure
  const detected = createMemo<DetectedPayload>(() =>
    detectPayload(props.event?.body, contentType()),
  );

  // 3. Dynamic copy button label based on payload type
  const copyLabel = createMemo(() => {
    const fmt = detected().format;
    switch (fmt) {
      case PayloadFormatEnum.JSON:
        return "JSON";
      case PayloadFormatEnum.FORM:
        return "Form";
      case PayloadFormatEnum.MULTIPART:
        return "Multipart";
      case PayloadFormatEnum.XML:
        return "XML";
      case PayloadFormatEnum.HEX:
        return "Hex";
      default:
        return "Body";
    }
  });

  const handleCopyText = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2000);
    toast.success(
      type === "curl"
        ? "Copied cURL command to clipboard"
        : `Copied ${copyLabel()} payload to clipboard`,
    );
  };

  // Keyboard shortcut: Press 'r' for replay, 'c' for copy
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isInputFocused()) {
        if (e.key === "Escape") {
          (document.activeElement as HTMLElement).blur();
        }
        return;
      }
      if (isOverlayOpen()) {
        return;
      }

      if (e.key === "r" || e.key === "R") {
        if (props.event && !replay.isPending) {
          e.preventDefault();
          replayFromHeader();
        }
      }

      if (e.key === "c" || e.key === "C") {
        if (props.event?.body) {
          e.preventDefault();
          handleCopyText(props.event.body, "payload");
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  return (
    <Show when={!props.isLoading || Boolean(props.event)} fallback={<EventInspectorSkeleton />}>
      <Show
        when={props.event}
        fallback={
          <div class="flex flex-col items-center justify-center pt-24">
            <Empty
              label="No request selected"
              description="Select a request in the feed to inspect it"
            />

            <p class="text-muted-foreground max-w-md border-t py-2 text-center text-xs">
              Webhooks arrive through an endpoint's ingress URL on your PWR server; copy it from{" "}
              <A href="/endpoints" class="text-primary underline underline-offset-2">
                Endpoints
              </A>
              .
            </p>

            <div class="text-muted-foreground flex items-center gap-4 py-3 font-mono text-xs">
              <span>Hotkeys:</span>
              <div>
                <Kbd>j</Kbd> to go down
              </div>
              <div>
                <Kbd>k</Kbd> to go up
              </div>
              <div>
                <Kbd>r</Kbd> replay
              </div>
              <div>
                <Kbd>x</Kbd> compare
              </div>
              <div>
                <Kbd>/</Kbd> search
              </div>
            </div>
          </div>
        }
      >
        {(event) => (
          <div class="bg-background flex h-full flex-1 flex-col overflow-hidden">
            {/* Top Event Telemetry Bar */}
            <div class="border-border bg-card/30 flex h-11 w-full shrink-0 items-center justify-between border-b px-3 py-1.5 font-mono text-xs">
              <div class="flex min-w-0 items-center gap-2">
                <Badge
                  size="sm"
                  variant={event().status ? getEventStatusColor(event().status) : "secondary"}
                  class="font-bold tabular-nums"
                  title="Newest target response"
                >
                  {event().status ?? "pending"}
                </Badge>
                <Badge size="sm" variant="outline" class="font-bold">
                  <span class={cn("mr-1 size-1.5 rounded-full", getMethodColor(event().method))} />
                  <span>{event().method}</span>
                </Badge>
                <Show when={event().deliveries}>
                  {(summary) => (
                    <span class="text-muted-foreground truncate text-xs">
                      {summary().succeeded} delivered · {summary().failed} failed ·{" "}
                      {summary().pending} pending
                    </span>
                  )}
                </Show>
              </div>

              <div class="text-muted-foreground flex shrink-0 items-center gap-2 text-xs">
                <Show when={event().executionTimeMs !== undefined}>
                  <span>{event().executionTimeMs}ms</span>
                  <span class="bg-border h-3 w-px" />
                </Show>
                <span>{formatBytes(event().sizeBytes)}</span>
                <span class="bg-border h-3 w-px" />
                <span>{formatIsoText(event().createdAt)}</span>
              </div>
            </div>
            <div class="border-border bg-card/30 flex h-11 w-full shrink-0 items-center justify-between border-b px-3 py-1.5 font-mono text-xs">
              <div class="flex items-center gap-1">
                <span class="text-muted-foreground uppercase">Event ID:</span>
                <span class="text-foreground">{event().id}</span>
              </div>
              <div class="flex items-center gap-1">
                <span class="text-muted-foreground uppercase">Content-Type:</span>
                <span class="text-foreground font-medium">{contentType() || "none"}</span>
              </div>
            </div>
            {/* Action Tabs & Quick Tools */}
            <Tabs value={tab()} onChange={setTab} class="flex flex-1 flex-col overflow-hidden">
              <div class="border-border bg-card/60 flex h-11 shrink-0 items-center justify-between border-b px-2">
                <Tabs.List class="flex items-center gap-1">
                  <Tabs.Trigger value="body" class="px-2.5 py-1 text-xs">
                    Payload Body
                  </Tabs.Trigger>
                  <Tabs.Trigger value="headers" class="px-2.5 py-1 text-xs">
                    Headers
                  </Tabs.Trigger>
                  <Tabs.Trigger value="query" class="px-2.5 py-1 text-xs">
                    Query Params
                  </Tabs.Trigger>
                  <Tabs.Trigger value="deliveries" class="px-2.5 py-1 text-xs">
                    Deliveries
                  </Tabs.Trigger>
                  <Tabs.Trigger value="details" class="px-2.5 py-1 text-xs">
                    Details
                  </Tabs.Trigger>
                </Tabs.List>

                <div class="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="xs"
                    pill
                    class="gap-1 font-mono text-xs"
                    disabled={!curlTarget()}
                    title={
                      curlTarget()
                        ? "cURL that sends this request to the endpoint's target"
                        : "The endpoint has no target set"
                    }
                    onClick={() => {
                      const target = curlTarget();
                      if (target) handleCopyText(generateCurlCommand(event(), target), "curl");
                    }}
                  >
                    <Show when={copiedType() === "curl"} fallback={<Copy class="size-3" />}>
                      <Check class="size-3 text-emerald-500" />
                    </Show>
                    <span>{copiedType() === "curl" ? "Copied cURL" : "Copy cURL"}</span>
                  </Button>

                  <Button
                    variant="outline"
                    size="xs"
                    pill
                    class="gap-1 font-mono text-xs"
                    onClick={() => handleCopyText(event().body ?? "", "payload")}
                    title={`Copy ${copyLabel()} body (C)`}
                  >
                    <Show when={copiedType() === "payload"} fallback={<Copy class="size-3" />}>
                      <Check class="size-3 text-emerald-500" />
                    </Show>
                    <span>
                      {copiedType() === "payload" ? `Copied ${copyLabel()}` : `Copy ${copyLabel()}`}
                    </span>
                    <Kbd size="sm">C</Kbd>
                  </Button>

                  <Button
                    variant="default"
                    size="xs"
                    class="gap-1 font-mono text-xs font-semibold"
                    disabled={replay.isPending}
                    onClick={replayFromHeader}
                    title="Replay to the endpoint's current target (R)"
                  >
                    <Play class="size-3" />
                    <span>{replay.isPending ? "Replaying…" : "Replay"}</span>
                    <Kbd size="sm">R</Kbd>
                  </Button>
                </div>
              </div>

              {/* Body Content: Side-by-Side Raw + Schema/Form Inspector */}
              <Tabs.Content value="body" class="flex flex-1 overflow-hidden">
                <div class="divide-border grid h-full flex-1 grid-cols-1 divide-x overflow-hidden lg:grid-cols-2">
                  <div class="bg-background flex flex-col overflow-hidden">
                    <div class="bg-surface/50 border-border text-muted-foreground flex h-6 shrink-0 items-center justify-between border-b px-2 font-mono text-xs tracking-wider uppercase">
                      <span>RAW {detected().format.toUpperCase()}</span>
                      <span class="text-meta text-muted-foreground lowercase">
                        {event().body
                          ? formatBytes(new TextEncoder().encode(event().body).length)
                          : "0 B"}
                      </span>
                    </div>
                    <div class="flex-1 overflow-auto">
                      <CodeViewer value={event().body} language={detected().format} readOnly />
                    </div>
                  </div>

                  <div class="bg-background flex flex-col overflow-hidden">
                    <div class="bg-surface/50 border-border text-muted-foreground flex h-6 shrink-0 items-center justify-between border-b px-2 font-mono text-xs tracking-wider uppercase">
                      <span>
                        {detected().isForm || detected().isMultipart
                          ? "FORM FIELDS & PARAMETERS"
                          : "STRUCTURE & SCHEMA"}
                      </span>
                      <Badge variant="outline" class="text-meta h-4 px-1 uppercase">
                        {detected().label}
                      </Badge>
                    </div>
                    <div class="flex-1 overflow-auto">
                      <Show
                        when={detected().isForm || detected().isMultipart}
                        fallback={
                          <SchemaInspector value={event().body} contentType={contentType()} />
                        }
                      >
                        <FormInspector value={event().body} contentType={contentType()} />
                      </Show>
                    </div>
                  </div>
                </div>
              </Tabs.Content>

              {/* Headers Content: Structured Table */}
              <Tabs.Content value="headers" class="bg-background flex-1 overflow-auto p-3">
                <div class="border-border overflow-hidden rounded-md border">
                  <table class="w-full border-collapse font-mono text-xs">
                    <thead>
                      <tr class="bg-surface/80 border-border text-muted-foreground border-b text-left text-xs">
                        <th class="w-1/3 p-2 font-semibold">HEADER</th>
                        <th class="p-2 font-semibold">VALUE</th>
                      </tr>
                    </thead>
                    <tbody class="divide-border divide-y">
                      {Object.entries((event().headers ?? {}) as Record<string, string>).map(
                        ([key, val]) => (
                          <tr class="hover:bg-surface/30">
                            <td class="text-primary p-2 font-semibold">{key}</td>
                            <td class="text-foreground p-2 break-all">{val}</td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              </Tabs.Content>

              {/* Query Params Content: Structured Table */}
              <Tabs.Content value="query" class="bg-background flex-1 overflow-auto p-3">
                <Show
                  when={
                    event().queryParams &&
                    Object.keys(event().queryParams as Record<string, string>).length > 0
                  }
                  fallback={
                    <div class="text-muted-foreground p-8 text-center font-mono text-xs">
                      No URL query parameters attached to this request.
                    </div>
                  }
                >
                  <div class="border-border overflow-hidden rounded-md border">
                    <table class="w-full border-collapse font-mono text-xs">
                      <thead>
                        <tr class="bg-surface/80 border-border text-muted-foreground border-b text-left text-xs">
                          <th class="w-1/3 p-2 font-semibold">PARAMETER</th>
                          <th class="p-2 font-semibold">VALUE</th>
                        </tr>
                      </thead>
                      <tbody class="divide-border divide-y">
                        {Object.entries((event().queryParams ?? {}) as Record<string, string>).map(
                          ([key, val]) => (
                            <tr class="hover:bg-surface/30">
                              <td class="text-primary p-2 font-semibold">{key}</td>
                              <td class="text-foreground p-2 break-all">{val}</td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                </Show>
              </Tabs.Content>

              {/* Trace & Timings Content */}
              <Tabs.Content value="deliveries" class="bg-background flex-1 overflow-auto">
                <EventDeliveries
                  deliveries={deliveries.data}
                  isLoading={deliveries.isLoading}
                  error={deliveries.error?.message ?? null}
                  replayingId={replay.isPending ? (replay.variables?.id ?? null) : null}
                  onReplay={(delivery) => replay.mutate(delivery)}
                />
              </Tabs.Content>

              <Tabs.Content value="details" class="bg-background flex-1 overflow-auto p-4">
                <dl class="grid max-w-xl grid-cols-[max-content_1fr] gap-x-6 gap-y-2 font-mono text-xs">
                  <dt class="text-muted-foreground">Received</dt>
                  <dd class="text-foreground">{new Date(event().createdAt).toISOString()}</dd>
                  <dt class="text-muted-foreground">Payload size</dt>
                  <dd class="text-foreground">{formatBytes(event().sizeBytes)}</dd>
                  <dt class="text-muted-foreground">Newest target result</dt>
                  <dd class="text-foreground">
                    {event().status === undefined
                      ? "none yet"
                      : `HTTP ${event().status} in ${event().executionTimeMs ?? 0}ms`}
                  </dd>
                  <dt class="text-muted-foreground">Replays</dt>
                  <dd class="text-foreground">{event().replayCount ?? 0}</dd>
                  <dt class="text-muted-foreground">Server tunnel ID</dt>
                  <dd class="text-foreground">{event().tunnelId}</dd>
                  <dt class="text-muted-foreground">Event ID</dt>
                  <dd class="text-foreground">{event().id}</dd>
                </dl>
              </Tabs.Content>
            </Tabs>
          </div>
        )}
      </Show>
    </Show>
  );
};

export default EventInspector;
