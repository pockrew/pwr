import { useNavigate, useParams } from "@solidjs/router";
import { createMutation, createQuery } from "@tanstack/solid-query";
import { createMemo, createSignal, For, Show, type Component } from "solid-js";

import type { ManagedKey } from "@pockrew/pwr-shared/schemas";
import { Badge, Button, Card, Empty, Tabs, toast } from "@pockrew/pwr-ui/core";
import { ArrowLeft, Plus, Reload, Trash } from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

import { IssueKeyDialog } from "~/components/keys/issue-key-dialog";
import { RevealedTokenDialog } from "~/components/keys/revealed-token-dialog";
import { fetchTunnelKeys, revokeTunnelKey } from "~/libs/api-client";
import { queryClient } from "~/libs/query-client";

export const TunnelKeysPage: Component = () => {
  const params = useParams<{ tunnelId: string }>();
  const navigate = useNavigate();

  const [filterType, setFilterType] = createSignal<string>("all");
  const [isIssueModalOpen, setIsIssueModalOpen] = createSignal(false);
  const [revealedToken, setRevealedToken] = createSignal<string | null>(null);

  const keysQuery = createQuery(() => ({
    queryKey: ["tunnels", params.tunnelId, "keys"],
    queryFn: () => fetchTunnelKeys(params.tunnelId),
    enabled: Boolean(params.tunnelId),
  }));

  const revokeKeyMutation = createMutation(() => ({
    mutationFn: (keyId: string) => revokeTunnelKey(params.tunnelId, keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tunnels", params.tunnelId, "keys"] });
      toast.success("Key revoked");
    },
    onError: (err) => {
      toast.error("Failed to revoke key", {
        description: err instanceof Error ? err.message : "Revocation failed",
      });
    },
  }));

  const keys = () => keysQuery.data ?? [];
  const isLoading = () => keysQuery.isLoading;

  const filteredKeys = createMemo(() => {
    const type = filterType();
    if (type === "all") return keys();
    return keys().filter((k) => k.types === type);
  });

  const handleRevokeKey = async (key: ManagedKey) => {
    const confirmed = window.confirm(
      `Revoke key "${key.name}"? If this is an active outbound relay key, the connected agent will be disconnected immediately.`,
    );
    if (!confirmed) return;
    revokeKeyMutation.mutate(key.id);
  };

  return (
    <div class="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 md:p-6">
      {/* Back button and Header */}
      <div class="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/tunnels")}
          class="text-muted-foreground hover:text-foreground -ml-2 h-7 gap-1.5 px-2 font-mono text-xs"
        >
          <ArrowLeft class="size-3.5" />
          <span>Back to Tunnels</span>
        </Button>

        <div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <h1 class="text-foreground text-xl font-bold tracking-tight">Credential Vault</h1>
              <Badge variant="outline" class="font-mono text-xs">
                {params.tunnelId}
              </Badge>
            </div>
            <p class="text-muted-foreground text-xs">
              Manage ingress authorization keys, relay tokens, and admin bearer credentials.
            </p>
          </div>

          <div class="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              pill
              onClick={() => keysQuery.refetch()}
              disabled={keysQuery.isFetching}
            >
              <Reload class={cn("size-3.5", keysQuery.isFetching && "animate-spin")} />
              <span>Refresh</span>
            </Button>

            <Button
              size="sm"
              class="h-8 gap-1.5 text-xs font-semibold"
              onClick={() => setIsIssueModalOpen(true)}
            >
              <Plus class="size-3.5" />
              <span>Issue Key</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <Tabs value={filterType()} onChange={setFilterType} class="w-full">
        <Tabs.List class="border-border border-b pb-0">
          <For
            each={[
              { id: "all", label: "All Keys" },
              { id: "inbound", label: "Inbound (Ingress)" },
              { id: "outbound", label: "Outbound (Relay)" },
              { id: "admin", label: "Admin CLI" },
            ]}
          >
            {(tab) => (
              <Tabs.Trigger value={tab.id} class="h-8 px-3 font-mono text-xs">
                {tab.label}
              </Tabs.Trigger>
            )}
          </For>
        </Tabs.List>
      </Tabs>

      {/* Keys Grid Container */}
      <Card class="border-border overflow-hidden shadow-xs">
        {/* Table Header Row */}
        <div class="bg-muted/40 text-muted-foreground border-border grid grid-cols-12 gap-3 border-b px-4 py-2.5 font-mono text-xs font-medium">
          <div class="col-span-3">Name & Role</div>
          <div class="col-span-3">Key Prefix</div>
          <div class="col-span-3">Permissions / Scope</div>
          <div class="col-span-2">Created</div>
          <div class="col-span-1 text-right">Actions</div>
        </div>

        {/* Content Rows */}
        <div class="divide-border divide-y">
          <Show
            when={!isLoading()}
            fallback={
              <div class="text-muted-foreground flex items-center justify-center gap-2 py-12 text-center font-mono text-xs">
                <span class="border-primary size-3 animate-spin rounded-full border-2 border-t-transparent" />
                <span>Loading credentials...</span>
              </div>
            }
          >
            <Show
              when={filteredKeys().length > 0}
              fallback={
                <Empty
                  label="No Credentials Found"
                  description='No keys found in this category. Click "Issue Key" to create one.'
                  class="border-0 bg-transparent py-12"
                />
              }
            >
              <For each={filteredKeys()}>
                {(k) => (
                  <div class="hover:bg-muted/30 grid grid-cols-12 items-center gap-3 px-4 py-3 text-xs transition-colors">
                    {/* Name & Type */}
                    <div class="col-span-3 overflow-hidden">
                      <div class="text-foreground truncate font-semibold">{k.name}</div>
                      <div class="mt-0.5">
                        <Badge
                          variant={
                            k.types === "outbound"
                              ? "success"
                              : k.types === "inbound"
                                ? "info"
                                : "default"
                          }
                          class="font-mono text-[9px] tracking-wider uppercase"
                        >
                          {k.types}
                        </Badge>
                      </div>
                    </div>

                    {/* Prefix */}
                    <div class="text-muted-foreground col-span-3 truncate font-mono text-[11px]">
                      {k.keyPrefix}••••••
                    </div>

                    {/* Permissions */}
                    <div class="col-span-3">
                      <Show
                        when={k.permissions.length > 0}
                        fallback={
                          <span class="text-muted-foreground font-mono text-[11px]">—</span>
                        }
                      >
                        <div class="flex flex-wrap gap-1">
                          <For each={k.permissions}>
                            {(perm) => (
                              <Badge variant="outline" class="px-1.5 py-0 font-mono text-[10px]">
                                {perm}
                              </Badge>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>

                    {/* Created Date */}
                    <div class="text-muted-foreground col-span-2 font-mono text-[11px]">
                      {new Date(k.createdAt).toLocaleDateString()}
                    </div>

                    {/* Revoke Action */}
                    <div class="col-span-1 text-right">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        class="text-muted-foreground hover:text-destructive size-7"
                        onClick={() => handleRevokeKey(k)}
                        aria-label={`Revoke key ${k.name}`}
                        title="Revoke key"
                      >
                        <Trash class="size-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </Card>

      <IssueKeyDialog
        tunnelId={params.tunnelId}
        open={isIssueModalOpen()}
        onOpenChange={setIsIssueModalOpen}
        onIssued={setRevealedToken}
      />
      <RevealedTokenDialog token={revealedToken()} onClose={() => setRevealedToken(null)} />
    </div>
  );
};
