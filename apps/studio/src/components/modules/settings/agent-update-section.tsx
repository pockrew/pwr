import { Show, type Component } from "solid-js";
import { toast } from "solid-sonner";

import { PWR_INSTALL_COMMAND } from "@pockrew/pwr-shared/libs";
import type { AgentUpdateMode } from "@pockrew/pwr-shared/schemas";
import { Badge, Button } from "@pockrew/pwr-ui/core";
import { Copy, ExternalLink, Reload, Zap } from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

import { formatBytes } from "~/libs/format-bytes";
import {
  createApplyUpdateMutation,
  createCheckUpdateMutation,
  createUpdateModeMutation,
  createUpdateStatusQuery,
} from "~/libs/queries/updates.queries";

const MODES: { id: AgentUpdateMode; label: string; description: string }[] = [
  {
    id: "manual",
    label: "Manual",
    description: "Checks daily and shows new releases here; you choose when to install.",
  },
  {
    id: "auto",
    label: "Automatic",
    description: "Installs new releases as soon as they are found and restarts the agent.",
  },
  {
    id: "never",
    label: "Never check",
    description: "No background checks; use Check now when you want to know.",
  },
];

const MODE_TOAST: Record<AgentUpdateMode, string> = {
  manual: "Manual updates",
  auto: "Automatic updates on",
  never: "Background update checks off",
};

const relativeTime = (iso: string | null): string => {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return new Date(iso).toLocaleString();
};

/** Installed version, release check, one-click update and the manual/automatic update mode. */
export const AgentUpdateSection: Component = () => {
  const status = createUpdateStatusQuery();
  const check = createCheckUpdateMutation();
  const apply = createApplyUpdateMutation();
  const mode = createUpdateModeMutation();

  const isBusy = () =>
    check.isPending || apply.isPending || (status.data?.state ?? "idle") !== "idle";

  const handleCheck = () =>
    check.mutate(undefined, {
      onSuccess: (next) => {
        if (next.lastError) toast.error(next.lastError);
        else if (next.updateAvailable) toast.info(`v${next.latestVersion} is available`);
        else toast.success(`v${next.currentVersion} is the latest release`);
      },
      onError: (error) => toast.error(error.message),
    });

  const handleUpdate = () => {
    const target = status.data?.latestVersion;
    const confirmed = window.confirm(
      `Update to v${target}?\n\nThe agent downloads pwr-agent (with Studio) and pwr, verifies them against the release checksums, replaces them and restarts. Tunnels disconnect briefly; pending work resumes after the restart.`,
    );
    if (!confirmed) return;
    apply.mutate(undefined, {
      onSuccess: (health) =>
        toast.success(`Updated to v${health.version}`, {
          description: "Reload Studio to load the new version.",
          duration: Infinity,
          action: { label: "Reload", onClick: () => window.location.reload() },
        }),
      onError: (error) => toast.error(error.message),
    });
  };

  const handleMode = (next: AgentUpdateMode) => {
    if (next === status.data?.mode) return;
    if (
      next === "auto" &&
      !window.confirm(
        "Turn on automatic updates?\n\nNew releases will install and restart the agent without asking.",
      )
    )
      return;
    mode.mutate(next, {
      onSuccess: () => toast.success(MODE_TOAST[next]),
      onError: (error) => toast.error(error.message),
    });
  };

  const progressText = () => {
    const progress = status.data?.progress;
    if (!progress) return "Preparing download…";
    const total = progress.totalBytes ? ` of ${formatBytes(progress.totalBytes)}` : "";
    return `Downloading ${progress.asset}: ${formatBytes(progress.receivedBytes)}${total}`;
  };

  const copyInstallCommand = () =>
    navigator.clipboard.writeText(PWR_INSTALL_COMMAND).then(
      () => toast.success("Install command copied"),
      () => toast.error("Could not copy to the clipboard"),
    );

  return (
    <section class="border-border space-y-4 border-t pt-6">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div class="flex items-center gap-2">
            <h4 class="text-foreground text-base font-bold">Updates</h4>
            <Show when={status.data?.updateAvailable}>
              <Badge variant="info" class="text-xs">
                v{status.data?.latestVersion} available
              </Badge>
            </Show>
          </div>
          <p class="text-muted-foreground text-sm">
            Updates the agent, the Studio it serves, and the <code class="font-mono">pwr</code> CLI
            installed beside it.
          </p>
        </div>
        <Button variant="outline" size="sm" pill onClick={handleCheck} disabled={isBusy()}>
          <Reload class={cn("size-3.5", check.isPending ? "animate-spin" : "")} />
          <span>{check.isPending ? "Checking…" : "Check now"}</span>
        </Button>
      </div>

      <Show when={status.data} fallback={<p class="text-muted-foreground text-sm">Loading…</p>}>
        {(data) => (
          <>
            <dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
              <dt class="text-muted-foreground">Installed</dt>
              <dd class="text-foreground font-mono">v{data().currentVersion}</dd>
              <dt class="text-muted-foreground">Latest release</dt>
              <dd class="text-foreground flex items-center gap-2 font-mono">
                {data().latestVersion ? `v${data().latestVersion}` : "unknown"}
                <Show when={data().releaseUrl}>
                  {(url) => (
                    <a
                      href={url()}
                      target="_blank"
                      rel="noreferrer"
                      class="text-primary inline-flex items-center gap-1 font-sans text-xs hover:underline"
                    >
                      Release notes <ExternalLink class="size-3" />
                    </a>
                  )}
                </Show>
              </dd>
              <dt class="text-muted-foreground">Last checked</dt>
              <dd class="text-foreground">{relativeTime(data().checkedAt)}</dd>
            </dl>

            <Show when={data().lastError}>
              {(error) => <p class="text-destructive text-sm">{error()}</p>}
            </Show>

            <Show
              when={!data().unsupportedReason}
              fallback={
                <div class="bg-muted/30 border-border space-y-2 rounded-md border p-3 text-sm">
                  <p class="text-muted-foreground">{data().unsupportedReason}</p>
                  <div class="flex items-center justify-between gap-2 font-mono text-xs">
                    <code class="text-foreground truncate">{PWR_INSTALL_COMMAND}</code>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={copyInstallCommand}
                      title="Copy install command"
                      aria-label="Copy install command"
                    >
                      <Copy class="size-3.5" />
                    </Button>
                  </div>
                </div>
              }
            >
              <Show when={data().updateAvailable || apply.isPending}>
                <div class="flex flex-wrap items-center gap-3">
                  <Button size="sm" pill onClick={handleUpdate} disabled={isBusy()}>
                    <Zap class="size-3.5" />
                    <span>
                      {apply.isPending ? "Updating…" : `Update to v${data().latestVersion}`}
                    </span>
                  </Button>
                  <Show when={apply.isPending}>
                    <span class="text-muted-foreground text-xs">
                      {data().state === "downloading" ? progressText() : "Restarting the agent…"}
                    </span>
                  </Show>
                </div>
              </Show>
            </Show>

            <div class="space-y-2">
              <span class="text-foreground text-sm font-medium">Update mode</span>
              <div class="flex flex-wrap gap-2">
                {MODES.map((option) => (
                  <button
                    type="button"
                    disabled={mode.isPending}
                    onClick={() => handleMode(option.id)}
                    class={cn(
                      "max-w-64 cursor-pointer rounded-md border p-3 text-left transition-colors",
                      data().mode === option.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/40",
                    )}
                  >
                    <div class="text-foreground text-sm font-semibold">{option.label}</div>
                    <p class="text-muted-foreground mt-0.5 text-xs">{option.description}</p>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </Show>
    </section>
  );
};
