import { Show, type Component } from "solid-js";

import { sidebarStore } from "~/stores/sidebar.store";

interface Props {
  hideTitle?: boolean;
}

export const AppHeader: Component<Props> = (props) => {
  return (
    <header class="bg-background border-border flex h-11 w-full shrink-0 items-center justify-between border-b px-3">
      <Show when={!props.hideTitle}>
        <div class="inline-flex items-center gap-2">
          <h1 class="text-title overflow-hidden font-bold whitespace-nowrap">
            {sidebarStore.activeRoute?.title}
          </h1>
        </div>
      </Show>
    </header>
  );
};
