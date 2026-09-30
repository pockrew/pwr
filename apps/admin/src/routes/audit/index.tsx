import { createInfiniteQuery } from "@tanstack/solid-query";
import { createMemo, createSignal, For, Show, type Component } from "solid-js";

import { Badge, Button, Card, Empty, Input } from "@pockrew/pwr-ui/core";
import { Reload, Search } from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

import { fetchAuditPage, type AuditItem } from "~/libs/api-client";

const text = (value: unknown): string | null =>
  typeof value === "string" || typeof value === "number" ? String(value) : null;

/** What happened, from the recorded fields only; nothing is filled in when absent. */
const describe = (item: AuditItem) => {
  const d = item.details;
  const status = typeof d["status"] === "number" ? d["status"] : null;
  const failed = item.action.endsWith("_failed") || (status !== null && status >= 400);
  return {
    actor: text(d["keyName"]) ?? text(d["provider"]) ?? item.entityId,
    ip: text(d["ip"]) ?? text(d["sourceIp"]),
    request: [text(d["method"]), text(d["path"])].filter(Boolean).join(" "),
    outcome: status !== null ? String(status) : failed ? "rejected" : "no outcome",
    failed,
  };
};

/** Audit trail of relay-key management requests and rejected signed ingress, newest first. */
export const AuditPage: Component = () => {
  const [search, setSearch] = createSignal("");
  const [failedOnly, setFailedOnly] = createSignal(false);
  const audit = createInfiniteQuery(() => ({
    queryKey: ["audit-logs"],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => fetchAuditPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: { nextCursor: string | null }) => page.nextCursor ?? undefined,
  }));
  const items = () => audit.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = createMemo(() => {
    const q = search().toLowerCase().trim();
    return items().filter((item) => {
      if (failedOnly() && !describe(item).failed) return false;
      return !q || JSON.stringify(item).toLowerCase().includes(q);
    });
  });

  return (
    <div class="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4 md:p-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-foreground text-xl font-bold tracking-tight">Audit Log</h1>
          <p class="text-muted-foreground text-xs">
            Relay-key management requests and rejected provider signatures. {items().length} loaded.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          pill
          onClick={() => void audit.refetch()}
          disabled={audit.isFetching}
        >
          <Reload class={cn("size-3.5", audit.isFetching && "animate-spin")} />
          <span>Refresh</span>
        </Button>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <div class="max-w-sm flex-1">
          <Input
            placeholder="Search loaded records…"
            value={search()}
            onInput={(event) => setSearch(event.currentTarget.value)}
            leftAddon={<Search class="size-4" />}
          />
        </div>
        <Button
          size="sm"
          pill
          variant={failedOnly() ? "default" : "outline"}
          onClick={() => setFailedOnly(!failedOnly())}
        >
          Failed / rejected only
        </Button>
      </div>
      <Show when={audit.isError}>
        <p class="text-destructive text-sm">{audit.error?.message}</p>
      </Show>
      <Card class="divide-border divide-y font-mono text-xs">
        <For
          each={filtered()}
          fallback={
            <Show when={audit.isSuccess}>
              <Empty
                label="No audit records"
                description="Nothing matches, or nothing was recorded yet."
                class="border-0 py-12"
              />
            </Show>
          }
        >
          {(item) => {
            const view = describe(item);
            return (
              <div class="grid grid-cols-12 items-center gap-3 px-4 py-2.5">
                <div class="text-muted-foreground col-span-3 truncate">
                  {new Date(item.createdAt).toLocaleString()}
                </div>
                <div class="col-span-3 overflow-hidden">
                  <div class="text-foreground truncate font-sans font-medium">{view.actor}</div>
                  <div class="text-muted-foreground truncate">{item.action}</div>
                </div>
                <div class="text-muted-foreground col-span-2 truncate">{view.ip ?? "—"}</div>
                <div class="text-foreground col-span-3 truncate">{view.request || "—"}</div>
                <div class="col-span-1 text-right">
                  <Badge
                    variant={
                      view.failed
                        ? "destructive"
                        : view.outcome === "no outcome"
                          ? "secondary"
                          : "success"
                    }
                  >
                    {view.outcome}
                  </Badge>
                </div>
              </div>
            );
          }}
        </For>
      </Card>
      <Show when={audit.hasNextPage}>
        <Button
          variant="outline"
          size="sm"
          pill
          class="self-center"
          disabled={audit.isFetchingNextPage}
          onClick={() => void audit.fetchNextPage()}
        >
          {audit.isFetchingNextPage ? "Loading…" : "Load older records"}
        </Button>
      </Show>
    </div>
  );
};
