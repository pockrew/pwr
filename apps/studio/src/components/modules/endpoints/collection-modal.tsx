import { createEffect, createSignal, Show, type Component } from "solid-js";

import { CreateCollectionSchema } from "@pockrew/pwr-shared/schemas";
import { Button, Checkbox, Input, Sheet } from "@pockrew/pwr-ui/core";
import { Folder } from "@pockrew/pwr-ui/icons";

import { endpointsStore, type CollectionItem } from "~/stores/endpoints.store";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  collection?: CollectionItem | null;
}

/** Create or edit a collection: its slug (a label) and whether it accepts webhooks. */
export const CollectionModal: Component<Props> = (props) => {
  const [slug, setSlug] = createSignal("");
  const [isActive, setIsActive] = createSignal(true);
  const [saving, setSaving] = createSignal(false);

  createEffect(() => {
    if (!props.isOpen) return;
    setSlug(props.collection?.slug ?? "");
    setIsActive(props.collection?.isActive ?? true);
  });

  const error = () => {
    const value = slug().trim();
    if (!value) return "Slug is required";
    const parsed = CreateCollectionSchema.shape.slug.safeParse(value);
    if (!parsed.success) return parsed.error.issues[0]?.message ?? "Invalid slug";
    const taken = endpointsStore.collections.some(
      (c) => c.slug === parsed.data && c.id !== props.collection?.id,
    );
    return taken ? `"${parsed.data}" is already used by another collection` : null;
  };

  const ingressUrl = () =>
    props.collection && endpointsStore.ingressBaseUrl
      ? `${endpointsStore.ingressBaseUrl}/${props.collection.id}`
      : null;

  const submit = async () => {
    if (error()) return;
    setSaving(true);
    const input = { slug: slug().trim(), isActive: isActive() };
    const saved = props.collection
      ? await endpointsStore.updateCollection(props.collection.id, input)
      : await endpointsStore.createCollection(input);
    setSaving(false);
    if (saved) props.onClose();
  };

  return (
    <Sheet.Root
      open={props.isOpen}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Sheet.Content side="right" class="max-w-md">
        <Sheet.Header class="h-11 shrink-0 flex-row items-center justify-between py-0">
          <div class="flex items-center gap-2">
            <div class="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-md">
              <Folder class="size-4" />
            </div>
            <Sheet.Title>{props.collection ? "Edit Collection" : "New Collection"}</Sheet.Title>
          </div>
        </Sheet.Header>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          class="flex flex-1 flex-col overflow-hidden"
        >
          <div class="flex-1 space-y-4 overflow-y-auto p-4">
            <div class="space-y-1">
              <Input
                label="Slug"
                value={slug()}
                onInput={(event) => setSlug(event.currentTarget.value)}
                placeholder="stripe"
                required
                class="rounded-full"
                hint="A short name for this collection."
              />
              <Show when={slug() && error()}>
                <p class="text-destructive pl-1 text-xs">{error()}</p>
              </Show>
            </div>

            <div class="bg-surface/70 border-border space-y-1 rounded-2xl border p-3 text-xs">
              <div class="text-foreground font-medium">Ingress URL</div>
              <Show
                when={ingressUrl()}
                fallback={
                  <p class="text-muted-foreground">
                    {props.collection
                      ? "Available once this tunnel has synced with its server."
                      : "Created with the collection: <server>/ingress/<tunnel>/<collection ID>."}
                  </p>
                }
              >
                {(url) => <code class="text-foreground font-mono break-all">{url()}</code>}
              </Show>
            </div>

            <Checkbox
              checked={isActive()}
              onChange={setIsActive}
              class="bg-surface/70 border-border flex items-center justify-between rounded-2xl border p-3"
            >
              <div>
                <Checkbox.Label class="text-foreground text-sm font-medium">Active</Checkbox.Label>
                <div class="text-muted-foreground text-xs">
                  An inactive collection gets no deliveries; the server still stores the webhooks.
                </div>
              </div>
              <Checkbox.Control class="size-4" />
            </Checkbox>
          </div>

          <Sheet.Footer class="bg-background">
            <Button type="button" variant="outline" pill onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit" pill disabled={saving() || Boolean(error())}>
              {saving() ? "Saving…" : props.collection ? "Save changes" : "Create collection"}
            </Button>
          </Sheet.Footer>
        </form>
      </Sheet.Content>
    </Sheet.Root>
  );
};
