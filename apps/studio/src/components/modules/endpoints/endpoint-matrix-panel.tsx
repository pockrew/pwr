import { createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js";
import { toast } from "solid-sonner";

import { Badge, Button, Input, Kbd } from "@pockrew/pwr-ui/core";
import {
  Alert,
  Check,
  Close,
  Copy,
  Edit,
  Lock,
  Pause,
  Play,
  Plus,
  Search,
} from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

import { isInputFocused, isOverlayOpen } from "~/libs/keyboard";
import { endpointsStore, type EndpointItem } from "~/stores/endpoints.store";

import { EndpointModal } from "./endpoint-modal";
import { SyncState } from "./sync-state";

/** Endpoints of the selected collection with their targets, secrets and ingress URLs. */
export const EndpointMatrixPanel: Component = () => {
  const [isModalOpen, setIsModalOpen] = createSignal(false);
  const [editingEp, setEditingEp] = createSignal<EndpointItem | null>(null);
  const [copied, setCopied] = createSignal<string | null>(null);
  let searchInputRef: HTMLInputElement | undefined;

  const selectedCol = () => endpointsStore.selectedCollection;
  const endpoints = () => endpointsStore.selectedCollectionEndpoints;

  const openModal = (ep: EndpointItem | null) => {
    setEditingEp(ep);
    setIsModalOpen(true);
  };

  /** Copy a real ingress URL; before the first sync the server address is unknown. */
  const copyUrl = (url: string | null, key: string) => {
    if (!url) {
      toast.error("This tunnel has not synced with its server yet; connect it first.");
      return;
    }
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(key);
        toast.success("Ingress URL copied");
        setTimeout(() => setCopied(null), 2000);
      },
      () => toast.error("Could not copy to the clipboard"),
    );
  };
  const endpointUrl = (ep: EndpointItem) =>
    endpointsStore.ingressBaseUrl
      ? `${endpointsStore.ingressBaseUrl}/target/${ep.pathName.replace(/^\/+/, "")}`
      : null;
  const collectionUrl = () => {
    const col = selectedCol();
    return col && endpointsStore.ingressBaseUrl
      ? `${endpointsStore.ingressBaseUrl}/${col.id}`
      : null;
  };

  onMount(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isInputFocused() || isOverlayOpen()) return;
      if (event.key === "e" || event.key === "E" || event.key === "/") {
        event.preventDefault();
        searchInputRef?.focus();
      } else if ((event.key === "a" || event.key === "A" || event.key === "+") && selectedCol()) {
        event.preventDefault();
        openModal(null);
      }
    };
    const handleFocusSearch = () => searchInputRef?.focus();
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("studio:focus-search", handleFocusSearch);
    onCleanup(() => {
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("studio:focus-search", handleFocusSearch);
    });
  });

  return (
    <div class="bg-background flex h-full flex-1 flex-col overflow-hidden">
      <div class="border-border bg-background flex h-11 shrink-0 items-center justify-between border-b px-3">
        <Show
          when={selectedCol()}
          fallback={<div class="text-muted-foreground text-xs">No collection selected</div>}
        >
          {(col) => (
            <>
              <div class="flex min-w-0 items-center gap-2.5">
                <Badge
                  variant={col().isActive ? "success" : "secondary"}
                  class="text-sm font-bold uppercase"
                >
                  {col().isActive ? "active" : "inactive"}
                </Badge>
                <span class="text-foreground font-mono text-base font-bold">{col().slug}</span>
                <Button
                  variant="ghost"
                  size="xs"
                  pill
                  class="gap-1"
                  onClick={() => copyUrl(collectionUrl(), "collection")}
                  title="Copy the collection's ingress URL (delivers to every active endpoint in it)"
                >
                  <Show when={copied() === "collection"} fallback={<Copy class="size-3" />}>
                    <Check class="size-3 text-emerald-500" />
                  </Show>
                  <span class="text-xs">Collection URL</span>
                </Button>
              </div>
              <div class="flex items-center gap-2">
                <Input
                  ref={(el) => (searchInputRef = el)}
                  value={endpointsStore.endpointFilter}
                  onInput={(event) => endpointsStore.setEndpointFilter(event.currentTarget.value)}
                  placeholder="Filter endpoints..."
                  class="rounded-full"
                  leftAddon={<Search class="size-4" />}
                  rightAddon={
                    <Show
                      when={endpointsStore.endpointFilter.length > 0}
                      fallback={<Kbd size="sm">E</Kbd>}
                    >
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Clear filter"
                        onClick={() => endpointsStore.setEndpointFilter("")}
                      >
                        <Close class="size-4" />
                      </Button>
                    </Show>
                  }
                />
                <Button size="sm" pill onClick={() => openModal(null)} title="Add endpoint (A)">
                  <Plus class="size-3.5" />
                  <span>Add endpoint</span>
                </Button>
              </div>
            </>
          )}
        </Show>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <Show
          when={selectedCol()}
          fallback={
            <p class="text-muted-foreground p-8 text-center text-base">
              Select or create a collection to view its endpoints.
            </p>
          }
        >
          {(col) => (
            <For
              each={endpoints()}
              fallback={
                <div class="p-12 text-center">
                  <div class="text-foreground text-base font-medium">
                    No endpoints in <span class="font-mono font-semibold">{col().slug}</span>
                  </div>
                  <p class="text-muted-foreground mt-1 text-sm">
                    Add an endpoint to start forwarding webhooks to a local target.
                  </p>
                  <Button size="sm" onClick={() => openModal(null)} class="mt-4 gap-1">
                    <Plus class="size-3.5" />
                    <span>Add endpoint</span>
                  </Button>
                </div>
              }
            >
              {(ep) => (
                <div
                  class={cn(
                    "border-border space-y-2 border-b px-4 py-3.5",
                    (!ep.isActive || ep.isPaused) && "bg-muted/10",
                  )}
                >
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="text-foreground font-mono text-sm font-bold">{ep.pathName}</span>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => copyUrl(endpointUrl(ep), ep.id)}
                        title="Copy this endpoint's ingress URL"
                        aria-label="Copy ingress URL"
                      >
                        <Show when={copied() === ep.id} fallback={<Copy class="size-3" />}>
                          <Check class="size-3 text-emerald-500" />
                        </Show>
                      </Button>
                      <Show when={!ep.isActive}>
                        <Badge variant="secondary" size="sm">
                          inactive
                        </Badge>
                      </Show>
                      <Show when={ep.isPaused}>
                        <Badge variant="warning" size="sm">
                          paused: deliveries held
                        </Badge>
                      </Show>
                      <Show when={ep.secret.configured}>
                        <Badge
                          variant="success"
                          size="sm"
                          class="gap-1"
                          title="Stored only in this agent"
                        >
                          <Lock class="size-3" />
                          <span>secret in {ep.secret.headerName}</span>
                        </Badge>
                      </Show>
                      <SyncState
                        kind="endpoint"
                        id={ep.id}
                        pending={ep.pending}
                        hasConflict={ep.hasConflict}
                      />
                    </div>
                    <div class="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        pill
                        class="min-w-23"
                        onClick={() => void endpointsStore.toggleEndpointPause(ep)}
                      >
                        <Show
                          when={ep.isPaused}
                          fallback={
                            <>
                              <Pause class="size-3 text-amber-500" />
                              <span>Pause</span>
                            </>
                          }
                        >
                          <Play class="size-3 text-emerald-500" />
                          <span>Resume</span>
                        </Show>
                      </Button>
                      <Button variant="outline" size="sm" pill onClick={() => openModal(ep)}>
                        <Edit class="size-3" />
                        <span>Edit</span>
                      </Button>
                    </div>
                  </div>
                  <div class="flex items-center gap-2 font-mono text-xs">
                    <span class="text-muted-foreground uppercase">Target</span>
                    <Show
                      when={ep.localTarget}
                      fallback={
                        <span class="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                          <Alert class="size-3" />
                          none set: deliveries wait until a target is added
                        </span>
                      }
                    >
                      {(target) => (
                        <span class="text-foreground truncate select-all dark:text-emerald-400">
                          {target()}
                        </span>
                      )}
                    </Show>
                  </div>
                </div>
              )}
            </For>
          )}
        </Show>
      </div>

      <EndpointModal
        isOpen={isModalOpen()}
        onClose={() => setIsModalOpen(false)}
        collectionId={selectedCol()?.id ?? ""}
        endpoint={editingEp()}
      />
    </div>
  );
};
