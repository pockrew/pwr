import { createEffect, createSignal } from "solid-js";

import type { WebhookEvent } from "@pockrew/pwr-shared/schemas";

import { EventInspector } from "~/components/modules/events/event-inspector";
import { EventList } from "~/components/modules/events/event-list";
import { wsStore } from "~/stores/ws.store";

export const RequestPage = () => {
  const [selectedId, setSelectedId] = createSignal("");
  // Read from the feed so a finished delivery updates the open inspector too.
  const event = () => wsStore.events.find((e) => e.id === selectedId()) ?? null;

  // Select the newest event when nothing (or a vanished event) is selected.
  createEffect(() => {
    const first = wsStore.events[0];
    if (!event() && first) setSelectedId(first.id);
  });

  return (
    <div class="grid-swiss bg-background grid h-full overflow-hidden">
      {/* Left Master Feed: Webhook Events Stream */}
      <div class="border-border flex flex-1 flex-col overflow-hidden border-r">
        <div class="bg-background flex h-11 w-full shrink-0 items-center justify-between px-3">
          <h1 class="text-foreground text-lg font-bold tracking-tight">Requests Feed</h1>
        </div>
        <EventList
          events={wsStore.events}
          selectedId={event()?.id ?? ""}
          onSelect={(selected: WebhookEvent) => setSelectedId(selected.id)}
          isLoading={wsStore.isLoading}
          loadError={wsStore.loadError}
        />
      </div>

      {/* Right Detail Pane: Event Inspector */}
      <div class="bg-background flex flex-col overflow-hidden">
        <EventInspector event={event()} isLoading={wsStore.isLoading} />
      </div>
    </div>
  );
};

export default RequestPage;
