import { createMutation, createQuery } from "@tanstack/solid-query";
import { For, Show, type Component } from "solid-js";

import type { ManagedCollection, ManagedEndpoint } from "@pockrew/pwr-shared/schemas";
import { Badge, Button, Card, toast } from "@pockrew/pwr-ui/core";
import { Copy, Trash } from "@pockrew/pwr-ui/icons";

import { queryClient } from "~/libs/query-client";
import {
  deleteCollection,
  deleteEndpoint,
  fetchCollections,
  fetchEndpoints,
  updateCollection,
  updateEndpoint,
} from "~/libs/tunnel-client";

interface RoutesProps {
  tunnelId: string;
  slug: string;
}

const copy = (url: string) =>
  navigator.clipboard.writeText(url).then(
    () => toast.success("Ingress URL copied"),
    () => toast.error("Could not copy to the clipboard"),
  );

/** Run a change on the server, then re-read the routes; success is shown only after it answers. */
const useRouteMutation = (tunnelId: () => string) =>
  createMutation(() => ({
    mutationFn: async (change: { run: () => Promise<unknown>; done: string }) => {
      await change.run();
      return change.done;
    },
    onSuccess: (done) => {
      toast.success(done);
      void queryClient.invalidateQueries({ queryKey: ["tunnels", tunnelId(), "routes"] });
      void queryClient.invalidateQueries({ queryKey: ["tunnels", tunnelId(), "delivery-status"] });
    },
    onError: (error) => toast.error(error.message),
  }));

const EndpointRow: Component<RoutesProps & { collectionId: string; endpoint: ManagedEndpoint }> = (
  props,
) => {
  const change = useRouteMutation(() => props.tunnelId);
  const url = () =>
    `${window.location.origin}/ingress/${props.slug}/target/${props.endpoint.pathName.replace(/^\/+/, "")}`;
  const set = (input: { isActive?: boolean; isPaused?: boolean }, done: string) =>
    change.mutate({
      run: () => updateEndpoint(props.tunnelId, props.collectionId, props.endpoint.id, input),
      done,
    });
  const remove = () => {
    const confirmed = window.confirm(
      `Delete endpoint ${props.endpoint.pathName}?\n\nIt gets no new deliveries and agents remove it on their next sync. Delivery history is kept.`,
    );
    if (confirmed)
      change.mutate({
        run: () => deleteEndpoint(props.tunnelId, props.collectionId, props.endpoint.id),
        done: `Deleted ${props.endpoint.pathName}`,
      });
  };

  return (
    <div class="flex flex-wrap items-center justify-between gap-2 py-2 pl-4 text-xs">
      <div class="flex min-w-0 items-center gap-2">
        <span class="text-foreground font-mono font-semibold">{props.endpoint.pathName}</span>
        <Show when={!props.endpoint.isActive}>
          <Badge variant="secondary">inactive</Badge>
        </Show>
        <Show when={props.endpoint.isPaused}>
          <Badge variant="warning">paused</Badge>
        </Show>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => copy(url())}
          aria-label="Copy ingress URL"
          title={url()}
        >
          <Copy class="size-3" />
        </Button>
      </div>
      <div class="flex items-center gap-1">
        <Button
          variant="outline"
          size="xs"
          pill
          disabled={change.isPending}
          onClick={() =>
            set(
              { isPaused: !props.endpoint.isPaused },
              props.endpoint.isPaused ? "Endpoint resumed" : "Endpoint paused",
            )
          }
        >
          {props.endpoint.isPaused ? "Resume" : "Pause"}
        </Button>
        <Button
          variant="outline"
          size="xs"
          pill
          disabled={change.isPending}
          onClick={() =>
            set(
              { isActive: !props.endpoint.isActive },
              props.endpoint.isActive ? "Endpoint deactivated" : "Endpoint activated",
            )
          }
        >
          {props.endpoint.isActive ? "Deactivate" : "Activate"}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={change.isPending}
          onClick={remove}
          aria-label="Delete endpoint"
        >
          <Trash class="text-destructive size-3" />
        </Button>
      </div>
    </div>
  );
};

