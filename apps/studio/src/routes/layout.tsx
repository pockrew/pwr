import { useLocation, useNavigate, type RouteSectionProps } from "@solidjs/router";
import { onCleanup, onMount, Show, type Component } from "solid-js";

import { Toaster } from "@pockrew/pwr-ui/core";

import { AppHeader } from "~/components/modules/app-header";
import { Sidebar } from "~/components/modules/app-sidebar";
import { isKeyboardBlocked } from "~/libs/keyboard";
import { sidebarStore } from "~/stores/sidebar.store";
import { theme } from "~/stores/theme.store";

export const StudioLayout: Component<RouteSectionProps> = (props) => {
  const location = useLocation();
  const navigate = useNavigate();

  const isHeaderHidden = () =>
    location.pathname === "/" ||
    location.pathname === "/compare" ||
    location.pathname === "/endpoints" ||
    location.pathname.startsWith("/settings");

  onMount(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Disable background shortcuts when sheets/dropdowns/inputs are active
      if (isKeyboardBlocked()) return;

      const isCmdOrCtrl = e.metaKey || e.ctrlKey;

      // 1. Toggle Sidebar: Cmd+B or Ctrl+B
      if (isCmdOrCtrl && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        sidebarStore.toggleSidebar();
        return;
      }

      // 2. Route Switching: Cmd+1 (Requests), Cmd+2 (Endpoints), Cmd+3 (Settings)
      if (isCmdOrCtrl && e.key === "1") {
        e.preventDefault();
        navigate("/");
        return;
      }
      if (isCmdOrCtrl && e.key === "2") {
        e.preventDefault();
        navigate("/endpoints");
        return;
      }
      if (isCmdOrCtrl && e.key === "3") {
        e.preventDefault();
        navigate("/settings");
        return;
      }

      // 3. Quick Focus Search: Cmd+K or Ctrl+K
      if (isCmdOrCtrl && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("studio:focus-search"));
        return;
      }
    };

    document.addEventListener("keydown", handleGlobalKeyDown);
    onCleanup(() => document.removeEventListener("keydown", handleGlobalKeyDown));
  });

  return (
    <div class="flex h-dvh w-full overflow-hidden">
      <Sidebar />
      <aside class="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <Show when={!isHeaderHidden()}>
          <AppHeader />
        </Show>
        <main class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{props.children}</main>
      </aside>
      <Toaster position="bottom-right" theme={theme()} />
    </div>
  );
};
