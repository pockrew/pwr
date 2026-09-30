import { createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js";

import { Badge, Button, Card, Input, Kbd } from "@pockrew/pwr-ui/core";
import { Close, Edit, Folder, Plus, Search } from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

import { isInputFocused, isOverlayOpen } from "~/libs/keyboard";
import { endpointsStore, type CollectionItem } from "~/stores/endpoints.store";

import { CollectionModal } from "./collection-modal";
import { SyncState } from "./sync-state";

export const CollectionListPanel: Component = () => {
  const [isModalOpen, setIsModalOpen] = createSignal(false);
  const [editingCol, setEditingCol] = createSignal<CollectionItem | null>(null);
  let searchInputRef: HTMLInputElement | undefined;

  const openCreateModal = () => {
    setEditingCol(null);
    setIsModalOpen(true);
  };

  const openEditModal = (col: CollectionItem) => {
    setEditingCol(col);
    setIsModalOpen(true);
  };

  const getEndpointCount = (colId: string) => {
    return endpointsStore.endpoints.filter((e) => e.collectionId === colId).length;
  };

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

      if (e.key === "/") {
        e.preventDefault();
        searchInputRef?.focus();
        return;
      }

      // j / ArrowDown -> Next collection
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const list = endpointsStore.filteredCollections;
        if (!list.length) return;
        const idx = list.findIndex((c) => c.id === endpointsStore.selectedCollectionId);
        const nextIdx = idx < list.length - 1 ? idx + 1 : 0;
        const nextCol = list[nextIdx];
        if (nextCol) endpointsStore.setSelectedCollectionId(nextCol.id);
        return;
      }

      // k / ArrowUp -> Previous collection
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const list = endpointsStore.filteredCollections;
        if (!list.length) return;
        const idx = list.findIndex((c) => c.id === endpointsStore.selectedCollectionId);
        const prevIdx = idx > 0 ? idx - 1 : list.length - 1;
        const prevCol = list[prevIdx];
        if (prevCol) endpointsStore.setSelectedCollectionId(prevCol.id);
        return;
      }

      // c / n -> New collection
      if (e.key === "c" || e.key === "n" || e.key === "C" || e.key === "N") {
        e.preventDefault();
        openCreateModal();
        return;
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

  return (
    <div class="border-border flex h-full flex-col overflow-hidden border-r">
      {/* Panel Header */}
      <div class="flex h-11 shrink-0 items-center justify-between px-3">
        <div class="flex items-center gap-2">
          <Folder class="text-muted-foreground size-4" />
          <h2 class="text-foreground text-base font-bold tracking-tight">Collections</h2>
          <Badge variant="secondary" class="px-1.5 py-0 font-mono text-xs">
            {endpointsStore.collections.length}
          </Badge>
        </div>

        <Button
          variant="default"
          size="sm"
          onClick={openCreateModal}
          class="h-7 gap-1 px-3 text-xs shadow-xs"
          title="New Collection (c or n)"
        >
          <Plus class="size-3.5" />
          <span>New</span>
        </Button>
      </div>

      {/* Search Bar */}
      <form onSubmit={(e) => e.preventDefault()} class="px-2 py-1">
        <Input
          ref={(el) => (searchInputRef = el)}
          value={endpointsStore.collectionFilter}
          onInput={(e) => endpointsStore.setCollectionFilter(e.currentTarget.value)}
          placeholder="Filter collection..."
          class="rounded-full"
          leftAddon={<Search class="size-4" />}
          rightAddon={
            <Show
              when={endpointsStore.collectionFilter.length > 0}
              fallback={<Kbd size="sm">/</Kbd>}
            >
              <Button
                variant="ghost"
                size="icon-xs"
                class="text-muted-foreground hover:text-foreground"
                onClick={() => endpointsStore.setCollectionFilter("")}
              >
                <Close class="size-4" />
              </Button>
            </Show>
          }
        />
      </form>
      <div class="border-border flex w-full items-center justify-between border-b p-2 text-sm">
        <div class="inline-flex flex-1 items-center gap-1">
          Matched <Kbd size="sm">{endpointsStore.filteredCollections.length}</Kbd>
        </div>
        <div class="inline-flex gap-2">
          <Kbd size="sm">J</Kbd>
          <Kbd size="sm">K</Kbd>
        </div>
      </div>
      {/* Collections List */}
      <div class="flex-1 overflow-y-auto pb-2">
        <For
          each={endpointsStore.filteredCollections}
          fallback={
            <div class="text-muted-foreground p-4 text-center text-xs">No collections found.</div>
          }
        >
          {(col) => {
            const isSelected = () => endpointsStore.selectedCollectionId === col.id;
            const count = () => getEndpointCount(col.id);

            return (
              <Card
                tabIndex={0}
                onClick={() => endpointsStore.setSelectedCollectionId(col.id)}
                class={cn(
                  "duration-micro group flex flex-col rounded-none border-t-0 border-r-0 border-l-2 p-2.5 transition-colors select-none",
                  isSelected()
                    ? "border-l-primary bg-muted/70"
                    : "hover:bg-muted/30 border-l-transparent",
                )}
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-1.5 overflow-hidden">
                    <span
                      class={cn(
                        "size-2 shrink-0 rounded-full",
                        col.isActive ? "bg-emerald-500" : "bg-muted-foreground/40",
                      )}
                      title={col.isActive ? "Active" : "Inactive: gets no deliveries"}
                    />
                    <span class="truncate font-mono text-base font-bold">{col.slug}</span>
                  </div>

                  <div class="flex items-center gap-1">
                    <span class="bg-secondary text-muted-foreground py-0.2 rounded-full px-1.5 font-mono text-xs">
                      {count()} {count() === 1 ? "endpoint" : "endpoints"}
                    </span>
                  </div>
                </div>

                <div class="flex min-h-6 items-center justify-between">
                  <SyncState
                    kind="collection"
                    id={col.id}
                    pending={col.pending}
                    hasConflict={col.hasConflict}
                  />

                  <div class="hidden items-center gap-1 group-hover:flex">
                    <Button
                      onClick={() => openEditModal(col)}
                      variant="outline"
                      size="icon-xs"
                      pill
                    >
                      <Edit class="size-3" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          }}
        </For>
      </div>

      <CollectionModal
        isOpen={isModalOpen()}
        onClose={() => setIsModalOpen(false)}
        collection={editingCol()}
      />
    </div>
  );
};
