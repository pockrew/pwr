import { useLocation, useNavigate, type RouteSectionProps } from "@solidjs/router";
import { createEffect, onCleanup, onMount, Show, type Component } from "solid-js";

import { isKeyboardBlocked, Toaster } from "@pockrew/pwr-ui/core";

import { AdminMobileHeader } from "~/components/layout/admin-mobile-header";
import { AdminSidebar } from "~/components/layout/admin-sidebar";
import { authStore } from "~/stores/auth.store";
import { sidebarStore } from "~/stores/sidebar.store";
import { themeStore } from "~/stores/theme.store";

export const AdminLayout: Component<RouteSectionProps> = (props) => {
  const location = useLocation();
  const navigate = useNavigate();

  onMount(() => {
    authStore.init();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isKeyboardBlocked()) return;

      const isCmdOrCtrl = e.metaKey || e.ctrlKey;

      if (isCmdOrCtrl && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        sidebarStore.toggleSidebar();
        return;
      }

      if (isCmdOrCtrl && e.key === "1") {
        e.preventDefault();
        navigate("/tunnels");
        return;
      }

      if (isCmdOrCtrl && e.key === "2") {
        e.preventDefault();
        navigate("/audit");
        return;
      }

      if (isCmdOrCtrl && e.key === "3") {
        e.preventDefault();
        navigate("/logs");
        return;
      }

      if (e.key === "Escape" && sidebarStore.isMobileOpen) {
        e.preventDefault();
        sidebarStore.closeMobile();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown));
  });

  const isLoginPage = () => {
    const p = location.pathname.startsWith("/admin")
      ? location.pathname.slice(6) || "/"
      : location.pathname;
    return p === "/login";
  };

  createEffect(() => {
    // If auth initialized and not logged in, redirect to login page (unless already on /login)
    if (!authStore.isLoading && !authStore.isAuthenticated && !isLoginPage()) {
      navigate("/login");
    }
  });

  return (
    <div class="bg-background text-foreground flex h-dvh w-full overflow-hidden font-sans antialiased">
      <Show when={authStore.isAuthenticated && !isLoginPage()}>
        <AdminSidebar />
      </Show>

      <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Show when={authStore.isAuthenticated && !isLoginPage()}>
          <AdminMobileHeader />
        </Show>

        <main class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <Show
            when={!authStore.isLoading || isLoginPage()}
            fallback={
              <div class="flex flex-1 items-center justify-center">
                <div class="text-muted-foreground flex items-center gap-2 font-mono text-xs">
                  <span class="border-primary size-3 animate-spin rounded-full border-2 border-t-transparent" />
                  <span>Checking server authorization...</span>
                </div>
              </div>
            }
          >
            {props.children}
          </Show>
        </main>
      </div>

      <Toaster position="bottom-right" theme={themeStore.theme} />
    </div>
  );
};
