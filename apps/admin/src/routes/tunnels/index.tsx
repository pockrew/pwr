import { useNavigate } from "@solidjs/router";
import { createForm } from "@tanstack/solid-form";
import { createMutation, createQuery } from "@tanstack/solid-query";
import { createMemo, createSignal, For, Show, type Component } from "solid-js";

import type { ManagedTunnel } from "@pockrew/pwr-shared/schemas";
import { Badge, Button, Card, Dialog, Empty, Input, toast } from "@pockrew/pwr-ui/core";
import { Close, Globe, Key, Plus, Reload, Search, Trash } from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

import { createTunnel, deleteTunnel, fetchTunnels, updateTunnel } from "~/libs/api-client";
import { queryClient } from "~/libs/query-client";

export const TunnelsPage: Component = () => {
  const navigate = useNavigate();
  const [search, setSearch] = createSignal("");
  const [isCreateOpen, setIsCreateOpen] = createSignal(false);

  const tunnelsQuery = createQuery(() => ({
    queryKey: ["tunnels"],
    queryFn: () => fetchTunnels(),
  }));

  const createTunnelMutation = createMutation(() => ({
    mutationFn: createTunnel,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["tunnels"] });
      setIsCreateOpen(false);
      form.reset();
      toast.success(`Tunnel "${created.name}" created successfully`);
    },
    onError: (err) => {
      toast.error("Failed to create tunnel", {
        description: err instanceof Error ? err.message : "Creation failed",
      });
    },
  }));

  const updateTunnelMutation = createMutation(() => ({
    mutationFn: ({ id, input }: { id: string; input: { isActive: boolean } }) =>
      updateTunnel(id, input),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["tunnels"] });
      toast.success(vars.input.isActive ? "Tunnel activated" : "Tunnel deactivated");
    },
    onError: (err) => {
      toast.error("Failed to update tunnel status", {
        description: err instanceof Error ? err.message : "Update failed",
      });
    },
  }));

  const deleteTunnelMutation = createMutation(() => ({
    mutationFn: deleteTunnel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tunnels"] });
      toast.success("Tunnel revoked");
    },
    onError: (err) => {
      toast.error("Failed to revoke tunnel", {
        description: err instanceof Error ? err.message : "Delete failed",
      });
    },
  }));

  const form = createForm(() => ({
    defaultValues: {
      name: "",
      slug: "",
    },
    onSubmit: async ({ value }) => {
      const name = value.name.trim();
      let slug = value.slug.trim();
      if (!slug) {
        slug = name
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, "-")
          .replace(/^-+|-+$/g, "");
      }
      if (!name || !slug) {
        toast.error("Name and slug are required");
        return;
      }
      await createTunnelMutation.mutateAsync({ name, slug, isActive: true });
    },
  }));

  const tunnels = () => tunnelsQuery.data ?? [];
  const isLoading = () => tunnelsQuery.isLoading;

  const filteredTunnels = createMemo(() => {
    const q = search().toLowerCase().trim();
    if (!q) return tunnels();
    return tunnels().filter(
      (t) =>
        t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q) || t.id.includes(q),
    );
  });

  const handleToggleActive = (tunnel: ManagedTunnel) => {
    if (
      tunnel.isActive &&
      !window.confirm(
        `Deactivate "${tunnel.name}"?\n\nIts ingress URLs reject webhooks until it is activated again.`,
      )
    )
      return;
    updateTunnelMutation.mutate({ id: tunnel.id, input: { isActive: !tunnel.isActive } });
  };

  const handleDeleteTunnel = (tunnel: ManagedTunnel) => {
    const confirmed = window.confirm(
      `Are you sure you want to revoke tunnel "${tunnel.name}" (${tunnel.slug})? Active relays will be disconnected.`,
    );
    if (!confirmed) return;
    deleteTunnelMutation.mutate(tunnel.id);
  };

  return (
    <div class="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 md:p-6">
      {/* Top Header / Action Row */}
      <div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <h1 class="text-foreground text-xl font-bold tracking-tight">Server Tunnels</h1>
            <Badge variant="secondary" class="font-mono text-xs">
              {tunnels().length}
            </Badge>
          </div>
          <p class="text-muted-foreground text-xs">
            Central ingress paths and reverse tunnel routing hubs hosted on this server.
          </p>
        </div>

        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            pill
            onClick={() => tunnelsQuery.refetch()}
            disabled={tunnelsQuery.isFetching}
          >
            <Reload class={cn("size-4", tunnelsQuery.isFetching && "animate-spin")} />
            <span>Refresh</span>
          </Button>

          <Button variant="cta" size="sm" onClick={() => setIsCreateOpen(true)}>
            <Plus class="size-4" />
            <span>New Tunnel</span>
          </Button>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div class="flex items-center gap-2">
        <div class="relative max-w-sm flex-1">
          <Input
            placeholder="Search by name, slug or ID..."
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
            leftAddon={<Search class="size-4" />}
            rightAddon={
              <Show when={search()}>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  pill
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  title="Clear search"
                >
                  <Close class="size-4" />
                </Button>
              </Show>
            }
          />
        </div>
      </div>

      {/* Tunnels Grid Container */}
      <Card class="border-border overflow-hidden shadow-xs">
        {/* Table Header Row */}
        <div class="bg-muted/40 text-muted-foreground border-border grid grid-cols-12 gap-3 border-b px-4 py-2.5 font-mono text-xs font-medium">
          <div class="col-span-1 text-center">Status</div>
          <div class="col-span-4">Tunnel & ID</div>
          <div class="col-span-4">Ingress</div>
          <div class="col-span-1 text-center">Active</div>
          <div class="col-span-2 text-right"></div>
        </div>

        {/* Content Rows */}
        <div class="divide-border divide-y">
          <Show
            when={!isLoading()}
            fallback={
              <div class="text-muted-foreground flex items-center justify-center gap-2 py-12 text-center font-mono text-xs">
                <span class="border-primary size-3 animate-spin rounded-full border-2 border-t-transparent" />
                <span>Loading server tunnels...</span>
              </div>
            }
          >
            <Show
              when={filteredTunnels().length > 0}
              fallback={
                <Empty
                  label="No Tunnels Found"
                  description='No tunnels found. Click "New Tunnel" to create one.'
                  class="border-0 bg-transparent py-12"
                />
              }
            >
              <For each={filteredTunnels()}>
                {(tunnel) => (
                  <div class="hover:bg-muted/30 grid grid-cols-12 items-center gap-3 px-4 py-3 text-xs transition-colors">
                    {/* Status Dot */}
                    <div class="col-span-1 text-center">
                      <span
                        class={cn(
                          "inline-block size-2 rounded-full",
                          tunnel.isActive
                            ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]"
                            : "bg-muted-foreground/40",
                        )}
                        title={
                          tunnel.isActive ? "Accepting webhooks" : "Inactive: webhooks rejected"
                        }
                      />
                    </div>

                    {/* Name & ID */}
                    <div class="col-span-4 overflow-hidden">
                      <div class="text-foreground truncate font-semibold">{tunnel.name}</div>
                      <div class="text-muted-foreground truncate font-mono text-[10px] select-all">
                        {tunnel.id}
                      </div>
                    </div>

                    {/* Ingress */}
                    <div class="col-span-4 overflow-hidden">
                      <button
                        type="button"
                        class="text-foreground hover:text-primary cursor-pointer truncate font-mono text-[11px] font-bold"
                        onClick={() => navigate(`/tunnels/${tunnel.id}`)}
                        title="Collections, endpoints and their ingress URLs"
                      >
                        /ingress/{tunnel.slug}/… →
                      </button>
                    </div>

                    {/* Active Toggle */}
                    <div class="col-span-1 text-center">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(tunnel)}
                        aria-label={tunnel.isActive ? "Deactivate tunnel" : "Activate tunnel"}
                        class={cn(
                          "relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                          tunnel.isActive ? "bg-primary" : "bg-muted",
                        )}
                        title={tunnel.isActive ? "Deactivate" : "Activate"}
                      >
                        <span
                          class={cn(
                            "bg-background pointer-events-none inline-block size-3 transform rounded-full shadow-xs transition duration-200 ease-in-out",
                            tunnel.isActive ? "translate-x-3" : "translate-x-0",
                          )}
                        />
                      </button>
                    </div>

                    {/* Actions */}
                    <div class="col-span-2 text-right">
                      <div class="flex items-center justify-end gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          pill
                          onClick={() => navigate(`/tunnels/${tunnel.id}/keys`)}
                        >
                          <Key class="text-primary size-4" />
                          <span>Keys</span>
                        </Button>

                        <Button
                          variant="destructive"
                          size="icon-xs"
                          pill
                          onClick={() => handleDeleteTunnel(tunnel)}
                          aria-label={`Revoke tunnel ${tunnel.name}`}
                          title="Revoke / Delete Tunnel"
                        >
                          <Trash class="size-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </Card>

      {/* Modal / Dialog: Create New Tunnel */}
      <Dialog.Root open={isCreateOpen()} onOpenChange={setIsCreateOpen}>
        <Dialog.Content class="max-w-md">
          <Dialog.Header>
            <Dialog.Title class="flex items-center gap-2 text-lg">
              <Globe class="text-primary size-4" />
              <span>New Tunnel</span>
            </Dialog.Title>
          </Dialog.Header>
          <div class="p-5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                form.handleSubmit();
              }}
              class="space-y-4"
            >
              <form.Field
                name="name"
                validators={{
                  onChange: ({ value }) => (!value.trim() ? "Tunnel name is required" : undefined),
                }}
              >
                {(field) => (
                  <Input
                    label="Tunnel Name"
                    placeholder="e.g. Payment Webhooks"
                    value={field().state.value}
                    onInput={(e) => {
                      field().handleChange(e.currentTarget.value);
                      if (!form.getFieldValue("slug")) {
                        form.setFieldValue(
                          "slug",
                          e.currentTarget.value
                            .toLowerCase()
                            .replace(/[^a-z0-9_-]+/g, "-")
                            .replace(/^-+|-+$/g, ""),
                        );
                      }
                    }}
                    error={
                      field().state.meta.errors.length ? String(field().state.meta.errors[0]) : null
                    }
                    required
                  />
                )}
              </form.Field>

              <form.Field
                name="slug"
                validators={{
                  onChange: ({ value }) => {
                    if (!value.trim()) return "Ingress slug is required";
                    if (!/^[a-z0-9_-]+$/.test(value.trim())) {
                      return "Slug may only contain letters, numbers, hyphens, and underscores";
                    }
                    return undefined;
                  },
                }}
              >
                {(field) => (
                  <Input
                    label="Ingress Slug"
                    placeholder="payments"
                    value={field().state.value}
                    onInput={(e) => field().handleChange(e.currentTarget.value)}
                    leftAddon="/ingress/"
                    hint="Unique URL identifier for webhooks from external providers."
                    error={
                      field().state.meta.errors.length ? String(field().state.meta.errors[0]) : null
                    }
                    required
                  />
                )}
              </form.Field>

              <div class="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  pill
                  onClick={() => setIsCreateOpen(false)}
                  disabled={createTunnelMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="cta"
                  size="sm"
                  disabled={createTunnelMutation.isPending}
                >
                  <Show when={createTunnelMutation.isPending} fallback="Create Tunnel">
                    <span class="border-primary-foreground mr-2 size-3 animate-spin rounded-full border-2 border-t-transparent" />
                    Creating...
                  </Show>
                </Button>
              </div>
            </form>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
};
