import { A, useLocation, useNavigate } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { For, Show, type Component } from "solid-js";

import { Badge, Button, Kbd } from "@pockrew/pwr-ui/core";
import {
  Activity,
  Close,
  Database,
  FileText,
  Globe,
  Moon,
  SidebarClose,
  Sun,
} from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

import { fetchReadiness } from "~/libs/api-client";
import { authStore } from "~/stores/auth.store";
import { sidebarStore } from "~/stores/sidebar.store";
import { themeStore } from "~/stores/theme.store";

const normalizeAdminPath = (path: string): string => {
  let p = path;
  if (p.startsWith("/admin")) {
    p = p.slice(6);
  }
  if (!p || p === "") {
    return "/";
  }
  return p;
};

const NAV_ITEMS = [
  {
    path: "/tunnels",
    label: "Tunnels",
    shortcut: "⌘1",
    icon: Globe,
    isActive: (p: string) => {
      const norm = normalizeAdminPath(p);
      return norm === "/" || norm.startsWith("/tunnels");
    },
  },
  {
    path: "/audit",
    label: "Audit Log",
    shortcut: "⌘2",
    icon: Activity,
    isActive: (p: string) => {
      const norm = normalizeAdminPath(p);
      return norm.startsWith("/audit");
    },
  },
  {
    path: "/logs",
    label: "Server Logs",
    shortcut: "⌘3",
    icon: FileText,
    isActive: (p: string) => normalizeAdminPath(p).startsWith("/logs"),
  },
];

