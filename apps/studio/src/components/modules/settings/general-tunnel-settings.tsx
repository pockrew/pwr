import { type Component } from "solid-js";

import { Tabs } from "@pockrew/pwr-ui/core";

import { ProxySettings } from "./proxy-settings";
import { TunnelConnectionSettings } from "./tunnel-connection-settings";

/** Tunnel connection of this agent, and the proxy its own outbound connections use. */
export const GeneralTunnelSettings: Component = () => (
  <Tabs defaultValue="server" class="w-full">
    <Tabs.List class="border-border mb-6 border-b">
      <Tabs.Trigger value="server">Tunnel</Tabs.Trigger>
      <Tabs.Trigger value="proxy">Proxy</Tabs.Trigger>
    </Tabs.List>

    <Tabs.Content value="server" class="max-w-2xl space-y-4">
      <div class="pb-1">
        <h3 class="text-foreground text-lg font-bold">Tunnel Connection</h3>
        <p class="text-muted-foreground text-sm">
          Connect this agent to a tunnel created on your PWR server
        </p>
      </div>
      <TunnelConnectionSettings />
    </Tabs.Content>

    <Tabs.Content value="proxy" class="max-w-2xl space-y-4">
      <div class="pb-1">
        <h3 class="text-foreground text-lg font-bold">Proxy</h3>
        <p class="text-muted-foreground text-sm">
          For the agent's connections to the PWR server and update downloads. Calls to your local
          targets never use a proxy.
        </p>
      </div>
      <ProxySettings />
    </Tabs.Content>
  </Tabs>
);
