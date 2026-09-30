import { Show, type Component } from "solid-js";

import { Select } from "@pockrew/pwr-ui/core";
import { cn } from "@pockrew/pwr-ui/libs";

import { tunnelStore } from "~/stores/tunnel.store";

const tunnelLabel = (tunnelId: string): string => {
  const session = tunnelStore.tunnels.find((t) => t.tunnelId === tunnelId);
  return session?.slug && session.slug !== tunnelId ? `${tunnelId} (${session.slug})` : tunnelId;
};

const placeholder = (): string => {
  if (tunnelStore.isLoading) return "Loading tunnels...";
  if (tunnelStore.error) return "Agent unreachable";
  return "No tunnels";
};

/** Picks which of the agent's saved tunnels Studio shows. */
export const TunnelSelect: Component<{
  class?: string;
  triggerClass?: string;
  label?: string;
  description?: string;
}> = (props) => (
  <Select<string>
    class={props.class}
    options={tunnelStore.tunnels.map((t) => t.tunnelId)}
    value={tunnelStore.tunnelId || null}
    onChange={(id) => {
      if (id) tunnelStore.select(id);
    }}
    disabled={tunnelStore.tunnels.length === 0}
    placeholder={placeholder()}
    itemComponent={(item) => (
      <Select.Item item={item.item} class="font-mono">
        {tunnelLabel(item.item.rawValue)}
      </Select.Item>
    )}
  >
    <Show when={props.label}>{(label) => <Select.Label>{label()}</Select.Label>}</Show>
    <Select.Trigger class={cn("font-mono", props.triggerClass)} aria-label="Tunnel">
      <Select.Value<string>>{(state) => tunnelLabel(state.selectedOption())}</Select.Value>
    </Select.Trigger>
    <Show when={props.description}>
      {(description) => <Select.Description>{description()}</Select.Description>}
    </Show>
    <Select.Content />
  </Select>
);