const CollectionRoutes: Component<RoutesProps & { collection: ManagedCollection }> = (props) => {
  const endpoints = createQuery(() => ({
    queryKey: ["tunnels", props.tunnelId, "routes", props.collection.id],
    queryFn: () => fetchEndpoints(props.tunnelId, props.collection.id),
  }));
  const change = useRouteMutation(() => props.tunnelId);
  const url = () => `${window.location.origin}/ingress/${props.slug}/${props.collection.id}`;
  const toggle = () => {
    const next = !props.collection.isActive;
    if (
      !next &&
      !window.confirm(
        "Deactivate this collection?\n\nIts endpoints get no deliveries until it is activated again.",
      )
    )
      return;
    change.mutate({
      run: () => updateCollection(props.tunnelId, props.collection.id, { isActive: next }),
      done: next ? "Collection activated" : "Collection deactivated",
    });
  };
  const remove = () => {
    const confirmed = window.confirm(
      `Delete collection "${props.collection.slug ?? props.collection.id}" and its endpoints?\n\nThey get no new deliveries and agents remove them on their next sync. Delivery history is kept.`,
    );
    if (confirmed)
      change.mutate({
        run: () => deleteCollection(props.tunnelId, props.collection.id),
        done: "Collection deleted",
      });
  };

  return (
    <div class="border-border border-b py-3 last:border-b-0">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-2">
          <span class="text-foreground font-mono text-sm font-bold">
            {props.collection.slug ?? "(no slug)"}
          </span>
          <Show when={!props.collection.isActive}>
            <Badge variant="secondary">inactive</Badge>
          </Show>
          <Button
            variant="ghost"
            size="xs"
            pill
            class="gap-1"
            onClick={() => copy(url())}
            title={url()}
          >
            <Copy class="size-3" />
            <span>Collection URL</span>
          </Button>
        </div>
        <div class="flex items-center gap-1">
          <Button variant="outline" size="xs" pill disabled={change.isPending} onClick={toggle}>
            {props.collection.isActive ? "Deactivate" : "Activate"}
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={change.isPending}
            onClick={remove}
            aria-label="Delete collection"
          >
            <Trash class="text-destructive size-3" />
          </Button>
        </div>
      </div>
      <Show when={endpoints.isError}>
        <p class="text-destructive pl-4 text-xs">{endpoints.error?.message}</p>
      </Show>
      <For
        each={endpoints.data}
        fallback={
          <Show when={endpoints.isSuccess}>
            <p class="text-muted-foreground py-2 pl-4 text-xs">
              No endpoints. Add them in Studio on an agent.
            </p>
          </Show>
        }
      >
        {(endpoint) => (
          <EndpointRow {...props} collectionId={props.collection.id} endpoint={endpoint} />
        )}
      </For>
    </div>
  );
};

/**
 * Collections and endpoints of a tunnel with their real ingress URLs. Targets and secrets are
 * owned by agents and are not visible here; routing is managed on both sides and synced.
 */
export const RoutesCard: Component<RoutesProps> = (props) => {
  const collections = createQuery(() => ({
    queryKey: ["tunnels", props.tunnelId, "routes"],
    queryFn: () => fetchCollections(props.tunnelId),
  }));

  return (
    <Card class="space-y-2 p-4">
      <div>
        <h2 class="text-foreground text-base font-bold">Collections & endpoints</h2>
        <p class="text-muted-foreground text-xs">
          Webhooks sent to a collection URL go to every active endpoint in it; an endpoint URL
          (/target/…) reaches endpoints with that path. Local targets are set in Studio.
        </p>
      </div>
      <Show when={collections.isError}>
        <p class="text-destructive text-sm">{collections.error?.message}</p>
      </Show>
      <Show when={collections.isPending}>
        <p class="text-muted-foreground text-sm">Loading…</p>
      </Show>
      <For
        each={collections.data}
        fallback={
          <Show when={collections.isSuccess}>
            <p class="text-muted-foreground text-sm">
              No collections yet. Create them in Studio on an agent.
            </p>
          </Show>
        }
      >
        {(collection) => <CollectionRoutes {...props} collection={collection} />}
      </For>
    </Card>
  );
};
