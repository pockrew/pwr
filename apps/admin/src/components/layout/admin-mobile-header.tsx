import { A } from "@solidjs/router";
import { Show, type Component } from "solid-js";

import { Badge, Button } from "@pockrew/pwr-ui/core";
import { Hambuger, Moon, Sun } from "@pockrew/pwr-ui/icons";

import { sidebarStore } from "~/stores/sidebar.store";
import { themeStore } from "~/stores/theme.store";

export const AdminMobileHeader: Component = () => {
  return (
    <header class="border-sidebar-border bg-sidebar/80 sticky top-0 z-30 flex h-14 w-full shrink-0 items-center justify-between border-b px-4 backdrop-blur-md md:hidden">
      <div class="flex items-center gap-2.5">
        <Button
          variant="ghost"
          size="icon-sm"
          class="text-foreground/80 hover:bg-sidebar-accent size-8"
          onClick={sidebarStore.toggleMobile}
          aria-label="Open navigation menu"
        >
          <Hambuger class="size-4" />
        </Button>

        <A href="/" class="flex items-center gap-2">
          <img
            src={`${import.meta.env.BASE_URL}assets/logo-icon.png`}
            alt="PWR Logo"
            class="size-6 object-contain"
          />
          <span class="text-foreground text-sm font-bold tracking-tight">PWR</span>
          <Badge variant="default" size="sm" class="font-mono text-[9px] uppercase">
            Admin
          </Badge>
        </A>
      </div>

      <div class="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          class="text-muted-foreground hover:text-foreground size-8"
          onClick={() => themeStore.toggleTheme()}
          aria-label="Toggle theme"
        >
          <Show when={themeStore.theme === "dark"} fallback={<Moon class="size-4" />}>
            <Sun class="size-4" />
          </Show>
        </Button>
      </div>
    </header>
  );
};
