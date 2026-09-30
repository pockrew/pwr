import { A, useLocation, useNavigate } from "@solidjs/router";
import { For, onCleanup, onMount, type Component } from "solid-js";

import { Kbd } from "@pockrew/pwr-ui/core";
import { Cpu, Database, FileText, Globe } from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

import { isKeyboardBlocked } from "~/libs/keyboard";
import { createAgentHealthQuery } from "~/libs/queries/agent.queries";

type SettingsTab = "general" | "data" | "logs" | "agent";

interface NavItem {
  id: SettingsTab;
  href: string;
  title: string;
  description: string;
  icon: typeof Globe;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: "general",
    href: "/settings",
    title: "General & Tunnel",
    description: "Tunnel connection & relay key, proxy",
    icon: Globe,
  },
  {
    id: "data",
    href: "/settings/data",
    title: "Data & Retention",
    description: "Storage, retention policy & pruning",
    icon: Database,
  },
  {
    id: "logs",
    href: "/settings/logs",
    title: "Agent Logs",
    description: "Live agent.log with level, text & time filters",
    icon: FileText,
  },
  {
    id: "agent",
    href: "/settings/agent",
    title: "Local Agent",
    description: "Status, restart, stop & updates",
    icon: Cpu,
  },
];

export const SettingsNav: Component = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const health = createAgentHealthQuery();

  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isKeyboardBlocked()) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }

      if (e.key === "1") {
        e.preventDefault();
        const target = NAV_ITEMS[0]?.href;
        if (target) navigate(target);
      } else if (e.key === "2") {
        e.preventDefault();
        const target = NAV_ITEMS[1]?.href;
        if (target) navigate(target);
      } else if (e.key === "3") {
        e.preventDefault();
        const target = NAV_ITEMS[2]?.href;
        if (target) navigate(target);
      } else if (e.key === "4") {
        e.preventDefault();
        const target = NAV_ITEMS[3]?.href;
        if (target) navigate(target);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown));
  });

  const isItemActive = (item: NavItem) => {
    if (item.href === "/settings") {
      return (
        location.pathname === "/settings" ||
        location.pathname === "/settings/" ||
        location.pathname === "/settings/general"
      );
    }
    return location.pathname === item.href || location.pathname.startsWith(item.href + "/");
  };

  return (
    <div class="border-border bg-secondary/30 flex h-full flex-col overflow-hidden border-r">
      {/* Header */}
      <div class="border-border flex h-11 shrink-0 items-center border-b px-3">
        <h2 class="text-foreground text-lg font-bold tracking-tight">Configuration</h2>
      </div>

      {/* Tabs */}
      <nav class="flex-1 space-y-2 overflow-y-auto pb-2">
        <For each={NAV_ITEMS}>
          {(item, index) => {
            const isActive = () => isItemActive(item);
            const Icon = item.icon;

            return (
              <A
                href={item.href}
                class={cn(
                  "flex w-full cursor-pointer flex-col items-start gap-1 p-2 text-left transition-all duration-150 select-none",
                  isActive()
                    ? "bg-muted-foreground/15 text-foreground font-medium"
                    : "hover:bg-muted/40 text-foreground",
                )}
              >
                <div class="inline-flex w-full items-center justify-between">
                  <div class="inline-flex items-center gap-2">
                    <div
                      class={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-md",
                        isActive()
                          ? "bg-primary text-primary-foreground"
                          : "bg-background border-border border",
                      )}
                    >
                      <Icon class="size-4" />
                    </div>
                    <div class="text-foreground text-base font-medium">{item.title}</div>
                  </div>
                  <Kbd size="sm" class="text-muted-foreground opacity-60">
                    {index() + 1}
                  </Kbd>
                </div>
                <div class="text-muted-foreground truncate text-xs">{item.description}</div>
              </A>
            );
          }}
        </For>
      </nav>
      <div class="border-border bg-background flex h-11 shrink-0 items-center justify-center border-t px-3">
        <span class="text-muted-foreground font-mono text-xs">
          agent: {health.isError ? "offline" : health.data ? `v${health.data.version}` : "…"}
        </span>
      </div>
    </div>
  );
};
