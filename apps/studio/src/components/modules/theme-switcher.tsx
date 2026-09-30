import { Match, Show, Switch, type Component } from "solid-js";

import { Button, DropdownMenu } from "@pockrew/pwr-ui/core";
import { ChevronDown, Monitor, Moon, Sun } from "@pockrew/pwr-ui/icons";
import { cn } from "@pockrew/pwr-ui/libs";

import { sidebarStore } from "~/stores/sidebar.store";
import { setTheme, theme } from "~/stores/theme.store";

export const ThemeSwitcher: Component = () => (
  <DropdownMenu>
    <DropdownMenu.Trigger
      as={Button}
      class={cn(
        "text-muted-foreground hover:text-foreground shrink-0 transition-colors",
        sidebarStore.isCollapsed
          ? "size-8 justify-center p-0"
          : "h-8 w-full justify-between px-2 text-xs font-medium",
      )}
      size="sm"
      pill
      variant="ghost"
      title={`Theme: ${theme()}`}
    >
      <div class="flex items-center gap-2">
        <Switch fallback={<Monitor class="size-4 shrink-0" />}>
          <Match when={theme() === "light"}>
            <Sun class="size-4 shrink-0 text-amber-500" />
          </Match>
          <Match when={theme() === "dark"}>
            <Moon class="size-4 shrink-0 text-blue-400" />
          </Match>
        </Switch>
        <Show when={!sidebarStore.isCollapsed}>
          <span class="text-xs capitalize">Theme: {theme()}</span>
        </Show>
      </div>
      <Show when={!sidebarStore.isCollapsed}>
        <ChevronDown class="text-muted-foreground/60 size-3 shrink-0" />
      </Show>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content class="flex w-36 flex-col gap-1 p-1 text-xs">
        <DropdownMenu.Item
          class={cn(
            "inline-flex cursor-pointer items-center gap-2 rounded px-2 py-1.5",
            theme() === "light" && "bg-accent",
          )}
          onSelect={() => setTheme("light")}
        >
          <Sun class="size-3.5 text-amber-500" />
          <span>Light</span>
        </DropdownMenu.Item>
        <DropdownMenu.Item
          class={cn(
            "inline-flex cursor-pointer items-center gap-2 rounded px-2 py-1.5",
            theme() === "dark" && "bg-accent",
          )}
          onSelect={() => setTheme("dark")}
        >
          <Moon class="size-3.5 text-blue-400" />
          <span>Dark</span>
        </DropdownMenu.Item>
        <DropdownMenu.Item
          class={cn(
            "inline-flex cursor-pointer items-center gap-2 rounded px-2 py-1.5",
            theme() === "system" && "bg-accent",
          )}
          onSelect={() => setTheme("system")}
        >
          <Monitor class="size-3.5" />
          <span>System</span>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu>
);

export default ThemeSwitcher;
