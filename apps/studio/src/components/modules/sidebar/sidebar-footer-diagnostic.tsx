import { Show, type Component } from "solid-js";
import { toast } from "solid-sonner";

import { PWR_VERSION } from "@pockrew/pwr-shared/libs";
import { Button, DropdownMenu } from "@pockrew/pwr-ui/core";
import { Copy, InfoCircle } from "@pockrew/pwr-ui/icons";

import { sidebarStore } from "~/stores/sidebar.store";
import { tunnelStore } from "~/stores/tunnel.store";
import { wsStore } from "~/stores/ws.store";

export const SidebarFooterDiagnostic: Component = () => {
  const version = `v${PWR_VERSION}`;

  const handleCopyDiagnostics = () => {
    const diagnosticPayload = {
      app: "PWR Studio",
      version,
      tunnelId: tunnelStore.tunnelId,
      serverConnection: tunnelStore.session?.status ?? "none",
      serverError: tunnelStore.session?.lastError ?? null,
      liveFeed: wsStore.status,
      loadedEvents: wsStore.events.length,
      timestamp: new Date().toISOString(),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
    };

    navigator.clipboard.writeText(JSON.stringify(diagnosticPayload, null, 2));
    toast.success("Diagnostic details copied to clipboard");
  };

  return (
    <Show
      when={sidebarStore.isCollapsed}
      fallback={
        /* Expanded Mode: Inline App Information Card (shows version and recorded events) */
        <div class="border-border bg-card/40 flex flex-col gap-2 rounded-3xl border p-2 font-mono text-xs select-none">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1.5 overflow-hidden">
              <InfoCircle class="text-muted-foreground size-3.5 shrink-0" />
              <span class="text-foreground font-bold">Studio</span>
              <span class="text-muted-foreground text-xs">{version}</span>
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              class="text-muted-foreground hover:text-foreground h-5 w-5"
              onClick={handleCopyDiagnostics}
              title="Copy diagnostics JSON"
            >
              <Copy class="size-3" />
            </Button>
          </div>

          <div class="border-border/40 flex items-center justify-between border-t pt-1.5 text-xs">
            <span class="text-muted-foreground">Loaded events</span>
            <span class="text-foreground font-mono font-bold">{wsStore.events.length}</span>
          </div>
        </div>
      }
    >
      {/* Collapsed Mode: Popover Trigger Button */}
      <DropdownMenu>
        <DropdownMenu.Trigger
          as={Button}
          variant="ghost"
          size="sm"
          pill
          class="text-muted-foreground hover:text-foreground size-8 shrink-0 justify-center p-0 font-mono text-xs transition-colors"
          title={`PWR Studio ${version} (${wsStore.events.length} events) - Click for diagnostics`}
        >
          <InfoCircle class="size-4 shrink-0" />
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content class="w-56 rounded-3xl p-2 font-mono text-xs shadow-lg">
            <div class="text-muted-foreground px-2 py-1 text-xs font-bold tracking-wider uppercase">
              App Information
            </div>

            <div class="space-y-1.5 px-2 py-2 text-xs">
              <div class="flex items-center justify-between">
                <span class="text-muted-foreground">Version:</span>
                <span class="text-foreground font-bold">{version}</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-muted-foreground">Loaded events:</span>
                <span class="text-foreground font-bold">{wsStore.events.length}</span>
              </div>
            </div>

            <Button
              pill
              variant="ghost"
              size="sm"
              class="w-full cursor-pointer"
              onClick={handleCopyDiagnostics}
            >
              <Copy class="size-3.5" />
              <span>Copy Diagnostics JSON</span>
            </Button>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </Show>
  );
};

export default SidebarFooterDiagnostic;
