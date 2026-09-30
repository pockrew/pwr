import { Match, Switch, type Component } from "solid-js";

import type { DiffCategory } from "~/libs/diff-utils";

export interface DiffCategoryBadgeProps {
  category: DiffCategory;
}

/**
 * Renders a 4-character uppercase category badge (TYPE, VALUE, ATTR) without background.
 * Utilizes Solid's Switch/Match for clean category dispatch.
 */
export const DiffCategoryBadge: Component<DiffCategoryBadgeProps> = (props) => {
  return (
    <Switch fallback={null}>
      <Match when={props.category === "types"}>
        <span class="font-mono text-xs font-bold tracking-wider text-purple-600 dark:text-purple-400">
          TYPE
        </span>
      </Match>
      <Match when={props.category === "value"}>
        <span class="font-mono text-xs font-bold tracking-wider text-amber-600 dark:text-amber-400">
          VALUE
        </span>
      </Match>
      <Match when={props.category === "attributes"}>
        <span class="font-mono text-xs font-bold tracking-wider text-sky-600 dark:text-sky-400">
          ATTR
        </span>
      </Match>
    </Switch>
  );
};
