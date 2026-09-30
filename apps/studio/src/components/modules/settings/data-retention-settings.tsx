import { createMutation, createQuery } from "@tanstack/solid-query";
import { createEffect, createSignal, Show, type Component } from "solid-js";
import { toast } from "solid-sonner";

import { RetentionConfigSchema, type RetentionConfig } from "@pockrew/pwr-shared/schemas";
import { Badge, Button, Checkbox, Input, TextField } from "@pockrew/pwr-ui/core";
import { Trash } from "@pockrew/pwr-ui/icons";

import { fetchRetention, pruneOlderThan, saveRetention } from "~/libs/api-client";
import { formatBytes } from "~/libs/format-bytes";
import { queryClient } from "~/libs/query-client";

const retentionKey = ["agent", "retention"] as const;

const BLOCK_REASONS: Record<string, string> = {
  capacity: "the database reached its size limit",
  disk_free: "free disk space is low",
  write_failed: "a database write failed",
};

const NumberField: Component<{
  label: string;
  description: string;
  value: string;
  onInput: (value: string) => void;
}> = (props) => (
  <TextField.Root class="max-w-md">
    <TextField.Label>{props.label}</TextField.Label>
    <TextField.Input
      type="number"
      min="1"
      value={props.value}
      onInput={(event) => props.onInput(event.currentTarget.value)}
      class="font-mono text-sm"
    />
    <TextField.Description>{props.description}</TextField.Description>
  </TextField.Root>
);

/**
 * Retention policy and storage of the agent's local history. Pruning only removes deliveries
 * the server has confirmed; pending work, unreported results, dependent replays, config and
 * secrets are always kept.
 */
