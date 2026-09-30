import { type RouteSectionProps } from "@solidjs/router";
import { type Component } from "solid-js";

import { SettingsNav } from "~/components/modules/settings/settings-nav";

export const SettingsLayout: Component<RouteSectionProps> = (props) => {
  return (
    <div class="grid-swiss bg-background grid h-full overflow-hidden">
      <SettingsNav />

      <div class="bg-background flex h-full flex-1 flex-col overflow-hidden">
        <div class="min-h-0 w-full flex-1 overflow-y-auto p-6">{props.children}</div>
      </div>
    </div>
  );
};

export const SettingsPage = SettingsLayout;
export default SettingsLayout;