export const AdminSidebar: Component = () => {
  const location = useLocation();
  const navigate = useNavigate();
  // Polled so the card turns red when the server or its database stops answering.
  const readiness = createQuery(() => ({
    queryKey: ["server", "ready"],
    queryFn: fetchReadiness,
    refetchInterval: 30_000,
    retry: false,
  }));
  const healthState = (): { tone: string; label: string } => {
    if (readiness.isPending) return { tone: "bg-muted-foreground/40", label: "Checking…" };
    if (readiness.isError) return { tone: "bg-rose-500", label: "Server not ready" };
    return { tone: "bg-emerald-500", label: "Server ready" };
  };

  const handleLogout = async () => {
    await authStore.logout();
    sidebarStore.closeMobile();
    navigate("/login");
  };

  const userInitial = () =>
    (authStore.user?.name || authStore.user?.email || "A").charAt(0).toUpperCase();

  return (
    <>
      {/* Mobile Drawer Backdrop */}
      <Show when={sidebarStore.isMobileOpen}>
        <div
          class="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs md:hidden"
          onClick={sidebarStore.closeMobile}
          aria-hidden="true"
        />
      </Show>

      {/* Sidebar Container */}
      <aside
        class={cn(
          "border-sidebar-border bg-sidebar text-sidebar-foreground ease-default z-50 flex flex-col border-r transition-all duration-200 select-none",
          "fixed inset-y-0 left-0 md:static md:h-dvh md:translate-x-0",
          sidebarStore.isMobileOpen
            ? "translate-x-0 shadow-2xl"
            : "-translate-x-full md:translate-x-0",
          sidebarStore.isCollapsed ? "md:w-16" : "w-64 md:w-60",
        )}
      >
        {/* Brand Section */}
        <div class="border-sidebar-border flex h-14 shrink-0 items-center justify-between border-b px-3">
          <Show
            when={!sidebarStore.isCollapsed}
            fallback={
              <div class="flex w-full items-center justify-center">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  class="hover:bg-sidebar-accent size-9 p-0"
                  onClick={sidebarStore.toggleSidebar}
                  title="Expand sidebar (⌘B)"
                >
                  <img
                    src={`${import.meta.env.BASE_URL}assets/logo-icon.png`}
                    alt="PWR Logo"
                    class="size-7 object-contain"
                  />
                </Button>
              </div>
            }
          >
            <A
              href="/"
              onClick={() => sidebarStore.closeMobile()}
              class="flex items-center gap-2 overflow-hidden transition-opacity select-none hover:opacity-90"
            >
              <img
                src={`${import.meta.env.BASE_URL}assets/logo-icon.png`}
                alt="PWR Logo"
                class="size-8 shrink-0 object-contain"
              />
              <div class="flex items-center overflow-hidden">
                <img
                  src={`${import.meta.env.BASE_URL}assets/logo-wordmark.png`}
                  alt="PWR"
                  class="h-7 w-auto object-contain dark:brightness-0 dark:invert"
                />
                <Badge
                  variant="default"
                  size="sm"
                  class="ml-1.5 font-mono text-[9px] tracking-wider uppercase"
                >
                  Admin
                </Badge>
              </div>
            </A>

            <Button
              variant="ghost"
              size="icon-xs"
              class="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground hidden md:inline-flex"
              onClick={sidebarStore.toggleSidebar}
              title="Collapse sidebar (⌘B)"
            >
              <SidebarClose class="size-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon-xs"
              class="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground md:hidden"
              onClick={sidebarStore.closeMobile}
              title="Close menu"
            >
              <Close class="size-4" />
            </Button>
          </Show>
        </div>

        {/* Server Health Card */}
        <div
          class={cn(
            "border-sidebar-border border-b px-3 py-2.5",
            sidebarStore.isCollapsed && "flex justify-center px-1",
          )}
        >
          <Show
            when={!sidebarStore.isCollapsed}
            fallback={
              <div
                class="bg-sidebar-accent/50 flex size-8 items-center justify-center rounded-md"
                title={`${healthState().label}${readiness.error ? `: ${readiness.error.message}` : ""}`}
              >
                <span class={cn("size-2 rounded-full", healthState().tone)} />
              </div>
            }
          >
            <div class="border-sidebar-border bg-sidebar-accent/30 flex items-center justify-between rounded-2xl border px-2.5 py-1.5 font-mono text-xs">
              <div
                class="text-foreground flex items-center gap-1.5 text-xs"
                title={readiness.error?.message}
              >
                <span class={cn("size-1.5 rounded-full", healthState().tone)} />
                <span class="font-medium">{healthState().label}</span>
              </div>
              <div class="text-muted-foreground flex items-center gap-1 text-[10px]">
                <Database class="size-3" />
                <span>{readiness.isSuccess ? "database connected" : "—"}</span>
              </div>
            </div>
          </Show>
        </div>

        {/* Navigation Items */}
        <nav class="flex-1 space-y-1 overflow-y-auto px-2 py-3">
          <Show when={!sidebarStore.isCollapsed}>
            <div class="text-muted-foreground px-2 pb-1 text-[10px] font-semibold tracking-wider uppercase">
              Management
            </div>
          </Show>

          <For each={NAV_ITEMS}>
            {(item) => {
              const active = () => item.isActive(location.pathname);
              const Icon = item.icon;

              return (
                <A
                  href={item.path}
                  onClick={() => sidebarStore.closeMobile()}
                  class={cn(
                    "group relative flex w-full items-center rounded-md font-medium transition-all duration-150 select-none",
                    sidebarStore.isCollapsed
                      ? "h-10 justify-center px-0"
                      : "h-9 gap-2.5 px-3 text-xs",
                    active()
                      ? "bg-primary/10 text-primary font-semibold shadow-xs"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                  )}
                  title={sidebarStore.isCollapsed ? item.label : undefined}
                >
                  <Show when={active()}>
                    <span class="bg-primary absolute top-1.5 bottom-1.5 left-0 w-1 rounded-r-md" />
                  </Show>
                  <Icon
                    class={cn(
                      "size-4 shrink-0 transition-colors",
                      active()
                        ? "text-primary"
                        : "text-sidebar-foreground/70 group-hover:text-sidebar-foreground",
                    )}
                  />
                  <Show when={!sidebarStore.isCollapsed}>
                    <span class="flex-1 truncate text-left">{item.label}</span>
                    <Kbd size="sm" class="opacity-60">
                      {item.shortcut}
                    </Kbd>
                  </Show>
                  <Show when={active() && sidebarStore.isCollapsed}>
                    <span class="bg-primary absolute right-1.5 size-1.5 rounded-full" />
                  </Show>
                </A>
              );
            }}
          </For>
        </nav>

        {/* User Profile & Actions Footer */}
        <div class="border-sidebar-border border-t p-2">
          <Show
            when={!sidebarStore.isCollapsed}
            fallback={
              <div class="flex flex-col items-center gap-2 py-1">
                <div
                  class="bg-primary/15 text-primary flex size-8 items-center justify-center rounded-full font-mono text-xs font-bold"
                  title={authStore.user?.email}
                >
                  {userInitial()}
                </div>

                <Button
                  variant="ghost"
                  size="icon-xs"
                  class="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground size-8"
                  onClick={() => themeStore.toggleTheme()}
                  title="Toggle theme"
                >
                  <Show when={themeStore.theme === "dark"} fallback={<Moon class="size-3.5" />}>
                    <Sun class="size-3.5" />
                  </Show>
                </Button>

                <Button
                  variant="ghost"
                  size="icon-xs"
                  class="text-sidebar-foreground/70 hover:bg-destructive/10 hover:text-destructive size-8"
                  onClick={handleLogout}
                  title="Sign out"
                >
                  <Close class="size-3.5" />
                </Button>
              </div>
            }
          >
            <Show when={authStore.user}>
              {(user) => (
                <div class="border-sidebar-border bg-sidebar-accent/20 mb-2 flex items-center gap-2.5 rounded-2xl border p-2">
                  <div class="bg-primary/15 text-primary flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold">
                    {userInitial()}
                  </div>
                  <div class="flex min-w-0 flex-1 flex-col">
                    <span class="text-sidebar-foreground truncate font-mono text-xs font-medium">
                      {user().email}
                    </span>
                    <span class="text-muted-foreground font-mono text-[9px] uppercase">
                      {user().role || "Admin"}
                    </span>
                  </div>
                </div>
              )}
            </Show>

            <div class="flex items-center justify-between gap-1 pt-1">
              <Button
                variant="ghost"
                size="sm"
                class="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground h-8 flex-1 justify-start gap-1.5 px-2 text-xs"
                onClick={() => themeStore.toggleTheme()}
              >
                <Show when={themeStore.theme === "dark"} fallback={<Moon class="size-3.5" />}>
                  <Sun class="size-3.5" />
                </Show>
                <span class="text-xs">
                  {themeStore.theme === "dark" ? "Light Mode" : "Dark Mode"}
                </span>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                class="text-muted-foreground hover:bg-destructive/10 hover:text-destructive h-8 gap-1 px-2 text-xs"
                onClick={handleLogout}
                title="Sign out"
              >
                <span class="text-xs">Logout</span>
              </Button>
            </div>
          </Show>
        </div>
      </aside>
    </>
  );
};