export const DataRetentionSettings: Component = () => {
  const retention = createQuery(
    () => ({ queryKey: retentionKey, queryFn: fetchRetention }),
    () => queryClient,
  );
  const [maxEvents, setMaxEvents] = createSignal("");
  const [retentionDays, setRetentionDays] = createSignal("");
  const [maxDbSizeMb, setMaxDbSizeMb] = createSignal("");
  const [autoVacuum, setAutoVacuum] = createSignal(true);
  const [pruneDays, setPruneDays] = createSignal("7");

  createEffect(() => {
    const config = retention.data?.config;
    if (!config) return;
    setMaxEvents(String(config.maxEvents));
    setRetentionDays(String(config.retentionDays));
    setMaxDbSizeMb(String(config.maxDbSizeMb));
    setAutoVacuum(config.autoVacuum);
  });

  const draft = () =>
    RetentionConfigSchema.safeParse({
      maxEvents: Number(maxEvents()),
      retentionDays: Number(retentionDays()),
      maxDbSizeMb: Number(maxDbSizeMb()),
      autoVacuum: autoVacuum(),
    });

  const save = createMutation(
    () => ({
      mutationFn: (config: RetentionConfig) => saveRetention(config),
      onSuccess: (saved) => {
        queryClient.setQueryData(retentionKey, saved);
        toast.success("Retention policy saved and applied");
      },
      onError: (error) => toast.error(error.message),
    }),
    () => queryClient,
  );

  const prune = createMutation(
    () => ({
      mutationFn: (days: number) => pruneOlderThan(days),
      onSuccess: (result) => {
        toast.success(
          `Pruned ${result.deletedCount} events and ${result.deletedPackages} deliveries`,
        );
        void queryClient.invalidateQueries({ queryKey: retentionKey });
      },
      onError: (error) => toast.error(error.message),
    }),
    () => queryClient,
  );

  const handlePrune = () => {
    const days = Number(pruneDays());
    if (!Number.isInteger(days) || days < 1)
      return toast.error("Enter a number of days (1 or more)");
    const confirmed = window.confirm(
      `Prune history older than ${days} days?\n\nOnly deliveries the server has confirmed are removed. Pending work, unreported results, replays that depend on them, config and secrets are kept.`,
    );
    if (confirmed) prune.mutate(days);
  };

  return (
    <Show
      when={retention.data}
      fallback={
        <p class="text-muted-foreground text-sm">
          {retention.isError
            ? `Could not load retention settings: ${retention.error?.message}`
            : "Loading retention settings…"}
        </p>
      }
    >
      {(data) => (
        <div class="w-full max-w-2xl space-y-8">
          <section class="space-y-3">
            <div class="flex items-center gap-2">
              <h3 class="text-foreground text-lg font-bold">Storage</h3>
              <Badge
                variant={data().storage.state === "ready" ? "success" : "destructive"}
                class="text-xs"
              >
                {data().storage.state === "ready" ? "Accepting deliveries" : "Intake stopped"}
              </Badge>
            </div>
            <Show when={data().storage.state === "blocked"}>
              <p class="text-destructive text-sm">
                New deliveries wait on the server because{" "}
                {BLOCK_REASONS[data().storage.reason ?? ""] ?? "storage is blocked"}. Stored work is
                kept.
              </p>
            </Show>
            <dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 font-mono text-sm">
              <dt class="text-muted-foreground">Database</dt>
              <dd>
                {formatBytes(data().storage.usedBytes)} of {formatBytes(data().storage.limitBytes)}
              </dd>
              <dt class="text-muted-foreground">Free disk</dt>
              <dd>
                {data().storage.freeDiskBytes === null
                  ? "unknown"
                  : formatBytes(data().storage.freeDiskBytes)}
              </dd>
              <dt class="text-muted-foreground">Pending deliveries</dt>
              <dd>{data().storage.pendingPackages}</dd>
              <dt class="text-muted-foreground">Unreported results</dt>
              <dd>{data().storage.unreportedResults}</dd>
              <dt class="text-muted-foreground">Kept history</dt>
              <dd>{data().storage.retainedPackages} deliveries</dd>
            </dl>
          </section>

          <section class="border-border space-y-4 border-t pt-6">
            <div>
              <h3 class="text-foreground text-lg font-bold">Retention policy</h3>
              <p class="text-muted-foreground text-sm">
                Applied at startup, every minute, and when saved.
              </p>
            </div>
            <form
              class="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                const parsed = draft();
                if (parsed.success) save.mutate(parsed.data);
              }}
            >
              <NumberField
                label="Keep at most (deliveries)"
                description="Older confirmed deliveries beyond this count are pruned first."
                value={maxEvents()}
                onInput={setMaxEvents}
              />
              <NumberField
                label="Keep for (days)"
                description="Confirmed deliveries older than this are pruned."
                value={retentionDays()}
                onInput={setRetentionDays}
              />
              <NumberField
                label="Stop intake at (MB)"
                description="At this database size the agent stops accepting new deliveries until space is freed. It is not a hard cap on the file."
                value={maxDbSizeMb()}
                onInput={setMaxDbSizeMb}
              />
              <Checkbox
                checked={autoVacuum()}
                onChange={setAutoVacuum}
                class="flex max-w-md items-center gap-2"
              >
                <Checkbox.Control class="size-4" />
                <Checkbox.Label class="text-sm">Reclaim disk space after pruning</Checkbox.Label>
              </Checkbox>
              <Show when={!draft().success}>
                <p class="text-destructive text-xs">All values must be whole numbers above 0.</p>
              </Show>
              <Button type="submit" pill disabled={save.isPending || !draft().success}>
                {save.isPending ? "Saving…" : "Save retention policy"}
              </Button>
            </form>
          </section>

          <section class="border-border space-y-3 border-t pt-6">
            <div>
              <h3 class="text-foreground text-lg font-bold">Prune now</h3>
              <p class="text-muted-foreground text-sm">
                Remove confirmed history older than a number of days, under the same safe policy.
              </p>
            </div>
            <div class="flex max-w-md items-center gap-2">
              <span class="text-sm">Older than</span>
              <Input
                type="number"
                min={1}
                aria-label="Days"
                value={pruneDays()}
                onInput={(event) => setPruneDays(event.currentTarget.value)}
                class="h-8 w-20 font-mono text-xs"
              />
              <span class="text-muted-foreground text-sm">days</span>
              <Button
                variant="destructive"
                size="sm"
                pill
                disabled={prune.isPending}
                onClick={handlePrune}
              >
                <Trash class="size-3.5" />
                <span>{prune.isPending ? "Pruning…" : "Prune"}</span>
              </Button>
            </div>
          </section>
        </div>
      )}
    </Show>
  );
};
