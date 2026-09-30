import { A, useLocation } from "@solidjs/router";
import { createEffect, For, Show } from "solid-js";

import { Button, formatShortcut, Kbd } from "@pockrew/pwr-ui/core";
import { EventMessage, Home, Settings, SidebarClose, Zap } from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

import { endpointsStore } from "~/stores/endpoints.store";
import { sidebarStore } from "~/stores/sidebar.store";
import { wsStore } from "~/stores/ws.store";

import { SidebarFooterDiagnostic } from "./sidebar/sidebar-footer-diagnostic";
import { SidebarSyncIndicator } from "./sidebar/sidebar-sync-indicator";
import { SidebarTunnelStatus } from "./sidebar/sidebar-tunnel-status";
import { ThemeSwitcher } from "./theme-switcher";

export const Sidebar = () => {
  const location = useLocation();

  // Clear unread event badges when active route is requests feed
  createEffect(() => {
    if (location.pathname === "/") {
      wsStore.markEventsAsRead();
    }
  });

  const getRouteIcon = (route: string) => {
    switch (route) {
      case "/":
        return (
          <div class="relative flex items-center justify-center">
            <Home class="size-4 shrink-0" />
            <Show when={sidebarStore.isCollapsed}>
              <Show when={wsStore.unreadCount > 0}>
                <span class="ring-sidebar absolute -top-1 -right-1 flex size-2 rounded-full bg-emerald-500 ring-2" />
              </Show>
              <Show when={wsStore.hasNewEvent}>
                <span class="absolute -top-1 -right-1 size-2 animate-ping rounded-full bg-emerald-400" />
              </Show>
              <Show when={wsStore.requestsPerMinute > 0}>
                <span class="absolute -right-1 -bottom-1 flex size-2.5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40">
                  <Zap class="size-1.5" />
                </span>
              </Show>
            </Show>
          </div>
        );
      case "/endpoints":
        return <EventMessage class="size-4 shrink-0" />;
      default:
        return <Settings class="size-4 shrink-0" />;
    }
  };

  return (
    <aside
      class={cn(
        "border-border bg-sidebar ease-default relative flex shrink-0 flex-col border-r transition-all duration-200 select-none",
        "h-dvh",
        sidebarStore.isCollapsed ? "w-14" : "w-52",
      )}
    >
      {/* 3. Idea A: Hairline Top Indeterminate Progress/Sync Bar */}
      <SidebarSyncIndicator />

      {/* Sidebar Header Brand & Toggle */}
      <div class="flex h-14 shrink-0 items-center px-1.5">
        <div
          class={cn(
            "group flex w-full items-center justify-between",
            !sidebarStore.isCollapsed && "gap-1",
          )}
        >
          <Show
            when={sidebarStore.isCollapsed}
            fallback={
              <>
                <Button
                  as={A}
                  variant="ghost"
                  size="icon-lg"
                  href="/"
                  class="p-0 hover:bg-transparent"
                >
                  <img
                    src="/assets/logo-icon.png"
                    alt="PWR Logo"
                    class="transparent object-contain"
                  />
                </Button>
                <div
                  class={cn(
                    "ease-default flex flex-1 items-center justify-between overflow-hidden transition-all duration-200",
                    sidebarStore.isCollapsed ? "w-0 opacity-0" : "opacity-100",
                  )}
                >
                  <div class="flex items-center overflow-hidden">
                    <img
                      src="/assets/logo-wordmark.png"
                      alt="PWR - Pocket Webhook Relay"
                      class="mt-0.5 h-9 w-auto object-contain dark:brightness-0 dark:invert"
                    />
                  </div>
                  <Show when={!sidebarStore.isCollapsed}>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={sidebarStore.toggleSidebar}
                      title={`Toggle sidebar (${formatShortcut("⌘B")})`}
                    >
                      <SidebarClose class="text-muted-foreground size-3.5" />
                    </Button>
                  </Show>
                </div>
              </>
            }
          >
            <Button
              variant="ghost"
              size="icon-lg"
              onClick={sidebarStore.toggleSidebar}
              class="p-0"
              title={`Toggle sidebar (${formatShortcut("⌘B")})`}
            >
              <SidebarClose class="hidden size-4 group-hover:block" />
              <img
                src="/assets/logo-icon.png"
                alt="PWR Logo"
                class="transparent object-contain group-hover:hidden"
              />
            </Button>
          </Show>
        </div>
      </div>

      <SidebarTunnelStatus />

      <nav class="flex-1 space-y-1 overflow-y-auto px-2 py-3">
        <For each={sidebarStore.navItems}>
          {(item, index) => {
            const isActive = () => item.route === sidebarStore.activeRoute?.route;
            const isRequests = () => item.route === "/";
            const isEndpoints = () => item.route === "/endpoints";

            return (
              <A
                href={item.route}
                class={cn(
                  "flex h-10 w-full cursor-pointer items-center rounded-md text-left transition-all duration-150 select-none",
                  sidebarStore.isCollapsed ? "justify-center px-0" : "gap-2.5 px-2.5",
                  isActive()
                    ? "bg-muted-foreground/15 text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
                )}
                title={sidebarStore.isCollapsed ? item.title : undefined}
              >
                {getRouteIcon(item.route)}

                {/* Expanded Details */}
                <Show when={!sidebarStore.isCollapsed}>
                  <div class="flex flex-1 items-center justify-between overflow-hidden">
                    <span class="truncate text-sm font-medium">{item.title}</span>

                    <div class="flex shrink-0 items-center gap-1.5">
                      {/* 4. Idea B: Real-time Traffic Ticker / RPS Indicator */}
                      <Show when={isRequests() && wsStore.requestsPerMinute > 0}>
                        <span
                          class="inline-flex shrink-0 items-center gap-0.5 rounded border border-emerald-500/20 bg-emerald-500/10 px-1 py-0.5 font-mono text-[10px] font-bold whitespace-nowrap text-emerald-500"
                          title="Requests in the last 60 seconds"
                        >
                          <Zap class="size-2.5 shrink-0" />
                          <span class="whitespace-nowrap">{wsStore.requestsPerMinute}/m</span>
                        </span>
                      </Show>

                      {/* 4. Idea A: Live Pulse Pip + Unread Counter */}
                      <Show when={isRequests()}>
                        <Show
                          when={wsStore.unreadCount > 0}
                          fallback={
                            <span
                              class={cn(
                                "text-muted-foreground bg-muted/60 inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap transition-all",
                                wsStore.hasNewEvent &&
                                  "animate-pulse bg-emerald-500/20 font-bold text-emerald-400 ring-1 ring-emerald-500/50",
                              )}
                            >
                              {wsStore.events.length}
                            </span>
                          }
                        >
                          <span
                            class={cn(
                              "inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold whitespace-nowrap transition-all",
                              wsStore.hasNewEvent
                                ? "animate-pulse bg-emerald-500 text-white"
                                : "bg-emerald-500/20 text-emerald-400",
                            )}
                          >
                            +{wsStore.unreadCount}
                          </span>
                        </Show>
                      </Show>

                      {/* Endpoints count badge */}
                      <Show when={isEndpoints() && endpointsStore.endpoints.length > 0}>
                        <span class="bg-muted/60 text-muted-foreground inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap">
                          {endpointsStore.endpoints.length}
                        </span>
                      </Show>

                      <Kbd
                        size="sm"
                        class="text-muted-foreground shrink-0 whitespace-nowrap opacity-60"
                        autoFormat
                      >
                        ⌘{index() + 1}
                      </Kbd>
                    </div>
                  </div>
                </Show>
              </A>
            );
          }}
        </For>
      </nav>

      <div
        class={cn(
          "flex shrink-0 flex-col",
          sidebarStore.isCollapsed ? "items-center gap-2 px-1 py-3" : "gap-1 p-2",
        )}
      >
        <SidebarFooterDiagnostic />
        <ThemeSwitcher />
      </div>
    </aside>
  );
};
