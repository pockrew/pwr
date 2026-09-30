import { For, Show, type Component } from "solid-js";

import { Badge, Button } from "@pockrew/pwr-ui/core";
import { Play } from "@pockrew/pwr-ui/icons";

import type { DeliveryItem } from "~/libs/api-client";
import { getEventStatusColor } from "~/libs/color-map";
import { formatIsoText } from "~/libs/date-formatter";
import { endpointsStore } from "~/stores/endpoints.store";

interface EventDeliveriesProps {
  deliveries: DeliveryItem[] | undefined;
  isLoading: boolean;
  error: string | null;
  replayingId: string | null;
  onReplay: (delivery: DeliveryItem) => void;
}

const shortId = (id: string) => id.slice(0, 8);

/** Server-side confirmation of the result ACK, which is independent of the target outcome. */
const ackText = (delivery: DeliveryItem): string => {
  if (delivery.reportedAt) return `Reported to server ${formatIsoText(delivery.reportedAt)}`;
  if (delivery.completed) return "Result waiting for server confirmation";
  return "Not executed yet";
};

/**
 * Deliveries of one event: one per endpoint that matched, plus every replay. Replay always picks
 * one delivery, re-sends the original bytes to that endpoint's current target, and records a new
 * delivery; the source is never changed.
 */
export const EventDeliveries: Component<EventDeliveriesProps> = (props) => {
  const endpointPath = (endpointId: string) =>
    endpointsStore.endpoints.find((endpoint) => endpoint.id === endpointId)?.pathName;

  return (
    <div class="flex flex-col gap-2 p-3">
      <Show when={props.error}>
        {(message) => (
          <p class="text-destructive text-sm">Could not load deliveries: {message()}</p>
        )}
      </Show>
      <Show when={props.isLoading && !props.deliveries}>
        <p class="text-muted-foreground text-sm">Loading deliveries…</p>
      </Show>
      <For
        each={props.deliveries}
        fallback={
          <Show when={!props.isLoading && !props.error}>
            <p class="text-muted-foreground text-sm">No deliveries recorded for this event.</p>
          </Show>
        }
      >
        {(delivery) => (
          <div class="border-border bg-card/40 flex flex-col gap-1.5 rounded-md border p-3 font-mono text-xs">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex flex-wrap items-center gap-2">
                <Badge size="sm" variant={delivery.trigger === "live" ? "info" : "secondary"}>
                  {delivery.trigger}
                </Badge>
                <Show
                  when={delivery.result}
                  fallback={
                    <Badge size="sm" variant="warning">
                      pending
                    </Badge>
                  }
                >
                  {(result) => (
                    <Badge size="sm" variant={getEventStatusColor(result().statusCode)}>
                      HTTP {result().statusCode}
                    </Badge>
                  )}
                </Show>
                <Show when={delivery.result}>
                  {(result) => <span class="text-muted-foreground">{result().latencyMs}ms</span>}
                </Show>
                <span class="text-foreground font-semibold">
                  {endpointPath(delivery.endpointId) ?? `endpoint ${shortId(delivery.endpointId)}`}
                </span>
              </div>
              <Button
                variant="outline"
                size="xs"
                pill
                class="gap-1"
                disabled={props.replayingId !== null}
                onClick={() => props.onReplay(delivery)}
                title="Send the original request again to this endpoint's current target"
              >
                <Play class="size-3" />
                <span>{props.replayingId === delivery.id ? "Replaying…" : "Replay"}</span>
              </Button>
            </div>
            <div class="text-muted-foreground truncate" title={delivery.localTarget ?? undefined}>
              Target:{" "}
              <span class="text-foreground">
                {delivery.localTarget ?? "none set; the delivery waits until the endpoint has one"}
              </span>
            </div>
            <div class="text-muted-foreground flex flex-wrap gap-x-3">
              <span>ID {shortId(delivery.id)}</span>
              <Show when={delivery.replayOfDeliveryId}>
                {(source) => <span>replay of {shortId(source())}</span>}
              </Show>
              <Show when={delivery.completedAt}>
                {(at) => <span>executed {formatIsoText(at())}</span>}
              </Show>
              <span>{ackText(delivery)}</span>
            </div>
          </div>
        )}
      </For>
    </div>
  );
};
