import { Show, type Component } from "solid-js";
import { toast } from "solid-sonner";

import { Button } from "@pockrew/pwr-ui/core";
import { Reload } from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

import { TunnelSelect } from "~/components/modules/tunnel-select";
import { SESSION_ERRORS } from "~/libs/tunnel-connection";
import { sidebarStore } from "~/stores/sidebar.store";
import { tunnelStore } from "~/stores/tunnel.store";
import { wsStore } from "~/stores/ws.store";

type Tone = "ok" | "busy" | "down" | "none";

const DOT: Record<Tone, string> = {
  ok: "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]",
  busy: "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]",
  down: "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]",
  none: "bg-muted",
};
const TEXT: Record<Tone, string> = {
  ok: "text-emerald-500",
  busy: "text-amber-400",
  down: "text-rose-400",
  none: "text-muted-foreground",
};

/**
 * The selected tunnel's real state: the agent's connection to the server (from its session),
 * then whether Studio is receiving the agent's live feed.
 */
const tunnelState = (): { tone: Tone; label: string; detail: string } => {
  const session = tunnelStore.session;
  if (tunnelStore.error) return { tone: "down", label: "Agent offline", detail: "" };
  if (!session) return { tone: "none", label: "No tunnel", detail: "Connect one in Settings" };
  const reason = session.lastError ? SESSION_ERRORS[session.lastError] : "";
  if (session.status === "reconnecting")
    return { tone: "busy", label: "Reconnecting", detail: reason };
  if (session.status === "disconnected")
    return { tone: "down", label: "Disconnected", detail: reason };
  if (wsStore.status !== "connected")
    return {
      tone: "busy",
      label: "Server connected",
      detail: wsStore.isConnecting ? "Opening the live feed…" : "Live feed interrupted",
    };
  return { tone: "ok", label: session.isPaused ? "Connected · paused" : "Connected", detail: "" };
};

export const SidebarTunnelStatus: Component = () => {
  const handleReconnect = async () => {
    if (wsStore.isConnecting) return;
    const toastId = "tunnel-reconnect";
    toast.loading("Reopening the live feed…", { id: toastId });
    const success = await wsStore.reconnect();
    if (success) toast.success("Live feed connected", { id: toastId });
    else toast.error("The agent did not answer; is it running?", { id: toastId });
  };

  return (
    <Show
      when={sidebarStore.isCollapsed}
      fallback={
        <div class="border-border bg-card/40 mx-2 mt-2 flex flex-col gap-1.5 rounded-3xl border p-2 text-xs select-none">
          <div class="flex min-w-0 items-center gap-1.5">
            <span
              class={cn(
                "size-2 shrink-0 rounded-full transition-all duration-500",
                DOT[tunnelState().tone],
              )}
            />
            <TunnelSelect
              class="min-w-0 flex-1"
              triggerClass="h-6 border-none bg-transparent px-1 text-xs font-bold shadow-none"
            />
          </div>
          <div class="flex items-center justify-between gap-2 font-mono text-xs">
            <span
              class={cn("truncate font-medium tracking-wide uppercase", TEXT[tunnelState().tone])}
              title={tunnelState().detail || undefined}
            >
              {tunnelState().label}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              class="text-muted-foreground hover:text-foreground h-5 w-5 disabled:opacity-50"
              onClick={handleReconnect}
              disabled={wsStore.isConnecting}
              title="Reopen the live feed from the agent"
            >
              <Reload class={cn("size-3", wsStore.isConnecting && "animate-spin text-amber-400")} />
            </Button>
          </div>
          <Show when={tunnelState().detail}>
            <span class="text-muted-foreground line-clamp-2 text-[11px]">
              {tunnelState().detail}
            </span>
          </Show>
        </div>
      }
    >
      <button
        type="button"
        class="group border-border/50 bg-card/20 hover:bg-card/60 relative mx-auto my-2 flex w-8 cursor-pointer flex-col items-center gap-1.5 rounded-full border py-2 transition-colors select-none disabled:cursor-not-allowed"
        onClick={handleReconnect}
        disabled={wsStore.isConnecting}
        title={`${tunnelStore.tunnelId || "No tunnel"}: ${tunnelState().label}${tunnelState().detail ? ` (${tunnelState().detail})` : ""}. Click to reopen the live feed.`}
      >
        <span class={cn("size-2 shrink-0 rounded-full", DOT[tunnelState().tone])} />
        <span class="text-muted-foreground group-hover:text-foreground flex rotate-180 items-center justify-center py-1 font-mono text-[9px] font-bold tracking-widest whitespace-nowrap uppercase [writing-mode:vertical-rl]">
          {tunnelStore.tunnelId || "no tunnel"}
        </span>
      </button>
    </Show>
  );
};
