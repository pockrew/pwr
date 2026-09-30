import { createSignal, For, Show, type Component } from "solid-js";
import { toast } from "solid-sonner";

import { Badge, Button } from "@pockrew/pwr-ui/core";
import { Activity, Check, Close, Copy, Cpu, Reload } from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

import { formatBytes } from "~/libs/format-bytes";
import {
  createAgentHealthQuery,
  createRestartAgentMutation,
  createStopAgentMutation,
} from "~/libs/queries/agent.queries";

import { AgentUpdateSection } from "./agent-update-section";

const START_COMMAND = "pwr agent start";

const STORAGE_BLOCK_REASONS: Record<string, string> = {
  capacity: "database size limit reached",
  disk_free: "low free disk space",
  write_failed: "a write failed",
};

/** Compact uptime such as `45s`, `12m 5s`, `3h 20m` or `2d 4h`. */
const formatUptime = (totalSeconds: number): string => {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${totalSeconds % 60}s`;
  return `${totalSeconds}s`;
};

export const AgentControlSettings: Component = () => {
  const health = createAgentHealthQuery();
  const restart = createRestartAgentMutation();
  const stop = createStopAgentMutation();
  const [copied, setCopied] = createSignal(false);

  const isBusy = () => restart.isPending || stop.isPending;
  const agent = () => (health.isError ? undefined : health.data);

  const status = (): { label: string; variant: "success" | "warning" | "destructive" | "info" } => {
    if (restart.isPending) return { label: "Restarting…", variant: "info" };
    if (stop.isPending) return { label: "Stopping…", variant: "info" };
    if (health.isPending) return { label: "Checking…", variant: "info" };
    const data = agent();
    if (!data) return { label: "Offline", variant: "destructive" };
    if (data.status === "storage_blocked") return { label: "Storage blocked", variant: "warning" };
    return { label: "Running", variant: "success" };
  };

  const details = () => {
    const data = agent();
    if (!data) return [];
    const { storage } = data;
    return [
      { label: "Version", value: `v${data.version}` },
      { label: "Uptime", value: formatUptime(data.uptimeSeconds) },
      {
        label: "Tunnels",
        value: `${data.activeTunnelsCount} of ${data.totalTunnelsCount} connected`,
      },
      {
        label: "Storage",
        value:
          storage.state === "blocked"
            ? `Intake stopped: ${STORAGE_BLOCK_REASONS[storage.reason ?? ""] ?? "blocked"}`
            : `${formatBytes(storage.usedBytes)} of ${formatBytes(storage.limitBytes)}`,
      },
      {
        label: "Pending work",
        value: `${storage.pendingPackages} deliveries, ${storage.unreportedResults} unreported results`,
      },
    ];
  };

  const handleRestart = () => {
    const confirmed = window.confirm(
      "Restart the local agent?\n\nTunnels disconnect briefly. In-flight deliveries finish first and pending work resumes after the restart.",
    );
    if (!confirmed) return;
    restart.mutate(undefined, {
      onSuccess: (next) => toast.success(`Agent restarted (v${next.version})`),
      onError: (error) => toast.error(error.message),
    });
  };

  const handleStop = () => {
    const confirmed = window.confirm(
      `Stop the local agent?\n\nWebhooks are no longer forwarded and Studio stays offline until you run \`${START_COMMAND}\` in a terminal.`,
    );
    if (!confirmed) return;
    stop.mutate(undefined, {
      onSuccess: () => toast.success(`Agent stopped. Run \`${START_COMMAND}\` to start it again.`),
      onError: (error) => toast.error(error.message),
    });
  };

  const copyStartCommand = () => {
    navigator.clipboard.writeText(START_COMMAND).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => toast.error("Could not copy to the clipboard"),
    );
  };

  return (
    <div class="w-full max-w-2xl space-y-8">
      <section class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-md">
            <Cpu class="size-5" />
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h3 class="text-foreground text-lg font-bold">Local Agent</h3>
              <Badge variant={status().variant} class="text-xs">
                {status().label}
              </Badge>
            </div>
            <p class="text-muted-foreground text-sm">
              The <code class="text-foreground font-mono font-semibold">pwr-agent</code> process
              that stores and forwards your webhooks.
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          pill
          onClick={health.refetch}
          disabled={health.isFetching || isBusy()}
        >
          <Show
            when={health.isFetching}
            fallback={
              <>
                <Activity class="size-3.5" />
                <span>Refresh</span>
              </>
            }
          >
            <Reload class={cn("size-3.5", health.isFetching && "animate-spin")} />
            <span>Checking…</span>
          </Show>
        </Button>
      </section>

      <Show
        when={agent() || isBusy()}
        fallback={
          <Show when={!health.isPending}>
            <section class="border-border space-y-3 border-t pt-6">
              <h4 class="text-foreground text-base font-bold">Agent not reachable</h4>
              <p class="text-muted-foreground text-sm">
                Studio cannot start the agent. Start it from a terminal, then refresh:
              </p>
              <div class="bg-muted/30 border-border flex max-w-md items-center justify-between rounded-md border p-3 font-mono text-xs">
                <code class="text-foreground">{START_COMMAND}</code>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={copyStartCommand}
                  class="text-muted-foreground hover:text-foreground"
                  title="Copy command"
                  aria-label="Copy start command"
                >
                  <Show when={copied()} fallback={<Copy class="size-4" />}>
                    <Check class="size-4 text-emerald-500" />
                  </Show>
                </Button>
              </div>
            </section>
          </Show>
        }
      >
        <section class="border-border border-t pt-6">
          <dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <For each={details()}>
              {(row) => (
                <>
                  <dt class="text-muted-foreground">{row.label}</dt>
                  <dd class="text-foreground font-mono">{row.value}</dd>
                </>
              )}
            </For>
          </dl>
        </section>

        <section class="border-border space-y-3 border-t pt-6">
          <div>
            <h4 class="text-foreground text-base font-bold">Controls</h4>
            <p class="text-muted-foreground text-sm">
              Both actions let in-flight deliveries finish before the process exits.
            </p>
          </div>
          <div class="flex items-center gap-2">
            <Button variant="outline" size="sm" pill onClick={handleRestart} disabled={isBusy()}>
              <Reload class={cn("size-3.5", restart.isPending && "animate-spin")} />
              <Show when={restart.isPending} fallback={<span>Restart agent</span>}>
                <span>Restarting…</span>
              </Show>
            </Button>
            <Button variant="destructive" size="sm" pill onClick={handleStop} disabled={isBusy()}>
              <Close class="size-3.5" />
              <Show when={stop.isPending} fallback={<span>Stop agent</span>}>
                <span>Stopping…</span>
              </Show>
            </Button>
          </div>
        </section>
      </Show>

      <Show when={agent()}>
        <AgentUpdateSection />
      </Show>
    </div>
  );
};
